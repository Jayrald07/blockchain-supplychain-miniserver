import { createMessage, encrypt, readKey } from "openpgp";

export const sleep = async (ms: number = 3000): Promise<unknown> => {
    return new Promise((resolve, reject) => {
        setTimeout(() => { resolve(true) }, ms);
    })
}

export const encryptData = async (publicKey: string, data: string) => {
    const pkey = await readKey({ armoredKey: publicKey });

    const readableStream = new ReadableStream({
        start(controller) {
            controller.enqueue(data);
            controller.close();
        }
    });

    const encrypted: any = await encrypt({
        message: await createMessage({ text: readableStream }),
        encryptionKeys: pkey
    })

    const reader = encrypted.getReader();
    let enc = "";
    for (; ;) {
        let value = await reader.read();
        if (value.done) break;
        enc += value.value
    }

    return enc;
}