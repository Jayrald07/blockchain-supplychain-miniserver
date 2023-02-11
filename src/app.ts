import { exec } from "child_process";
import express, { NextFunction } from "express";
import cors from "cors";
import getPort from "./getPort";


const app = express();


app.use(cors({
  origin: "*"
}))
app.use(express.static("public"));

app.use(express.json());

// This will be used for connecting the peer to main system to check if it is working and legit
app.get("/ping", async (req: express.Request, res: express.Response, next: NextFunction) => {

  res.send({ message: "Done", details: "pong", test: await getPort({}) });
});

app.post("/initialize", async (req: express.Request, res) => {
  const { orgName, username, password, msp } = req.body;

  let port = await getPort({});
  let [operations, admin, general] = [await getPort({}), await getPort({}), await getPort({}),];

  exec(`${process.cwd()}/../scripts/initialize.sh --on ${orgName} --ca-username admin --ca-password adminpw --ca-port 6054 --u ${username} --p ${password} --pport ${port} --msp ${msp}`, (error, stdout, stderror) => {
    if (error) return res.send({ message: "Error initializing the peer", details: stderror, status: "error" });
    exec(`${process.cwd()}/../scripts/createOrderer.sh ${msp} ${general} ${admin} ${operations}`, (error, stdout, stderror) => {
      if (error) return res.send({ message: "Error initializing the peer", details: stderror, status: "error" });
      res.send({ message: "Done", details: { stdout, peerPort: port, ordererPorts: { general, admin, operations } } })
    })
  })
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

app.get("/", (req, res) => {
  res.sendFile(`${process.cwd}/public/index.html`);
})

// app.use((error: Error, req: express.Request, res: express.Response) => {
//   if (error) res.status(500).send({ message: error.message })
// })

app.listen(8012, (): void => {
  console.log("Listening for coming request...");
});
