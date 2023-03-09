import * as grpc from '@grpc/grpc-js';
import { Contract, Gateway } from '@hyperledger/fabric-gateway';
import * as path from 'path';
import { connectGrpc, newGrpcConnection, newIdentity, newSigner } from "./utils/blockchain";

const cryptoPath = path.resolve(process.cwd(), '..', 'organizations', 'peerOrganizations', 'empinoretailer.com');

export async function blockchainInit(channel: string = "mychannel"): Promise<[Gateway | undefined, grpc.Client | undefined, Contract | undefined] | undefined> {
    // TLS Connection
    let client = await newGrpcConnection(path.resolve(cryptoPath, 'peers', 'empinoretailer.com', 'tls', 'ca.crt'), "localhost:44259", "empinoretailer.com");

    // User Identity
    let identity = await newIdentity(path.resolve(cryptoPath, 'users', 'User1@empinoretailer.com', 'msp', 'signcerts', 'cert.pem'), "empinoretailerMSP");

    // Private Key
    let signer = await newSigner(path.resolve(cryptoPath, 'users', 'User1@empinoretailer.com', 'msp', 'keystore'))

    let gateway = connectGrpc(client, identity, signer);
    const network = gateway.getNetwork(channel);
    const contract = network.getContract("supplychain");

    console.log("Connected!")

    return [gateway, client, contract];
}