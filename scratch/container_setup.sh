docker run \
    --publish 8081:8081 \
    --publish 10250-10255:10250-10255 \
    --memory 3g --cpus=2.0 \
    --name=test-linux-emulator \
    --env AZURE_COSMOS_EMULATOR_PARTITION_COUNT=10 \
    --env AZURE_COSMOS_EMULATOR_ENABLE_DATA_PERSISTENCE=true \
    --env AZURE_COSMOS_EMULATOR_IP_ADDRESS_OVERRIDE=$ipaddr \
    --env AZURE_COSMOS_EMULATOR_ENABLE_MONGODB_ENDPOINT \
    --interactive \
    --tty \
    mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator
