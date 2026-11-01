const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map();
const queue = [];

app.get("/", (req, res) => {
  res.send("ENERGY GODS ONLINE SERVER");
});

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function removeFromQueue(ws) {
  const index = queue.indexOf(ws);
  if (index !== -1) queue.splice(index, 1);
}

function leaveRoom(ws) {
  removeFromQueue(ws);

  const code = ws.roomCode;
  if (!code) return;

  const room = rooms.get(code);
  ws.roomCode = null;

  if (!room) return;

  room.players = room.players.filter(p => p !== ws);

  for (const player of room.players) {
    player.roomCode = null;
    send(player, { type: "opponent_left" });
  }

  rooms.delete(code);
}

function createCode() {
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(code));
  return code;
}

function connectPlayers(a, b, code) {
  removeFromQueue(a);
  removeFromQueue(b);

  rooms.set(code, { players: [a, b] });
  a.roomCode = code;
  b.roomCode = code;

  send(a, { type: "match_found", roomCode: code, role: "player1" });
  send(b, { type: "match_found", roomCode: code, role: "player2" });
}

wss.on("connection", ws => {
  ws.roomCode = null;
  ws.playerId = crypto.randomUUID();

  send(ws, { type: "connected" });

  ws.on("message", raw => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "create_room") {
      leaveRoom(ws);
      const code = createCode();
      rooms.set(code, { players: [ws] });
      ws.roomCode = code;
      send(ws, { type: "room_created", roomCode: code });
      return;
    }

    if (msg.type === "join_room") {
      const code = String(msg.code || "").trim();
      const room = rooms.get(code);

      if (!/^\d{6}$/.test(code) || !room || room.players.length >= 2) {
        send(ws, { type: "error", message: "Комната не найдена или уже заполнена" });
        return;
      }

      leaveRoom(ws);
      connectPlayers(room.players[0], ws, code);
      return;
    }

    if (msg.type === "find_match") {
      leaveRoom(ws);

      const index = queue.findIndex(
        p => p !== ws && p.readyState === WebSocket.OPEN
      );

      if (index !== -1) {
        const opponent = queue.splice(index, 1)[0];
        connectPlayers(opponent, ws, createCode());
      } else {
        queue.push(ws);
        send(ws, { type: "searching" });
      }
      return;
    }

    if (msg.type === "cancel_search") {
      removeFromQueue(ws);
      send(ws, { type: "search_cancelled" });
      return;
    }

    if (msg.type === "state") {
      if (!ws.roomCode) return;

      const s = msg.state || {};
      const safeState = {
        x: Number(s.x) || 0,
        y: Number(s.y) || 0,
        face: s.face < 0 ? -1 : 1,
        pose: String(s.pose || "idle").slice(0, 24),
        hp: Math.max(0, Math.min(100, Number(s.hp) || 0)),
        nick: String(s.nick || "Player").slice(0, 18),
        avatar: String(s.avatar || "😎").slice(0, 4)
      };

      const room = rooms.get(ws.roomCode);
      const opponent = room && room.players.find(p => p !== ws);
      send(opponent, { type: "opponent_state", state: safeState });
      return;
    }

    if (msg.type === "hit") {
      if (!ws.roomCode) return;

      const damage = Math.max(1, Math.min(25, Number(msg.damage) || 1));
      const knock = Math.max(-180, Math.min(180, Number(msg.knock) || 0));

      const room = rooms.get(ws.roomCode);
      const opponent = room && room.players.find(p => p !== ws);
      send(opponent, { type: "hit", damage, knock });
      return;
    }

    if (msg.type === "leave_room") {
      leaveRoom(ws);
    }
  });

  ws.on("close", () => {
    leaveRoom(ws);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("ENERGY GODS server started on " + PORT);
});
