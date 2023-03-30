import { exec } from "child_process";
import express, { NextFunction } from "express";
import cors from "cors";
import getPort from "./getPort";
import sql3, { sqlite3 } from "sqlite3";
import { Chaincode, createCa, createOrderer, createOrg } from "./utils/shell";
import { sleep } from "./utils/general";
import fs from "fs";
import DB_Config from "./utils/db";
import { blockchainInit } from "./blockchain";
import { Contract, Gateway } from "@hyperledger/fabric-gateway";
import { acceptAssetRequest, closeGRPCConnection, createAsset, readAssetByID, transferAsset, transferNow } from "./utils/blockchain";
import { Client } from "@grpc/grpc-js";
import { Server } from "socket.io";
import http from "http";

const app = express();
const server = http.createServer(app);
const ioServer = new Server(server);

app.use(cors({
  origin: "*"
}))

app.use(express.static("public"));

app.use(express.json({ limit: "50mb" }));

const sqlite3 = sql3.verbose();


if (!fs.existsSync("./src/config")) fs.mkdirSync("./src/config");

let db = new sqlite3.Database("./src/config/configuration.db", (err) => {
  if (err) console.error("Configuration Initialization Failed", err.message);

  db.run("CREATE TABLE IF NOT EXISTS config (name TEXT, value TEXT)");


  db.serialize(function () {
    db.all("SELECT * FROM config WHERE name = \"SETUP\"", (error, rows: any[]) => {
      if (error) console.error({ message: "Error", details: "Getting configuration failed" })
      if (!rows.length) {
        let stmt = db.prepare("INSERT INTO config VALUES(?,?)");
        stmt.run("SETUP", "processing");
        stmt.finalize();
      }
    })
  })

})

app.set("db", db);

const DB = new DB_Config(db);

// This will be used for connecting the peer to main system to check if it is working and legit
app.get("/ping", async (req: express.Request, res: express.Response, next: NextFunction) => {
  res.send({ message: "Done", details: "pong" });
});

app.post("/initialize", async (req: express.Request, res) => {
  const { orgName, username, password, id } = req.body;
  console.log(process.cwd());

  let db: sql3.Database = app.get("db")

  try {
    await new Promise((resolve, reject) => {
      db.serialize(function () {
        db.all("SELECT name FROM config WHERE name = \"SETUP\" AND value = \"done\"", (error, rows: any[]) => {
          if (error) return reject("Getting configuration failed")
          if (rows.length) reject("This machine is already setup")
          else resolve("Continue");
        })
      })
    })

    let port = await getPort({});
    let [operations, admin, general] = [await getPort({}), await getPort({}), await getPort({})];
    let [caPort, caOperationPort, caOrdererPort, caOrdererOperationPort] = [await getPort({}), await getPort({}), await getPort({}), await getPort({})]

    await createCa({ orgName, caPort, caOperationPort, caOrdererPort, caOrdererOperationPort });

    await sleep(2000);

    await createOrderer({ orgName, general, admin, operations, caOrdererUsername: "admin", caOrdererPassword: "adminpw", caOrdererPort });

    await sleep(2000);

    await createOrg({ orgName, username, password, peerPort: port, caPort })

    db.serialize(function () {
      let stmt = db.prepare("INSERT INTO config VALUES(?,?),(?,?),(?,?),(?,?),(?,?),(?,?),(?,?),(?,?),(?,?)");
      stmt.run("ID", id,
        "PEER_PORT", port,
        "ORDERER_GENERAL_PORT", general,
        "ORDERER_ADMIN_PORT", admin,
        "ORDERER_OPERATION_PORT", operations,
        "CA_PORT", caPort,
        "CA_OPERATION_PORT", caOperationPort,
        "CA_ORDERER_PORT", caOrdererPort,
        "CA_ORDERER_OPERATION_PORT", caOrdererOperationPort);
      stmt.finalize();
      stmt = db.prepare("UPDATE config SET value = ? WHERE name = \"SETUP\"");
      stmt.run("done");
      stmt.finalize();
    })
    res.send({ message: "Done", details: { peerPort: port, ordererPorts: { general, admin, operations } } })
  } catch (error: any) {

    res.send({ message: "Failed", details: error });

  }

})

