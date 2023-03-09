export type CA_ARG = {
    orgName: string;
    caPort: number;
    caOperationPort: number;
    caOrdererPort: number;
    caOrdererOperationPort: number;
}

export type ORDERER_ARG = {
    orgName: string;
    general: number;
    admin: number;
    operations: number;
    caOrdererUsername: string;
    caOrdererPassword: string;
    caOrdererPort: number
}

export type PEER_ARG = {
    orgName: string;
    username: string;
    password: string;
    peerPort: string;
    caPort: string;
}

export type PEER_ENV = {
    ORG_NAME: string;
    HOST: string;
    PORT: number;
}