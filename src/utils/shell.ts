import { exec } from "child_process";
import { CA_ARG, ORDERER_ARG, PEER_ARG } from "../typdef";

export const createCa = ({ orgName, caPort, caOperationPort, caOrdererPort, caOrdererOperationPort }: CA_ARG): Promise<string> => {
    return new Promise((resolve, reject) => {
        exec(`${process.cwd()}/../scripts/createCAServer.sh ${orgName} ${caPort} ${caOperationPort} ${caOrdererPort} ${caOrdererOperationPort}`, (error, stdout, stderror) => {
            if (error) reject(stderror);
            resolve("Done");
        })
    })
}

export const createOrderer = ({ orgName, general, admin, operations, caOrdererUsername, caOrdererPassword, caOrdererPort }: ORDERER_ARG): Promise<string> => {
    return new Promise((resolve, reject) => {
        console.log({ orgName, general, admin, operations, caOrdererUsername, caOrdererPassword, caOrdererPort });

        exec(`${process.cwd()}/../scripts/createOrderer.sh ${orgName} ${general} ${admin} ${operations} ${caOrdererUsername} ${caOrdererPassword} ${caOrdererPort}`, (error, stdout, stderror) => {
            console.log(stdout);
            if (error) reject(stderror);
            resolve("Done");
        })
    })
}

export const createOrg = ({ orgName, username, password, peerPort, caPort }: PEER_ARG) => {
    return new Promise((resolve, reject) => {
        exec(`${process.cwd()}/../scripts/initialize.sh  --on ${orgName} --ca-username admin --ca-password adminpw --ca-port ${caPort} --u ${username} --p ${password} --pport ${peerPort}`, (error, stdout, stderror) => {
            if (error) reject(stderror);
            resolve("Done");
        })
    })
}