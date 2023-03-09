export let scripts = {
    packageChaincode: (version: string) => `peer lifecycle chaincode package mychannel.tar.gz --path /opt/gopath/src/github.com/hyperledger/fabric/peer/organizations --lang node --label mychannel_v${version}`,
    installChaincode: () => "peer lifecycle chaincode install /opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/mychannel.tar.gz",
    queryInstalledChaincode: () => "peer lifecycle chaincode queryinstalled"
}