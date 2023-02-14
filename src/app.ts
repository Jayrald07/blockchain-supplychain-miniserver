import { exec } from "child_process";
import express, { NextFunction } from "express";
import cors from "cors";
import getPort from "./getPort";
import sql3, { sqlite3 } from "sqlite3";
import { createCa, createOrderer, createOrg } from "./utils/shell";
import { sleep } from "./utils/general";

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
      console.log("Config table fetched!")

      if (!rows.length) {
        let stmt = db.prepare("INSERT INTO config VALUES(?,?)");
        stmt.run("SETUP", "processing");
        stmt.finalize();
      }
    })
  })

})

app.set("db", db);


// This will be used for connecting the peer to main system to check if it is working and legit
app.get("/ping", async (req: express.Request, res: express.Response, next: NextFunction) => {
  res.send({ message: "Done", details: "pong" });
});

app.post("/initialize", async (req: express.Request, res) => {
  const { orgName, username, password, msp, id } = req.body;

  let port = await getPort({});
  let [operations, admin, general] = [await getPort({}), await getPort({}), await getPort({})];
  let [caPort, caOperationPort, caOrdererPort, caOrdererOperationPort] = [await getPort({}), await getPort({}), await getPort({}), await getPort({})]

  try {

    await createCa({ orgName, caPort, caOperationPort, caOrdererPort, caOrdererOperationPort });

    await sleep(2000);

    await createOrderer({ orgName, general, admin, operations, caOrdererUsername: "admin", caOrdererPassword: "adminpw", caOrdererPort });

    await sleep(2000);

    await createOrg({ orgName, username, password, peerPort: port, caPort })

    let db: sql3.Database = app.get("db")
    db.serialize(function () {
      let stmt = db.prepare("INSERT INTO config VALUES(?,?)");
      stmt.run("ID", id);
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
  const { channelId, msp, orgName, peerPort, channelToMSP, ordererAdminPort, ordererGeneralPort } = req.body;

  exec(`${process.cwd()}/../scripts/createNewChannel.sh ${channelId} ${msp} ${channelToMSP} ${orgName} ${peerPort} ${ordererAdminPort} ${ordererGeneralPort}`, (error, stdout, stderror) => {
    console.log(stdout, stderror)
    if (error) return res.send({ message: "Error creating the channel", details: stderror, status: "error" });
    res.send({ message: "Done" })
  })

})

// Get all channels that peer joined in
app.get("/channels", async (req: express.Request, res: express.Response, next: NextFunction): Promise<void> => {
  const { msp, orgName, peerPort } = req.query;

  exec(`${process.cwd()}/../scripts/getChannels.sh ${msp} ${orgName} ${peerPort}`, (error, stdout, stderror) => {
    try {
      console.log(stdout)
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
      console.log(rows);
      res.send({ message: "Done", details: rows })
    })
  })

})

// app.use((error: Error, req: express.Request, res: express.Response) => {
//   if (error) res.status(500).send({ message: error.message })
// })

app.listen(8012, (): void => {
  console.log("Listening for coming request...");
});
