export const sleep = async (ms: number = 3000): Promise<unknown> => {
    return new Promise((resolve, reject) => {
        setTimeout(() => { resolve(true) }, ms);
    })
}