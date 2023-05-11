import fss, { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import * as grpc from '@grpc/grpc-js';
import { TextDecoder } from "util";
import { Identity, Signer, signers, connect, Gateway, Contract, SubmittedTransaction, Network } from "@hyperledger/fabric-gateway";
// import { toAssetJSON } from "../helpers";
import { exec } from "child_process";


interface Asset {
    id: string,
    owner?: string,
    channelId?: string,
    ordererGeneralPort?: string,
    peerPort?: string
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

export async function getLogs(contract: Contract, start: string = "0", offset: string = "10"): Promise<any> {
    const resultBytes = await contract.evaluateTransaction('ReadLogs', start, offset);
    const resultJson = utf8Decoder.decode(resultBytes);

    console.log(resultJson)

    return JSON.parse(resultJson);
}

export async function readAssets(contract: Contract): Promise<any> {
    const resultBytes = await contract.evaluateTransaction('ReadPrivateAssets');
    const resultJson = utf8Decoder.decode(resultBytes);

    console.log(resultJson)

    return JSON.parse(resultJson);
}

export async function readAssetByID(contract: Contract, assetId: string): Promise<any> {
    const resultBytes = await contract.evaluateTransaction('ReadPrivateAsset', assetId);
    const resultJson = utf8Decoder.decode(resultBytes);

    console.log(resultJson)

    return JSON.parse(resultJson);
}

export async function readTransactions(contract: Contract): Promise<any> {
    const resultBytes = await contract.evaluateTransaction('ReadTransactions');
    const resultJson = utf8Decoder.decode(resultBytes);

    console.log(resultJson)

    return JSON.parse(resultJson);
}

export async function createAsset(contract: Contract, orgId: string, assetId: string, tags: string): Promise<any> {

    const committed = await contract.submit("CreatePrivateAsset", {
        arguments: [orgId, assetId, JSON.stringify(tags)]
    })

    const response = utf8Decoder.decode(committed);

    console.log({ response });

    return response
}

export async function transferAsset(contract: Contract, fromId: string, toId: string, transactionId: string, assetIds: string[], newOwnerMSP: string): Promise<any> {

    const commit: SubmittedTransaction = await contract.submitAsync('CreatePrivateTransaction', {
        arguments: [fromId, toId, transactionId, JSON.stringify(assetIds), newOwnerMSP],
    });

    const response = utf8Decoder.decode(commit.getResult());

    const status = await commit.getStatus();
    if (!status.successful) {
        throw new Error(`Transaction ${status.transactionId} failed to commit with status code ${status.code}`);
    }

    return response

}

export async function acceptAssetRequest(contract: Contract, transactionId: string): Promise<any> {

    const commit: SubmittedTransaction = await contract.submitAsync('AcceptTransaction', {
        arguments: [transactionId],
    });

    const oldOwner = utf8Decoder.decode(commit.getResult());

    const status = await commit.getStatus();

    if (!status.successful) {
        throw new Error(`Transaction ${status.transactionId} failed to commit with status code ${status.code}`);
    }

    return oldOwner

}

export async function transferNow(contract: Contract, transactionId: string): Promise<any> {

    const commit: SubmittedTransaction = await contract.submitAsync('TransferNow', {
        arguments: [transactionId],
    });

    const response = utf8Decoder.decode(commit.getResult());

    const status = await commit.getStatus();

    if (!status.successful) {
        throw new Error(`Transaction ${status.transactionId} failed to commit with status code ${status.code}`);
    }

    return response

}

export async function ownAsset(contract: Contract, transactionId: string): Promise<any> {

    const commit: SubmittedTransaction = await contract.submitAsync('OwnAsset', {
        arguments: [transactionId],
    });

    const oldOwner = utf8Decoder.decode(commit.getResult());

    const status = await commit.getStatus();

    if (!status.successful) {
        throw new Error(`Transaction ${status.transactionId} failed to commit with status code ${status.code}`);
    }

    return oldOwner

}

export async function updateAsset(contract: Contract, assetId: string, tags: string): Promise<any> {

    const commit: SubmittedTransaction = await contract.submitAsync('UpdatePrivateAsset', {
        arguments: [assetId, tags],
    });

    const oldOwner = utf8Decoder.decode(commit.getResult());

    const status = await commit.getStatus();

    if (!status.successful) {
        throw new Error(`Transaction ${status.transactionId} failed to commit with status code ${status.code}`);
    }

    return oldOwner

}

export async function removeAsset(contract: Contract, assetIds: string): Promise<any> {

    const commit: SubmittedTransaction = await contract.submitAsync('RemovePrivateAsset', {
        arguments: [assetIds],
    });

    const oldOwner = utf8Decoder.decode(commit.getResult());

    const status = await commit.getStatus();

    if (!status.successful) {
        throw new Error(`Transaction ${status.transactionId} failed to commit with status code ${status.code}`);
    }

    return oldOwner

}

export async function cancelTransaction(contract: Contract, transactionId: string): Promise<any> {

    const commit: SubmittedTransaction = await contract.submitAsync('CancelTransaction', {
        arguments: [transactionId],
    });

    const oldOwner = utf8Decoder.decode(commit.getResult());

    const status = await commit.getStatus();

    if (!status.successful) {
        throw new Error(`Transaction ${status.transactionId} failed to commit with status code ${status.code}`);
    }

    return oldOwner

}

export async function rejectTransaction(contract: Contract, transactionId: string): Promise<any> {

    const commit: SubmittedTransaction = await contract.submitAsync('RejectTransaction', {
        arguments: [transactionId],
    });

    const oldOwner = utf8Decoder.decode(commit.getResult());

    const status = await commit.getStatus();

    if (!status.successful) {
        throw new Error(`Transaction ${status.transactionId} failed to commit with status code ${status.code}`);
    }

    return oldOwner

}

export async function returnTransaction(contract: Contract, transactionId: string, reason: string): Promise<any> {

    const commit: SubmittedTransaction = await contract.submitAsync('ReturnTransaction', {
        arguments: [transactionId, reason],
    });

    const oldOwner = utf8Decoder.decode(commit.getResult());

    const status = await commit.getStatus();

    if (!status.successful) {
        throw new Error(`Transaction ${status.transactionId} failed to commit with status code ${status.code}`);
    }

    return oldOwner

}

export async function getBackAssets(contract: Contract, transactionId: string): Promise<any> {

    const commit: SubmittedTransaction = await contract.submitAsync('GetBackAssets', {
        arguments: [transactionId],
    });

    const oldOwner = utf8Decoder.decode(commit.getResult());

    const status = await commit.getStatus();

    if (!status.successful) {
        throw new Error(`Transaction ${status.transactionId} failed to commit with status code ${status.code}`);
    }

    return oldOwner

}

export async function pullAssets(contract: Contract, assetIds: string): Promise<any> {

    const commit: SubmittedTransaction = await contract.submitAsync('PullAssets', {
        arguments: [assetIds],
    });

    const oldOwner = utf8Decoder.decode(commit.getResult());

    const status = await commit.getStatus();

    if (!status.successful) {
        throw new Error(`Transaction ${status.transactionId} failed to commit with status code ${status.code}`);
    }

    return oldOwner

}

export async function pushAssets(contract: Contract, assets: string): Promise<any> {

    const commit: SubmittedTransaction = await contract.submitAsync('PushAssets', {
        arguments: [assets],
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
