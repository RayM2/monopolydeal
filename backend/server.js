const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const Redis = require("ioredis");
const GameRoom = require("./gameroom");
const cards = require("./cards");

// Get port from CLI arg (--port=8081) or env
let PORT = 8080; // default

const args = process.argv.slice(2);
for (const arg of args) {
  if (arg.startsWith("--port")) {
    const parts = arg.split("=");
    if (parts[1]) {
      PORT = parseInt(parts[1], 10);
    }
  }
}

if (process.env.PORT) {
  PORT = parseInt(process.env.PORT, 10);
}
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const redis = new Redis();       // normal Redis client
const sub = new Redis();         // subscriber for Pub/Sub

let gameRoom;

// Load game state from Redis on startup, or create new one
(async () => {
  let existingGame = await GameRoom.loadFromRedis(redis, "room1");
  if (existingGame) {
    console.log("Loaded game state from Redis");
    gameRoom = existingGame;
  } else {
    console.log("No saved game, starting new one");
    gameRoom = new GameRoom("room1");
    gameRoom.deck = [...cards];
    gameRoom.shuffleDeck?.();
    await gameRoom.saveToRedis(redis);
  }
})();

// Broadcast helper — now only sends to *local* clients
function localBroadcast(message) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// Publish helper — sends to Redis so all servers forward it
function publish(message) {
  redis.publish("game-events", JSON.stringify(message));
  localBroadcast(message); // also send to local clients
}

// Subscribe to Redis Pub/Sub
sub.subscribe("game-events", () => {
  console.log("Subscribed to Redis channel: game-events");
});

sub.on("message", (channel, rawMessage) => {
  if (channel !== "game-events") return;
  const message = JSON.parse(rawMessage);

  // Avoid double-sending to clients: only forward messages
  // that originated from *other* servers
  localBroadcast(message);
});

// Handle WebSocket connections
wss.on("connection", (ws) => {
  console.log("New client connected");

  ws.on("message", async (msg) => {
    const data = JSON.parse(msg);

    // --- Player joins ---
    if (data.type === "joinGame") {
      // Always reload latest state from Redis before mutating
      gameRoom = await GameRoom.loadFromRedis(redis, "room1");

      if (!gameRoom) {
        // If nothing in Redis yet, initialize a new one
        gameRoom = new GameRoom("room1");
        gameRoom.deck = [...cards];
        gameRoom.shuffleDeck?.();
      }

      // If this is the first player joining, initialize deck
      if (gameRoom.turnOrder.length === 0) {
        gameRoom.deck = [...cards];
        gameRoom.shuffleDeck?.();
      }

      gameRoom.addPlayer(data.playerId, ws);

      // Deal 5 initial cards
      for (let i = 0; i < 5; i++) {
        gameRoom.drawCard(data.playerId);
      }

      // Save updated state back to Redis
      await gameRoom.saveToRedis(redis);

      // Publish system update so all servers notify their clients
      publish({
        type: "system",
        text: `${data.playerId} joined`,
        players: Object.keys(gameRoom.players),
      });

      // Send this player their current hand
      ws.send(JSON.stringify({
        type: "handUpdate",
        hand: gameRoom.players[data.playerId].hand
      }));

      // If this is the first player, start turn order
      if (gameRoom.turnOrder.length === 1) {
        publish({ type: "turn", playerId: data.playerId });
      }
    }

    // --- Player draws a card ---
    if (data.type === "drawCard") {
      // Reload latest state
      gameRoom = await GameRoom.loadFromRedis(redis, "room1");

      const currentPlayer = gameRoom.turnOrder[gameRoom.currentTurnIndex];
      if (data.playerId !== currentPlayer) {
        ws.send(JSON.stringify({ type: "error", text: "Not your turn!" }));
        return;
      }

      const card = gameRoom.drawCard(data.playerId);
      await gameRoom.saveToRedis(redis);

      ws.send(JSON.stringify({ type: "cardDrawn", card }));
      ws.send(JSON.stringify({
        type: "handUpdate",
        hand: gameRoom.players[data.playerId].hand
      }));

      publish({ type: "system", text: `${data.playerId} drew a card` });
    }

    // --- Player plays a card ---
    if (data.type === "playCard") {
      // Reload latest state
      gameRoom = await GameRoom.loadFromRedis(redis, "room1");

      const currentPlayer = gameRoom.turnOrder[gameRoom.currentTurnIndex];
      if (data.playerId !== currentPlayer) {
        ws.send(JSON.stringify({ type: "error", text: "Not your turn!" }));
        return;
      }

      const card = gameRoom.playCard(data.playerId, data.cardIndex);
      if (!card) {
        ws.send(JSON.stringify({ type: "error", text: "Invalid card index" }));
        return;
      }

      const next = gameRoom.nextTurn();
      await gameRoom.saveToRedis(redis);

      publish({ type: "play", playerId: data.playerId, card });
      ws.send(JSON.stringify({
        type: "handUpdate",
        hand: gameRoom.players[data.playerId].hand
      }));
      publish({ type: "turn", playerId: next });
    }

    // --- Player banks a card ---
    if (data.type === "bankCard") {
  // Reload latest state
      gameRoom = await GameRoom.loadFromRedis(redis, "room1");

      const currentPlayer = gameRoom.turnOrder[gameRoom.currentTurnIndex];
      if (data.playerId !== currentPlayer) {
        ws.send(JSON.stringify({ type: "error", text: "Not your turn!" }));
        return;
      }

      const player = gameRoom.players[data.playerId];
      if (!player) return;

      const card = player.hand.splice(data.cardIndex, 1)[0];
      if (!card) {
        ws.send(JSON.stringify({ type: "error", text: "Invalid card index" }));
        return;
      }

      player.bank.push(card);
      await gameRoom.saveToRedis(redis);

      publish({
        type: "banked",
        playerId: data.playerId,
        card,
        bank: [...player.bank],
      });

      ws.send(JSON.stringify({
        type: "handUpdate",
        hand: gameRoom.players[data.playerId].hand
      }));

      const next = gameRoom.nextTurn();
      publish({ type: "turn", playerId: next });
    }

    // --- Reset game (admin/debug) ---
    if (data.type === "resetGame") {
      await redis.del("game:room1");

      gameRoom = new GameRoom("room1");
      gameRoom.deck = [...cards];
      gameRoom.shuffleDeck?.();
      await gameRoom.saveToRedis(redis);

      publish({ type: "system", text: "Game has been reset", players: [] });
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});

function startServer(port) {
  const s = server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });

  s.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`⚠️ Port ${port} is in use, trying ${port + 1}...`);
      startServer(port + 1);
    } else {
      throw err;
    }
  });
}



startServer(PORT);