const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const gameTableName = process.env.GAME_TABLE;
const connectionsTableName = process.env.CONNECTIONS_TABLE;
const apiGatewayManagementApi = new AWS.ApiGatewayManagementApi({
    endpoint: process.env.WEBSOCKET_ENDPOINT
});
console.log("WebSocket Endpoint:", process.env.WEBSOCKET_ENDPOINT);


async function getGameState(gameId) {
    const params = {
        TableName: gameTableName,
        Key: { gameId },
    };
    const { Item } = await dynamoDb.get(params).promise();
    return Item;
}

async function notifyAllPlayers(gameId, game) {
    // Retrieve all connection IDs for this game from the connections table
    const connectionData = await dynamoDb.scan({ TableName: connectionsTableName, FilterExpression: "gameId = :gameId", ExpressionAttributeValues: { ":gameId": gameId } }).promise();
    const postCalls = connectionData.Items.map(async ({ connectionId }) => {
        await apiGatewayManagementApi.postToConnection({ 
            ConnectionId: connectionId,
             Data: JSON.stringify({
                game: game,
                action: "leaveGame",
                statusCode: 200
            }) 
        }).promise();
    });
    await Promise.all(postCalls);
}

async function saveGameState(gameId, gameSession) {
    const params = {
        TableName: gameTableName,
        Key: { gameId },
        UpdateExpression: 'SET players = :players, playerCount = :playerCount, currentTurn = :currentTurn', // Include currentTurn if you're updating it
        ExpressionAttributeValues: {
            ':players': gameSession.players,
            ':playerCount': gameSession.playerCount,
            ':currentTurn': gameSession.currentTurn, // Make sure to update this value if you've changed the current turn
        },
        ReturnValues: 'ALL_NEW'
    };
    await dynamoDb.update(params).promise();
}

exports.handler = async (event) => {
    const { gameId, playerId } = JSON.parse(event.body);
    const connectionId = event.requestContext.connectionId;
    console.log(gameId);
    console.log(playerId)

    try {
        const gameSession = await getGameState(gameId);
        if (!gameSession) {
            console.error(`Game with ID ${gameId} not found`);
            throw new Error('Game not found');
        }

        if (!gameSession) {
            console.error(`Game with ID ${gameId} not found`);
            throw new Error('Game not found');
        }

        gameSession.players = gameSession.players.filter(player => player.id !== playerId);
        gameSession.playerCount = gameSession.players.length;

        const playerIndex = game.players.findIndex(p => p.id === playerId);
        if (game.players[playerIndex].position === game.currentTurn) {
            gameSession.currentTurn = (gameSession.currentTurn + 1)%gameSession.playerCount 
        }

        await saveGameState(gameId, game);
        await notifyAllPlayers(gameId, game);

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Player has left the game." }),
        };
    } catch (error) {
        console.error('Error processing playerLeave:', error);
        await apiGatewayManagementApi.postToConnection({
            ConnectionId: connectionId,
            Data: JSON.stringify({ error: error.message })
        }).promise();

        return { statusCode: 500, body: JSON.stringify({ message: error.message }) };
    }
};
