import { exec } from "child_process";
import { CA_ARG, ORDERER_ARG, PEER_ARG, PEER_ENV } from "./typdef";
import { scripts } from "./scripts";

export const createCa = ({ orgName, caPort, caOperationPort, caOrdererPort, caOrdererOperationPort }: CA_ARG): Promise<string> => {
    return new Promise((resolve, reject) => {
        exec(`${process.cwd()}/scripts/createCAServer.sh ${orgName} ${caPort} ${caOperationPort} ${caOrdererPort} ${caOrdererOperationPort}`, (error, stdout, stderror) => {
            if (error) reject(stderror);
            resolve("Done");
        })
    })
}

export const createOrderer = ({ orgName, general, admin, operations, caOrdererUsername, caOrdererPassword, caOrdererPort }: ORDERER_ARG): Promise<string> => {
    return new Promise((resolve, reject) => {
        console.log({ orgName, general, admin, operations, caOrdererUsername, caOrdererPassword, caOrdererPort });

        exec(`${process.cwd()}/scripts/createOrderer.sh ${orgName} ${general} ${admin} ${operations} ${caOrdererUsername} ${caOrdererPassword} ${caOrdererPort}`, (error, stdout, stderror) => {
            console.log(stdout);
            if (error) reject(stderror);
            resolve("Done");
        })
    })
}

export const createOrg = ({ orgName, username, password, peerPort, caPort }: PEER_ARG) => {
    return new Promise((resolve, reject) => {
        exec(`${process.cwd()}/scripts/initialize.sh  --on ${orgName} --ca-username admin --ca-password adminpw --ca-port ${caPort} --u ${username} --p ${password} --pport ${peerPort}`, (error, stdout, stderror) => {
            if (error) reject(stderror);
            resolve("Done");
        })
    })
}

export const generateCollectionsConfig = (msps: string[]) => {

}



export class Chaincode {
    getEnv: () => string
    setEnv: (key: string, value: string | number | boolean) => void
    env: string
    ORG_NAME: string

    constructor({ ORG_NAME, HOST, PORT }: PEER_ENV) {
        this.ORG_NAME = ORG_NAME;

        let env = {
            ORDERER_CA: `/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/ordererOrganizations/orderer.${ORG_NAME}.com/tlsca/tlsca.orderer.${ORG_NAME}.com-cert.pem`,
            FABRIC_CFG_PATH: "/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/config",
            CORE_PEER_LOCALMSPID: `${ORG_NAME}MSP`,
            CORE_PEER_TLS_ROOTCERT_FILE: `/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/${ORG_NAME}.com/tlsca/tlsca.${ORG_NAME}.com-cert.pem`,
            CORE_PEER_MSPCONFIGPATH: `/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/${ORG_NAME}.com/users/Admin@${ORG_NAME}.com/msp`,
            CORE_PEER_ADDRESS: `${HOST}:${PORT}`,
            CORE_PEER_TLS_ENABLED: true,
            HOST,
            PEER_PORT: PORT,
            ORG_NAME
        }

        let convertToEnvironment = (objects: object) => {
            let processEnv = "";
            for (let key in objects) {
                processEnv = processEnv.concat("-e", " ", key, "=", objects[key], " ");
            }
            return processEnv.trim();
        }

        this.getEnv = () => this.env;

        this.setEnv = (key: string, value: string | number | boolean) => {
            env = Object.assign(env, { [key]: value });
            this.env = convertToEnvironment(env);
        }

        this.env = convertToEnvironment(env);
    }

    packageChaincode(): Promise<string[]> {
        return new Promise((resolve, reject) => {
            exec(`docker exec ${this.env} cli.${this.ORG_NAME}.com ${scripts.packageChaincode}`, (error, stdout, stderror) => {
                if (error) reject(stderror);
                resolve(stdout.trim().split("\n"));
            })
        })
    }

    installChaincode(): Promise<string[]> {
        return new Promise((resolve, reject) => {
            exec(`docker exec ${this.env} cli.${this.ORG_NAME}.com sh -c '${scripts.installChaincode}'`, (error, stdout, stderror) => {
                if (error) reject(stderror);
                resolve(stdout.trim().split("\n"));
            })
        })
    }

    queryInstalled(): Promise<string[]> {
        return new Promise((resolve, reject) => {
            exec(`docker exec ${this.env} cli.${this.ORG_NAME}.com sh -c '${scripts.queryInstalledChaincode}'`, (error, stdout, stderror) => {
                if (error) reject(stderror);
                resolve(stdout.trim().split("\n"));
            })
        })
    }

    approveChaincode(): Promise<string[]> {
        return new Promise((resolve, reject) => {
            exec(`docker exec ${this.env} cli.${this.ORG_NAME}.com sh -c '${scripts.approveChaincode}'`, (error, stdout, stderror) => {
                if (error) reject(stderror);
                resolve(stdout.trim().split("\n"));
            })
        })
    }

    checkCommitReadiness(): Promise<string[]> {
        return new Promise((resolve, reject) => {
            exec(`docker exec ${this.env} cli.${this.ORG_NAME}.com sh -c '${scripts.getCommitReadiness}'`, (error, stdout, stderror) => {
                if (error) reject(stderror);
                resolve(stdout.trim().split("\n"));
            })
        })
    }

    commitChaincode(): Promise<string[]> {
        return new Promise((resolve, reject) => {
            exec(`docker exec ${this.env} cli.${this.ORG_NAME}.com sh -c '${scripts.commitChaincode}'`, (error, stdout, stderror) => {
                if (error) reject(stderror);
                resolve(stdout.trim().split("\n"));
            })
        })
    }

    initializeChaincode(): Promise<string[]> {
        return new Promise((resolve, reject) => {
            exec(`docker exec ${this.env} cli.${this.ORG_NAME}.com sh -c '${scripts.initializeChaincode}'`, (error, stdout, stderror) => {
                console.log(error, stderror)
                if (error) reject(stderror);
                resolve(stdout.trim().split("\n"));
            })
        })
    }

}
