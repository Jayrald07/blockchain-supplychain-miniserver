import { exec } from "child_process";
import express, { NextFunction } from "express";
import cors from "cors";
import getPort from "./getPort";
import sql3, { sqlite3 } from "sqlite3";
import { Chaincode, HLFComponents, createCa, createOrderer, createOrg } from "./utils/shell";
import { sleep } from "./utils/general";
import fs from "fs";
import DB_Config from "./utils/db";
import { blockchainInit } from "./blockchain";
import { Contract, Gateway } from "@hyperledger/fabric-gateway";
import { acceptAssetRequest, closeGRPCConnection, createAsset, getLogs, ownAsset, readAssetByID, readAssets, readTransactions, transferAsset, transferNow } from "./utils/blockchain";
import { Client } from "@grpc/grpc-js";
import { Server } from "socket.io";
import http from "http";

const app = express();
const server = http.createServer(app);
const ioServer = new Server(server, {
  cors: {
    origin: "*"
  }
});

app.use(cors({
  origin: "*"
}))

app.use(express.static("public"));

app.use(express.json({ limit: "50mb" }));

const sqlite3 = sql3.verbose();

ioServer.on("connection", socket => {
  console.log("Setup page connected!");
  socket.emit("connected", { message: "Done", details: null })
})


if (!fs.existsSync(`${process.cwd()}/config`)) fs.mkdirSync(`${process.cwd()}/config`);

