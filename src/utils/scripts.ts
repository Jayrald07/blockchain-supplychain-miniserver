export let scripts = {
    packageChaincode: "peer lifecycle chaincode package mychannel.tar.gz --path ./organizations --lang node --label mychannel_v${version}",
    installChaincode: "peer lifecycle chaincode install ./organizations/mychannel.tar.gz",
    queryInstalledChaincode: "peer lifecycle chaincode queryinstalled",
    approveChaincode: "peer lifecycle chaincode approveformyorg -o $ORDERER_HOST:$ORDERER_GENERAL_PORT --tls --cafile $ORDERER_CA --name $CHAINCODE_NAME --channelID $CHANNEL_ID --version $VERSION --package-id $(peer lifecycle chaincode calculatepackageid ./organizations/mychannel.tar.gz) --sequence $SEQUENCE --waitForEvent --init-required --collections-config ./organizations/collections_config.json",
    getCommitReadiness: "peer lifecycle chaincode checkcommitreadiness --channelID $CHANNEL_ID --name $CHAINCODE_NAME --version $VERSION --sequence $SEQUENCE --output json --init-required --collections-config ./organizations/collections_config.json",
    commitChaincode: "peer lifecycle chaincode commit -o $ORDERER_HOST:$ORDERER_GENERAL_PORT --tls --cafile $ORDERER_CA --channelID $CHANNEL_ID --name $CHAINCODE_NAME --peerAddresses $HOST:$PEER_PORT --tlsRootCertFiles ./organizations/peerOrganizations/$ORG_NAME.com/peers/$ORG_NAME.com/tls/ca.crt --peerAddresses $EXTERNAL_HOST:$EXTERNAL_PEER_PORT --tlsRootCertFiles ./organizations/channel-artifacts/ca.crt --version $VERSION --sequence $SEQUENCE --init-required --collections-config ./organizations/collections_config.json",
    initializeChaincode: `peer chaincode invoke -o $ORDERER_HOST:$ORDERER_GENERAL_PORT --tls --cafile $ORDERER_CA -C $CHANNEL_ID -n $CHAINCODE_NAME --peerAddresses $HOST:$PEER_PORT --tlsRootCertFiles "./organizations/peerOrganizations/$ORG_NAME.com/peers/$ORG_NAME.com/tls/ca.crt" --peerAddresses $EXTERNAL_HOST:$EXTERNAL_PEER_PORT --tlsRootCertFiles "./organizations/channel-artifacts/ca.crt" --isInit -c \\{\\"Function\\":\\"InitLedger\\",\\"Args\\":[]\\}`
}