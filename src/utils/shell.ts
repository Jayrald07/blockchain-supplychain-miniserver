import { exec } from "child_process";
import { CA_ARG, ORDERER_ARG, PEER_ARG, PEER_ENV } from "./typdef";

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

export class Chaincode {
    getProperty: Function
    ORG_NAME = ""
    HOST = ""
    PORT = Infinity
    constructor({ ORG_NAME, HOST, PORT }: PEER_ENV) {
        this.ORG_NAME = ORG_NAME;
        this.HOST = HOST
        this.PORT = PORT

        let ORDERER_CA = `${process.cwd()}/../organizations/ordererOrganizations/orderer.${ORG_NAME}.com/tlsca/tlsca.orderer.${ORG_NAME}.com-cert.pem`,
            FABRIC_CFG_PATH = `${process.cwd()}/../config`,
            CORE_PEER_LOCALMSPID = `${ORG_NAME}MSP`,
            CORE_PEER_TLS_ROOTCERT_FILE = `${process.cwd()}/../organizations/peerOrganizations/${ORG_NAME}.com/tlsca/tlsca.${ORG_NAME}.com-cert.pem`,
            CORE_PEER_MSPCONFIGPATH = `${process.cwd()}/../organizations/peerOrganizations/${ORG_NAME}.com/users/Admin@${ORG_NAME}.com/msp`,
            CORE_PEER_ADDRESS = `${HOST}:${PORT}`,
            CORE_PEER_TLS_ENABLED = true

        this.getProperty = () => {
            return {
                ORDERER_CA,
                FABRIC_CFG_PATH,
                CORE_PEER_LOCALMSPID,
                CORE_PEER_TLS_ROOTCERT_FILE,
                CORE_PEER_MSPCONFIGPATH,
                CORE_PEER_ADDRESS,
                CORE_PEER_TLS_ENABLED
            }
        }
    }

    getProps() {
        return this.getProperty()
    }

    packageChaincode() {
        return new Promise((resolve, reject) => {
            let props = this.getProperty();

            exec(`docker exec `, {
                env: {
                    ...process.env,
                    ...props
                }
            }, (error, stdout, stderror) => {
                if (error) reject(stderror);
                resolve(stdout.trim().split("\n"));
            })
        })
    }

}