let db = new sqlite3.Database(`${process.cwd()}/config/configuration.db`, (err) => {
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
  const { orgName, username, password, id, hostname } = req.body;
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

    res.send({ message: "Done", details: null })

    ioServer.emit("generatePorts", { message: "Done", details: { name: "Generating ports for orderer, peer, and CA nodes", status: false, position: 0 } });
    let port = await getPort({});
    let [operations, admin, general] = [await getPort({}), await getPort({}), await getPort({})];
    let [caPort, caOperationPort, caOrdererPort, caOrdererOperationPort] = [await getPort({}), await getPort({}), await getPort({}), await getPort({})]
    ioServer.emit("generatePorts", { message: "Done", details: { name: "Ports for orderer, peer, and CA nodes generated", status: true, position: 0 } });


    ioServer.emit("createCa", { message: "Done", details: { name: "Creating CA server", status: false, position: 1 } });
    await createCa({ orgName, caPort, caOperationPort, caOrdererPort, caOrdererOperationPort, hostname });
    ioServer.emit("createCa", { message: "Done", details: { name: "CA server created", status: true, position: 1 } });


    await sleep(2000);

    ioServer.emit("createOrderer", { message: "Done", details: { name: "Creating orderer node", status: false, position: 2 } });
    await createOrderer({ orgName, general, admin, operations, caOrdererUsername: "admin", caOrdererPassword: "adminpw", caOrdererPort, hostname });
    ioServer.emit("createOrderer", { message: "Done", details: { name: "Orderer node created", status: true, position: 2 } });

    await sleep(2000);

    ioServer.emit("createOrg", { message: "Done", details: { name: "Creating peer node", status: false, position: 3 } });
    await createOrg({ orgName, username, password, peerPort: port, caPort, hostname })
    ioServer.emit("createOrg", { message: "Done", details: { name: "Peer node created", status: true, position: 3 } });


    ioServer.emit("finalize", { message: "Done", details: { name: "Finalizing nodes configuration", status: false, position: 4 } })
    db.serialize(function () {
      let stmt = db.prepare("INSERT INTO config VALUES(?,?),(?,?),(?,?),(?,?),(?,?),(?,?),(?,?),(?,?),(?,?),(?,?)");
      stmt.run("ID", id,
        "ORG_NAME", orgName,
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
    ioServer.emit("finalize", { message: "Done", details: { name: "Nodes configuration finalized", status: true, position: 4 } })

  } catch (error: any) {

    res.send({ message: "Failed", details: error });

  }

})

// Creation of new channel
app.post("/channel", async (req: express.Request, res: express.Response): Promise<void> => {
  const { channelId, orgName, channelToMSP, host } = req.body;

  const peer = await DB.getValueByName("PEER_PORT");
  const admin = await DB.getValueByName("ORDERER_ADMIN_PORT");
  const general = await DB.getValueByName("ORDERER_GENERAL_PORT");


  exec(`${process.cwd()}/scripts/createNewChannel.sh ${channelId} ${channelToMSP} ${orgName} ${peer[0].value} ${admin[0].value} ${general[0].value} ${host}`, (error, stdout, stderror) => {
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
  const { orgName, channelId, host } = req.body;

  try {
    const peer = await DB.getValueByName("PEER_PORT");
    const general = await DB.getValueByName("ORDERER_GENERAL_PORT");

    exec(`${process.cwd()}/scripts/getChannelConfig.sh ${orgName} ${peer[0].value} ${channelId} ${general[0].value} ${host}`, (error, stdout, stderr) => {
      console.log({ error, stdout, stderr })
      if (error) throw new Error(stderr);

      res.send({ message: "Done", details: { config: fs.readFileSync(`${process.cwd()}/organizations/channel-artifacts/config_block.pb`), ordererTlsCa: fs.readFileSync(`${process.cwd()}/organizations/ordererOrganizations/orderer.${orgName}.com/tlsca/tlsca.orderer.${orgName}.com-cert.pem`) } })
    })

  } catch (err: any) {
    res.status(500).send({ message: "Error", details: "Getting configuration failed" })
  }

})

app.post("/receiveChannelConfig", async (req, res) => {
  const { channelConfig, ordererTlsCa, orgName, otherOrgName, channelId, orgType, host } = req.body;

  fs.writeFileSync(`${process.cwd()}/organizations/channel-artifacts/config_block.pb`, Buffer.from(channelConfig));

  fs.mkdirSync(`${process.cwd()}/organizations/orderer`);

  fs.writeFileSync(`${process.cwd()}/organizations/orderer/tlsca.orderer.${otherOrgName}.com-cert.pem`, Buffer.from(ordererTlsCa));

  const peer = await DB.getValueByName("PEER_PORT")
  const general = await DB.getValueByName("ORDERER_GENERAL_PORT")

  exec(`${process.cwd()}/scripts/addOrgInChannel.sh ${orgName} ${otherOrgName} ${peer[0].value} ${channelId} ${orgType} ${general[0].value} ${host}`, (error, stdout, stderror) => {
    console.log({ error, stdout, stderror })

    if (error) return res.send({ message: "Error", details: stderror })
    res.send({ message: "Done", details: { block: fs.readFileSync(`${process.cwd()}/organizations/channel-artifacts/_update_in_envelope.pb`) } })
    exec(`rm -rf ${process.cwd()}/organizations/channel-artifacts/*`);
    exec(`rm -rf ${process.cwd()}/organizations/orderer`);
  })
});

app.post("/joinChannelNow", async (req, res) => {
  const { channelId, ordererGeneralPort, otherOrgName, orgName, ordererTlsCa, host, otherHost } = req.body;

  const peer = await DB.getValueByName("PEER_PORT");

  fs.mkdirSync(`${process.cwd()}/organizations/orderer`);

  fs.writeFileSync(`${process.cwd()}/organizations/orderer/tlsca.orderer.${otherOrgName}.com-cert.pem`, Buffer.from(ordererTlsCa));

  exec(`${process.cwd()}/scripts/fetchAndJoinChannel.sh ${orgName} ${peer[0].value} ${ordererGeneralPort} ${channelId} ${otherOrgName} ${host} ${otherHost}`, (error, stdout, stderror) => {
    console.log({ error, stdout, stderror })

    if (error) return res.send({ message: "Error", details: stderror })
    res.send({ message: "Done", details: { port: peer[0].value } })
    exec(`rm -rf ${process.cwd()}/organizations/channel-artifacts/*`);
    exec(`rm -rf ${process.cwd()}/organizations/orderer`);
  })

})

app.post("/signAndUpdateChannel", async (req, res) => {
  const { orgName, channelId, updateBlock, orgType, host } = req.body;

  const peer = await DB.getValueByName("PEER_PORT");
  const general = await DB.getValueByName("ORDERER_GENERAL_PORT");

  fs.writeFileSync(`${process.cwd()}/organizations/channel-artifacts/_update_in_envelope.pb`, Buffer.from(updateBlock))

  exec(`${process.cwd()}/scripts/updateChannel.sh ${orgName} ${peer[0].value} ${channelId} ${general[0].value} 0 ${orgType} ${host}`, (error, stdout, stderror) => {
    console.log({ error, stdout, stderror })

    if (error) return res.send({ message: "Error", details: stderror })
    res.send({ message: "Done", details: { block: fs.readFileSync(`${process.cwd()}/organizations/channel-artifacts/_update_in_envelope.pb`), ordererGeneralPort: general[0].value } })
  })

});

app.post("/joinOrdererNow", async (req, res) => {
  const { channelId, orgName, channelConfig, host } = req.body;

  fs.writeFileSync(`${process.cwd()}/organizations/channel-artifacts/mychannel.block`, Buffer.from(channelConfig));

  const admin = await DB.getValueByName("ORDERER_ADMIN_PORT");

  exec(`${process.cwd()}/scripts/joinOrderer.sh ${orgName} ${channelId} ${admin[0].value} ${host}`, (error, stdout, stderror) => {
    console.log({ error, stdout, stderror })

    if (error) return res.send({ message: "Error", details: stderror })
    res.send({ message: "Done", details: "Orderer Joined" })
    exec(`rm -rf ${process.cwd()}/organizations/channel-artifacts/*`);
    exec(`rm -rf ${process.cwd()}/organizations/orderer`);
  })

})

app.post("/setup-collections-config", async (req, res) => {

  const { msps } = req.body;

  fs.writeFileSync(`${process.cwd()}/organizations/collections_config.json`,
    `[
  {
    "name": "assetCollection",
    "policy": "OR ('${msps[0]}.member','${msps[1]}.member')",
    "requiredPeerCount": 0,
    "maxPeerCount": 1,
    "blockToLive": 100000,
    "memberOnlyRead": true,
    "memberOnlyWrite": true,
    "endorsementPolicy": {
      "signaturePolicy": "OR ('${msps[0]}.member','${msps[1]}.member')"
    }
  },
  {
    "name": "${msps[0]}PrivateCollection",
    "policy": "OR ('${msps[0]}.member')",
    "requiredPeerCount": 0,
    "maxPeerCount": 1,
    "blockToLive": 0,
    "memberOnlyRead": true,
    "memberOnlyWrite": false,
    "endorsementPolicy": {
      "signaturePolicy": "OR ('${msps[0]}.member')"
    }
  },
  {
    "name": "${msps[1]}PrivateCollection",
    "policy": "OR ('${msps[1]}.member')",
    "requiredPeerCount": 0,
    "maxPeerCount": 1,
    "blockToLive": 0,
    "memberOnlyRead": true,
    "memberOnlyWrite": false,
    "endorsementPolicy": {
      "signaturePolicy": "OR ('${msps[1]}.member')"
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
    console.log({ err })

    res.status(500).send({ message: err.message })
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
    console.log({ err })
    res.status(500).send({ message: err.message })
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
    res.status(500).send({ message: err.message })
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
    res.status(500).send({ message: err.message })
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
    res.status(500).send({ message: err.message })
  }

});

app.post("/logs", async (req, res) => {

  const { channelId, orgName, start, offset } = req.body;

  const peerPort = await DB.getValueByName("PEER_PORT")

  try {

    const blockchain = await blockchainInit(channelId, orgName, peerPort[0].value);

    res.status(200).json(await getLogs(blockchain?.[2] as Contract, start, offset))

    if (await closeGRPCConnection(blockchain?.[0] as Gateway, blockchain?.[1] as Client)) console.log("Disconnected")

  } catch (e) {
    console.log(e);
    res.send(e);
  }
})


app.post("/createAsset", async (req, res) => {

  const { channelId, orgName, assetId, tags } = req.body;

  const peerPort = await DB.getValueByName("PEER_PORT")

  try {

    const blockchain = await blockchainInit(channelId, orgName, peerPort[0].value);

    res.status(200).json(await createAsset(blockchain?.[2] as Contract, assetId, JSON.stringify(tags)))

    if (await closeGRPCConnection(blockchain?.[0] as Gateway, blockchain?.[1] as Client)) console.log("Disconnected")

  } catch (e) {
    console.log(e);
    res.send(e);
  }
})

app.post("/readAsset", async (req, res) => {

  const { channelId, orgName, assetId, owner } = req.body;

  const peerPort = await DB.getValueByName("PEER_PORT")
  const ordererGeneralPort = await DB.getValueByName("ORDERER_GENERAL_PORT")

  try {
    const blockchain = await blockchainInit(channelId, orgName, peerPort[0].value);

    res.status(200).json(await readAssetByID(blockchain?.[2] as Contract, assetId))

    if (await closeGRPCConnection(blockchain?.[0] as Gateway, blockchain?.[1] as Client)) console.log("Disconnected")

  } catch (e) {
    console.log(e);
    res.send(e);
  }

})

app.post("/getAssets", async (req, res) => {
  const { channelId, orgName } = req.body;

  const peerPort = await DB.getValueByName("PEER_PORT")

  try {
    const blockchain = await blockchainInit(channelId, orgName, peerPort[0].value);

    res.status(200).json(await readAssets(blockchain?.[2] as Contract))

    if (await closeGRPCConnection(blockchain?.[0] as Gateway, blockchain?.[1] as Client)) console.log("Disconnected")

  } catch (e) {
    console.log(e);
    res.send(e);
  }
})

app.post("/transferAsset", async (req, res) => {

  const { channelId, orgName, transactionId, assetIds, newOwnerMSP } = req.body;

  const peerPort = await DB.getValueByName("PEER_PORT")

  try {
    const blockchain = await blockchainInit(channelId, orgName, peerPort[0].value);

    res.status(200).json(await transferAsset(blockchain?.[2] as Contract, transactionId, assetIds, newOwnerMSP))

    if (await closeGRPCConnection(blockchain?.[0] as Gateway, blockchain?.[1] as Client)) console.log("Disconnected")

  } catch (e) {
    console.log(e);
    res.send(e);
  }
})

app.post("/readAssetCollection", async (req, res) => {

  const { channelId, orgName } = req.body;

  const peerPort = await DB.getValueByName("PEER_PORT")

  try {
    const blockchain = await blockchainInit(channelId, orgName, peerPort[0].value);

    res.status(200).json(await readTransactions(blockchain?.[2] as Contract))

    if (await closeGRPCConnection(blockchain?.[0] as Gateway, blockchain?.[1] as Client)) console.log("Disconnected")

  } catch (e) {
    console.log(e);
    res.send(e);
  }
})

app.post("/acceptAsset", async (req, res) => {

  const { channelId, orgName, transactionId } = req.body;

  const peerPort = await DB.getValueByName("PEER_PORT")

  try {
    const blockchain = await blockchainInit(channelId, orgName, peerPort[0].value);

    res.status(200).json(await acceptAssetRequest(blockchain?.[2] as Contract, transactionId))

    if (await closeGRPCConnection(blockchain?.[0] as Gateway, blockchain?.[1] as Client)) console.log("Disconnected")

  } catch (e) {
    console.log(e);
    res.send(e);
  }
})

app.post("/transferNow", async (req, res) => {

  const { channelId, orgName, transactionId } = req.body;

  const peerPort = await DB.getValueByName("PEER_PORT")

  try {
    const blockchain = await blockchainInit(channelId, orgName, peerPort[0].value);

    res.status(200).json(await transferNow(blockchain?.[2] as Contract, transactionId))

    if (await closeGRPCConnection(blockchain?.[0] as Gateway, blockchain?.[1] as Client)) console.log("Disconnected")

  } catch (e) {
    console.log(e);
    res.send(e);
  }
})

app.post("/ownAsset", async (req, res) => {

  const { channelId, orgName, transactionId } = req.body;

  const peerPort = await DB.getValueByName("PEER_PORT")

  try {
    const blockchain = await blockchainInit(channelId, orgName, peerPort[0].value);

    res.status(200).json(await ownAsset(blockchain?.[2] as Contract, transactionId))

    if (await closeGRPCConnection(blockchain?.[0] as Gateway, blockchain?.[1] as Client)) console.log("Disconnected")

  } catch (e) {
    console.log(e);
    res.send(e);
  }
})

app.post("/logsOf", async (req: any, res) => {
  try {
    const { count, component } = req.body;
    const orgName = await DB.getValueByName("ORG_NAME");
    const hlf = new HLFComponents(orgName[0].value)
    let logs = '';

    switch (component) {
      case 'MINI':
        logs = await hlf.getMiniServerLogs(count);
        break;
      case 'CA_ORDERER':
        logs = await hlf.getOrdererCaServerLogs(count);
        break;
      case 'CA_PEER':
        logs = await hlf.getPeerCaServerLogs(count);
        break;
      case 'ORDERER':
        logs = await hlf.getOrdererLogs(count);
        break;
      case 'PEER':
        logs = await hlf.getPeerLogs(count);
        break;
      default:
        logs = 'hapi hapi hapi';
        break;
    }

    res.send({ message: "Done", details: logs })
  } catch (error: any) {
    res.send({ message: "Error", details: error.message })
  }
});

server.listen(8012, (): void => {
  console.log("Listening for coming request...");
})