// Creation of new channel
app.post("/channel", async (req: express.Request, res: express.Response): Promise<void> => {
  const { channelId, orgName, channelToMSP } = req.body;

  const peer = await DB.getValueByName("PEER_PORT");
  const admin = await DB.getValueByName("ORDERER_ADMIN_PORT");
  const general = await DB.getValueByName("ORDERER_GENERAL_PORT");


  exec(`${process.cwd()}/scripts/createNewChannel.sh ${channelId} ${channelToMSP} ${orgName} ${peer[0].value} ${admin[0].value} ${general[0].value}`, (error, stdout, stderror) => {
    if (error) return res.send({ message: "Error creating the channel", details: stderror, status: "error" });
    res.send({ message: "Done" })
  })

})

// Get all channels that peer joined in
app.get("/channels", async (req: express.Request, res: express.Response, next: NextFunction): Promise<void> => {
  const { orgName } = req.query;

  const peer = await DB.getValueByName("PEER_PORT");

  exec(`${process.cwd()}/scripts/getChannels.sh ${orgName} ${peer[0].value}`, (error, stdout, stderror) => {
    try {
      if (error) return res.send({ message: "Getting channels error", details: stderror, status: "error" });

      const message = stdout.split(":")[1].trim().split(" ");

      res.send({ message });
    } catch (error: Error | any) {
      res.status(500).send({ message: error.message })
    }
  })
})

app.get("/getConfig", (req, res) => {

  const db: sql3.Database = app.get("db")

  db.serialize(function () {
    db.all("SELECT * FROM config", (error, rows: any[]) => {
      if (error) return res.send({ message: "Error", details: "Getting configuration failed" })
      res.send({ message: "Done", details: rows })
    })
  })

})

app.post("/getChannelConfig", async (req, res) => {
  const { orgName, channelId } = req.body;

  try {
    const peer = await DB.getValueByName("PEER_PORT");
    const general = await DB.getValueByName("ORDERER_GENERAL_PORT");

    exec(`${process.cwd()}/scripts/getChannelConfig.sh ${orgName} ${peer[0].value} ${channelId} ${general[0].value}`, (error, stdout, stderr) => {
      if (error) throw new Error(stderr);

      res.send({ message: "Done", details: { config: fs.readFileSync(`${process.cwd()}/organizations/channel-artifacts/config_block.pb`), ordererTlsCa: fs.readFileSync(`${process.cwd()}/organizations/ordererOrganizations/orderer.${orgName}.com/tlsca/tlsca.orderer.${orgName}.com-cert.pem`) } })
    })

  } catch (err: any) {
    res.send({ message: "Error", details: "Getting configuration failed" })
  }

})

app.post("/receiveChannelConfig", async (req, res) => {
  const { channelConfig, ordererTlsCa, orgName, otherOrgName, channelId, orgType } = req.body;

  fs.writeFileSync(`${process.cwd()}/organizations/channel-artifacts/config_block.pb`, Buffer.from(channelConfig));

  fs.mkdirSync(`${process.cwd()}/organizations/orderer`);

  fs.writeFileSync(`${process.cwd()}/organizations/orderer/tlsca.orderer.${otherOrgName}.com-cert.pem`, Buffer.from(ordererTlsCa));

  const peer = await DB.getValueByName("PEER_PORT")
  const general = await DB.getValueByName("ORDERER_GENERAL_PORT")

  exec(`${process.cwd()}/scripts/addOrgInChannel.sh ${orgName} ${otherOrgName} ${peer[0].value} ${channelId} ${orgType} ${general[0].value}`, (error, stdout, stderror) => {
    if (error) return res.send({ message: "Error", details: stderror })
    res.send({ message: "Done", details: { block: fs.readFileSync(`${process.cwd()}/organizations/channel-artifacts/_update_in_envelope.pb`) } })
    exec(`rm -rf ${process.cwd()}/organizations/channel-artifacts/*`);
    exec(`rm -rf ${process.cwd()}/organizations/orderer`);
  })
});

