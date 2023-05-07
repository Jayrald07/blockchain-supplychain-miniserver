import * as grpc from '@grpc/grpc-js';
import { Contract, Gateway } from '@hyperledger/fabric-gateway';
import * as path from 'path';
import { connectGrpc, newGrpcConnection, newIdentity, newSigner } from "./utils/blockchain";


export async function blockchainInit(channel: string = "mychannel", orgName: string, peerPort: string, host: string): Promise<[Gateway | undefined, grpc.Client | undefined, Contract | undefined] | undefined> {
    const cryptoPath = path.resolve(process.cwd(), 'organizations', 'peerOrganizations', `${orgName}.com`);
    // TLS Connection
    let client = await newGrpcConnection(path.resolve(cryptoPath, 'peers', `${orgName}.com`, 'tls', 'ca.crt'), `${host}:${peerPort}`, `${host}`);

    // User Identity
    let identity = await newIdentity(path.resolve(cryptoPath, 'users', `Admin@${orgName}.com`, 'msp', 'signcerts', 'cert.pem'), `${orgName}MSP`);

    // Private Key
    let signer = await newSigner(path.resolve(cryptoPath, 'users', `Admin@${orgName}.com`, 'msp', 'keystore'))

    let gateway = connectGrpc(client, identity, signer);
    const network = gateway.getNetwork(channel);
    const contract = network.getContract("supplychain");

    console.log("Connected!")

    return [gateway, client, contract];
}