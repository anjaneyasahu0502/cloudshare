const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");

const dynamodb = new DynamoDBClient({
    region: process.env.AWS_REGION
});

module.exports = dynamodb;