import { exec } from "child_process";
import express, { NextFunction } from "express";
import cors from "cors";
import getPort from "./getPort";
import sql3, { sqlite3 } from "sqlite3";
import { createCa, createOrderer, createOrg } from "./utils/shell";
import { sleep } from "./utils/general";
import https from "https";
import fs from "fs";
import axios from "axios";
import DB_Config from "./utils/db";

const app = express();

app.use(cors({
  origin: "*"
}))

app.use(express.static("public"));

app.use(express.json());

const sqlite3 = sql3.verbose();

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


  exec(`${process.cwd()}/../scripts/createNewChannel.sh ${channelId} ${channelToMSP} ${orgName} ${peer[0].value} ${admin[0].value} ${general[0].value}`, (error, stdout, stderror) => {
    if (error) return res.send({ message: "Error creating the channel", details: stderror, status: "error" });
    res.send({ message: "Done" })
  })

})

// Get all channels that peer joined in
app.get("/channels", async (req: express.Request, res: express.Response, next: NextFunction): Promise<void> => {
  const { orgName } = req.query;

  const peer = await DB.getValueByName("PEER_PORT");

  exec(`${process.cwd()}/../scripts/getChannels.sh ${orgName} ${peer[0].value}`, (error, stdout, stderror) => {
    try {
      if (error) return res.send({ message: "Getting channels error", details: stderror, status: "error" });

      const message = stdout.split(":")[1].trim().split(" ");

      res.send({ message });
    } catch (error: Error | any) {
      res.status(500).send({ message: error.message })
    }
  })
})

app.post("/joinOrg", async (req: express.Request, res: express.Response): Promise<void> => {

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

    exec(`${process.cwd()}/../scripts/getChannelConfig.sh ${orgName} ${peer[0].value} ${channelId} ${general[0].value}`, (error, stdout, stderr) => {
      if (error) throw new Error(stderr);

      res.send({ message: "Done", details: { config: fs.readFileSync(`${process.cwd()}/../channel-artifacts/config_block.pb`), ordererTlsCa: fs.readFileSync(`${process.cwd()}/../organizations/ordererOrganizations/orderer.${orgName}.com/tlsca/tlsca.orderer.${orgName}.com-cert.pem`) } })
    })

  } catch (err: any) {
    res.send({ message: "Error", details: "Getting configuration failed" })
  }

})

app.post("/receiveChannelConfig", async (req, res) => {
  const { channelConfig, ordererTlsCa, orgName, otherOrgName, channelId } = req.body;

  fs.writeFileSync(`${process.cwd()}/../channel-artifacts/config_bloc.pb`, channelConfig);

  fs.mkdirSync(`${process.cwd()}/../orderer`);

  fs.writeFileSync(`${process.cwd()}/../orderer/tlsca.orderer.${orgName}.com-cert.pem`, ordererTlsCa);

  const peer = await DB.getValueByName("PEER_PORT")
  const general = await DB.getValueByName("ORDERER_GENERAL_PORT")

  exec(`${process.cwd()}/../scripts/addOrgInChannel.sh ${orgName} ${otherOrgName} ${peer[0].value} ${channelId} ${general[0].value}`, (error, stdout, stderror) => {
    if (error) return res.send({ message: "Error", details: stderror })
    res.send({ message: "Done", details: "Received" })
  })

});

app.post("/signAndUpdateChannel", async (req, res) => {
  const { orgName, channelId, updateBlock } = req.body;

  const peer = await DB.getValueByName("PEER_PORT");
  const general = await DB.getValueByName("ORDERER_GENERAL_PORT");

  fs.writeFileSync(`${process.cwd()}/../channel-artifacts/_update_in_envelope.pb`, Buffer.from(updateBlock))

  exec(`${process.cwd()}/../scripts/updateChannel.sh ${orgName} ${peer[0].value} ${channelId} ${general[0].value}`, (error, stdout, stderror) => {
    if (error) return res.send({ message: "Error", details: stderror })
    res.send({ message: "Done", details: { block: fs.readFileSync(`${process.cwd()}/../channel-artifacts/_update_in_envelope.pb`), ordererGeneralPort: general[0].value } })
  })

});

app.listen(8012, (): void => {
  console.log("Listening for coming request...");
})
