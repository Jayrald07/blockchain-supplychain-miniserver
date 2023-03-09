import fss, { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import * as grpc from '@grpc/grpc-js';
import { TextDecoder } from "util";
import { Identity, Signer, signers, connect, Gateway, Contract, SubmittedTransaction, Network } from "@hyperledger/fabric-gateway";
// import { toAssetJSON } from "../helpers";

interface Asset {
    color: string
    id: string
    owner: string
    size: string
    // doctype: string
}

enum RESPONSE {
    OK = 1,
    ERROR
}

const utf8Decoder = new TextDecoder();

export async function newGrpcConnection(tlsCertPath: fss.PathLike, peerEndpoint: string, peerHostAlias: string): Promise<grpc.Client> {
    const tlsRootCert: Buffer = await fs.readFile(tlsCertPath);
    const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
    return new grpc.Client(peerEndpoint, tlsCredentials, {
        'grpc.ssl_target_name_override': peerHostAlias,
    });
}

export async function newIdentity(certPath: string, mspId: string): Promise<Identity> {
    const credentials = await fs.readFile(certPath);
    return { mspId, credentials };
}

export async function newSigner(keyDirectoryPath: string): Promise<Signer> {
    const files = await fs.readdir(keyDirectoryPath);
    const keyPath = path.resolve(keyDirectoryPath, files[0]);
    const privateKeyPem = await fs.readFile(keyPath);
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    return signers.newPrivateKeySigner(privateKey);
}

export function connectGrpc(client: grpc.Client, identity: Identity, signer: Signer): Gateway {
    return connect({
        client,
        identity,
        signer,
        evaluateOptions: () => {
            return { deadline: Date.now() + 5000 };
        },
        endorseOptions: () => {
            return { deadline: Date.now() + 15000 };
        },
        submitOptions: () => {
            return { deadline: Date.now() + 5000 };
        },
        commitStatusOptions: () => {
            return { deadline: Date.now() + 60000 };
        },
    })
}

export async function readAssetByID(contract: Contract, ID: string): Promise<JSON> {
    const resultBytes = await contract.evaluateTransaction('ReadAssetPrivateDetails', ID);
    const resultJson = utf8Decoder.decode(resultBytes);

    console.log(resultJson)

    return JSON.parse(resultJson);
}

export async function createAsset(contract: Contract, data: Asset | { id: string, color: string, size: string, owner: string }): Promise<Asset | { id: string, color: string, size: string, owner: string }> {
    const { id, color, size, owner } = data;

    await contract.submit("CreatePrivateData", {
        transientData: { asset_properties: JSON.stringify({ color, owner, size, assetID: id }) }
    })

    return data
}

export async function transferAsset(contract: Contract, ID: string, owner: string): Promise<any> {

    const commit: SubmittedTransaction = await contract.submitAsync('TransferAssetRequest', {
        arguments: [ID, "empinodistributorMSP", "1000"],
    });

    const oldOwner = utf8Decoder.decode(commit.getResult());

    const status = await commit.getStatus();
    if (!status.successful) {
        throw new Error(`Transaction ${status.transactionId} failed to commit with status code ${status.code}`);
    }

    return oldOwner

}

export async function acceptAssetRequest(contract: Contract, ID: string): Promise<any> {

    const commit: SubmittedTransaction = await contract.submitAsync('AcceptAssetRequest', {
        arguments: [ID],
    });

    const oldOwner = utf8Decoder.decode(commit.getResult());

    const status = await commit.getStatus();
    if (!status.successful) {
        throw new Error(`Transaction ${status.transactionId} failed to commit with status code ${status.code}`);
    }

    return oldOwner

}

export async function transferNow(contract: Contract, ID: string): Promise<any> {

    const commit: SubmittedTransaction = await contract.submitAsync('TransferNow', {
        arguments: [ID],
    });

    const oldOwner = utf8Decoder.decode(commit.getResult());

    const status = await commit.getStatus();
    if (!status.successful) {
        throw new Error(`Transaction ${status.transactionId} failed to commit with status code ${status.code}`);
    }

    return oldOwner

}

export async function ownAsset(contract: Contract, ID: string): Promise<any> {

    const commit: SubmittedTransaction = await contract.submitAsync('OwnAsset', {
        arguments: [ID],
    });

    const oldOwner = utf8Decoder.decode(commit.getResult());

    const status = await commit.getStatus();
    if (!status.successful) {
        throw new Error(`Transaction ${status.transactionId} failed to commit with status code ${status.code}`);
    }

    return oldOwner

}


export async function closeGRPCConnection(gateway: Gateway, client: grpc.Client): Promise<RESPONSE> {
    gateway.close();
    client.close();
    return RESPONSE.OK
}