app.post("/joinChannelNow", async (req, res) => {
  const { channelId, ordererGeneralPort, otherOrgName, orgName, ordererTlsCa } = req.body;

  const peer = await DB.getValueByName("PEER_PORT");

  fs.mkdirSync(`${process.cwd()}/organizations/orderer`);

  fs.writeFileSync(`${process.cwd()}/organizations/orderer/tlsca.orderer.${otherOrgName}.com-cert.pem`, Buffer.from(ordererTlsCa));

  exec(`${process.cwd()}/scripts/fetchAndJoinChannel.sh ${orgName} ${peer[0].value} ${ordererGeneralPort} ${channelId} ${otherOrgName}`, (error, stdout, stderror) => {
    if (error) return res.send({ message: "Error", details: stderror })
    res.send({ message: "Done", details: "Peer Joined" })
    exec(`rm -rf ${process.cwd()}/organizations/channel-artifacts/*`);
    exec(`rm -rf ${process.cwd()}/organizations/orderer`);
  })

})

app.post("/signAndUpdateChannel", async (req, res) => {
  const { orgName, channelId, updateBlock, orgType } = req.body;

  const peer = await DB.getValueByName("PEER_PORT");
  const general = await DB.getValueByName("ORDERER_GENERAL_PORT");

  fs.writeFileSync(`${process.cwd()}/organizations/channel-artifacts/_update_in_envelope.pb`, Buffer.from(updateBlock))

  exec(`${process.cwd()}/scripts/updateChannel.sh ${orgName} ${peer[0].value} ${channelId} ${general[0].value} 0 ${orgType}`, (error, stdout, stderror) => {
    if (error) return res.send({ message: "Error", details: stderror })
    res.send({ message: "Done", details: { block: fs.readFileSync(`${process.cwd()}/organizations/channel-artifacts/_update_in_envelope.pb`), ordererGeneralPort: general[0].value } })
  })

});

app.post("/joinOrdererNow", async (req, res) => {
  const { channelId, orgName, channelConfig } = req.body;

  fs.writeFileSync(`${process.cwd()}/organizations/channel-artifacts/mychannel.block`, Buffer.from(channelConfig));

  const admin = await DB.getValueByName("ORDERER_ADMIN_PORT");

  exec(`${process.cwd()}/scripts/joinOrderer.sh ${orgName} ${channelId} ${admin[0].value}`, (error, stdout, stderror) => {
    if (error) return res.send({ message: "Error", details: stderror })
    res.send({ message: "Done", details: "Orderer Joined" })
    exec(`rm -rf ${process.cwd()}/organizations/channel-artifacts/*`);
    exec(`rm -rf ${process.cwd()}/organizations/orderer`);
  })

})

// app.get("/getassets", async (req, res) => {
//   try {
//     const blockchain = await blockchainInit("channel1");

//     // res.status(200).json(await createAsset(blockchain?.[2] as Contract, { id: "0001", color: "blue", size: "10", owner: "jayrald" }))
//     res.status(200).json(await readAssetByID(blockchain?.[2] as Contract, "0001"))
//     // res.status(200).json(await transferAsset(blockchain?.[2] as Contract, "0001", ""))
//     // res.status(200).json(await acceptAssetRequest(blockchain?.[2] as Contract, "0001"))
//     // res.status(200).json(await transferNow(blockchain?.[2] as Contract, "1234"))

//     if (await closeGRPCConnection(blockchain?.[0] as Gateway, blockchain?.[1] as Client)) console.log("Disconnected")

//   } catch (e) {
//     console.log(e);
//     res.send(e);
//   }
// })

