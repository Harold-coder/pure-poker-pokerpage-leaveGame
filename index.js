const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const tableName = process.env.GAME_TABLE;
const connectionsTableName = process.env.CONNECTIONS_TABLE;
const apiGatewayManagementApi = new AWS.ApiGatewayManagementApi({
    endpoint: process.env.WEBSOCKET_ENDPOINT
});

exports.handler = async (event) => {
    const { gameId, playerId } = JSON.parse(event.body);
    const connectionId = event.requestContext.connectionId;

    try {
        // Retrieve the game session by gameId
        const gameSessionResponse = await dynamoDb.get({
            TableName: tableName,
            Key: { gameId },
        }).promise();

        let gameSession = gameSessionResponse.Item;

        if (!gameSession) {
            return { statusCode: 404, body: JSON.stringify({ message: "Game session not found." }) };
        }

        // Remove the player from the game session
        gameSession.players = gameSession.players.filter(player => player.id !== playerId);
        gameSession.playerCount = gameSession.players.length;

        // Update the game session
        await dynamoDb.update({
            TableName: tableName,
            Key: { gameId },
            UpdateExpression: 'SET players = :players, playerCount = :playerCount',
            ExpressionAttributeValues: {
                ':players': gameSession.players,
                ':playerCount': gameSession.playerCount,
            },
            ReturnValues: 'ALL_NEW',
        }).promise();

        // Notify all players about the player leaving
        const postCalls = gameSession.players.map(async ({ id }) => {
            if (id !== playerId) {
                // Retrieve connectionId for each player
                const connectionData = await dynamoDb.get({
                    TableName: connectionsTableName,
                    Key: { playerId: id },
                }).promise();
                
                // Notify player about the update
                await apiGatewayManagementApi.postToConnection({
                    ConnectionId: connectionData.Item.connectionId,
                    Data: JSON.stringify({
                        action: 'playerLeft',
                        message: `Player ${playerId} has left the game.`,
                        gameDetails: gameSession
                    }),
                }).promise();
            }
        });

        await Promise.all(postCalls);

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Player has left the game." }),
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Failed to leave game" }),
        };
    }
};