app.post("/setup-collections-config", async (req, res) => {

  const { msps } = req.body;

  fs.writeFileSync(`${process.cwd()}/organizations/collections_config.json`,
    `[
  {
    "name": "assetCollection",
    "policy": "OR ('${msps[0]}.member','${msps[1]}.member')",
    "requiredPeerCount": 0,
    "maxPeerCount": 1,
    "blockToLive": 1000000,
    "memberOnlyRead": true,
    "memberOnlyWrite": true
  },
  {
    "name": "${msps[0]}PrivateCollection",
    "policy": "OR ('${msps[0]}.member')",
    "requiredPeerCount": 0,
    "maxPeerCount": 1,
    "blockToLive": 3,
    "memberOnlyRead": true,
    "memberOnlyWrite": false,
    "endorsementPolicy": {
      "signaturePolicy": "OR ('${msps[0]}.member','${msps[1]}.member')"
    }
  },
  {
    "name": "${msps[1]}PrivateCollection",
    "policy": "OR ('${msps[1]}.member')",
    "requiredPeerCount": 0,
    "maxPeerCount": 1,
    "blockToLive": 3,
    "memberOnlyRead": true,
    "memberOnlyWrite": false,
    "endorsementPolicy": {
      "signaturePolicy": "OR ('${msps[0]}.member','${msps[1]}.member')"
    }
  }
]
  `
  );

  res.send({ message: "Done", details: "Collections config created" })

});

app.post("/installchaincode", async (req, res) => {
  const { channel, hostname } = req.body;

  try {
    const PORT = await DB.getValueByName("PEER_PORT");
    const ORDERER_GENERAL_PORT = await DB.getValueByName("ORDERER_GENERAL_PORT");

    const chaincode = new Chaincode({ ORG_NAME: hostname, HOST: `${hostname}.com`, PORT: PORT[0].value })
    chaincode.setEnv("HOST", `${hostname}.com`);
    chaincode.setEnv("ORDERER_HOST", `orderer.${hostname}.com`);
    chaincode.setEnv("ORDERER_GENERAL_PORT", ORDERER_GENERAL_PORT[0].value);
    chaincode.setEnv("SEQUENCE", 1);
    chaincode.setEnv("VERSION", "1.0");
    chaincode.setEnv("CHANNEL_ID", channel);
    chaincode.setEnv("CHAINCODE_NAME", "supplychain");

    let result: string[] = await chaincode.installChaincode();

    res.send({ message: "Done", data: result });
  } catch (err: any) {
    res.send({ message: err.message })
  }
});

app.post("/approvechaincode", async (req, res) => {
  const { channel, hostname } = req.body;

  try {
    const PORT = await DB.getValueByName("PEER_PORT");
    const ORDERER_GENERAL_PORT = await DB.getValueByName("ORDERER_GENERAL_PORT");

    const chaincode = new Chaincode({ ORG_NAME: hostname, HOST: `${hostname}.com`, PORT: PORT[0].value })
    chaincode.setEnv("HOST", `${hostname}.com`);
    chaincode.setEnv("ORDERER_HOST", `orderer.${hostname}.com`);
    chaincode.setEnv("ORDERER_GENERAL_PORT", ORDERER_GENERAL_PORT[0].value);
    chaincode.setEnv("SEQUENCE", 1);
    chaincode.setEnv("VERSION", "1.0");
    chaincode.setEnv("CHANNEL_ID", channel);
    chaincode.setEnv("CHAINCODE_NAME", "supplychain");

    let result: string[] = await chaincode.approveChaincode();

    res.send({ message: "Done", data: result });
  } catch (err: any) {
    res.send({ message: err.message })
  }

});

app.post("/collectandtransferca", async (req, res) => {

  const { hostname } = req.body;

  res.send({ ca: fs.readFileSync(`${process.cwd()}/organizations/peerOrganizations/${hostname}.com/peers/${hostname}.com/tls/ca.crt`) });

})

app.post("/savetemporaryca", async (req, res) => {

  const { cas } = req.body;

  fs.writeFileSync(`${process.cwd()}/organizations/channel-artifacts/ca.crt`, Buffer.from(cas.ca.data));

  res.send({ message: "Done", details: "Saved temporary CA" })

});

app.post("/checkcommitreadiness", async (req, res) => {
  const { channel, hostname } = req.body;

  try {
    const PORT = await DB.getValueByName("PEER_PORT");
    const ORDERER_GENERAL_PORT = await DB.getValueByName("ORDERER_GENERAL_PORT");

    const chaincode = new Chaincode({ ORG_NAME: hostname, HOST: `${hostname}.com`, PORT: PORT[0].value })
    chaincode.setEnv("HOST", `${hostname}.com`);
    chaincode.setEnv("ORDERER_HOST", `orderer.${hostname}.com`);
    chaincode.setEnv("ORDERER_GENERAL_PORT", ORDERER_GENERAL_PORT[0].value);
    chaincode.setEnv("SEQUENCE", 1);
    chaincode.setEnv("VERSION", "1.0");
    chaincode.setEnv("CHANNEL_ID", channel);
    chaincode.setEnv("CHAINCODE_NAME", "supplychain");

    let result: string[] = await chaincode.checkCommitReadiness();
    console.log({ result })
    res.send({ message: "Done", data: result });
  } catch (err: any) {
    console.log(err);
    res.send({ message: err.message })
  }

});

app.post("/commitchaincode", async (req, res) => {
  const { channel, hostname, externals } = req.body;

  try {
    const PORT = await DB.getValueByName("PEER_PORT");
    const ORDERER_GENERAL_PORT = await DB.getValueByName("ORDERER_GENERAL_PORT");

    const chaincode = new Chaincode({ ORG_NAME: hostname, HOST: `${hostname}.com`, PORT: PORT[0].value })
    chaincode.setEnv("HOST", `${hostname}.com`);
    chaincode.setEnv("ORDERER_HOST", `orderer.${hostname}.com`);
    chaincode.setEnv("ORDERER_GENERAL_PORT", ORDERER_GENERAL_PORT[0].value);
    chaincode.setEnv("SEQUENCE", 1);
    chaincode.setEnv("VERSION", "1.0");
    chaincode.setEnv("CHANNEL_ID", channel);
    chaincode.setEnv("CHAINCODE_NAME", "supplychain");

    for (let host of externals) {
      chaincode.setEnv("EXTERNAL_HOST", `${host.host}.com`);
      chaincode.setEnv("EXTERNAL_PEER_PORT", host.port);
    }

    let result: string[] = await chaincode.commitChaincode();
    console.log({ result })
    res.send({ message: "Done", data: result });
  } catch (err: any) {
    console.log(err);
    res.send({ message: err.message })
  }

});

app.post("/initializechaincode", async (req, res) => {
  const { channel, hostname, externals } = req.body;

  try {
    const PORT = await DB.getValueByName("PEER_PORT");
    const ORDERER_GENERAL_PORT = await DB.getValueByName("ORDERER_GENERAL_PORT");

    const chaincode = new Chaincode({ ORG_NAME: hostname, HOST: `${hostname}.com`, PORT: PORT[0].value })
    chaincode.setEnv("HOST", `${hostname}.com`);
    chaincode.setEnv("ORDERER_HOST", `orderer.${hostname}.com`);
    chaincode.setEnv("ORDERER_GENERAL_PORT", ORDERER_GENERAL_PORT[0].value);
    chaincode.setEnv("SEQUENCE", 1);
    chaincode.setEnv("VERSION", "1.0");
    chaincode.setEnv("CHANNEL_ID", channel);
    chaincode.setEnv("CHAINCODE_NAME", "supplychain");

    for (let host of externals) {
      chaincode.setEnv("EXTERNAL_HOST", `${host.host}.com`);
      chaincode.setEnv("EXTERNAL_PEER_PORT", host.port);
    }

    let result: string[] = await chaincode.initializeChaincode();
    console.log({ result })

    fs.rmSync(`${process.cwd()}/organizations/channel-artifacts/ca.crt`);

    res.send({ message: "Done", data: result });
  } catch (err: any) {
    console.log(err);
    res.send({ message: err.message })
  }

});

server.listen(8012, (): void => {
  console.log("Listening for coming request...");
})
