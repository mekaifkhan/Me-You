import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  const PORT = 3000;

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", rooms: rooms.size });
  });

  // Store rooms: { pin: [socketId1, socketId2] }
  const rooms = new Map<string, string[]>();

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.onAny((event, ...args) => {
      console.log(`Event: ${event}`, args);
    });

    socket.on("create-room", (pin: string) => {
      if (rooms.has(pin)) {
        socket.emit("error", "Room already exists");
        return;
      }
      rooms.set(pin, [socket.id]);
      socket.join(pin);
      socket.emit("room-created", pin);
      console.log(`Room created: ${pin} by ${socket.id}`);
    });

    socket.on("join-room", (pin: string) => {
      console.log(`Join attempt: ${socket.id} for PIN: ${pin}`);
      const room = rooms.get(pin);
      if (!room) {
        socket.emit("error", "Room not found");
        return;
      }
      if (room.length >= 2) {
        socket.emit("error", "Room is full");
        return;
      }
      room.push(socket.id);
      socket.join(pin);
      io.to(pin).emit("user-connected", { pin, users: room });
      console.log(`User ${socket.id} joined room: ${pin}`);
    });

    socket.on("send-message", (data: { pin: string; text: string; sender: string }) => {
      socket.to(data.pin).emit("receive-message", data);
    });

    // WebRTC signaling
    socket.on("call-user", (data: { pin: string; offer: any; type: 'voice' | 'video' }) => {
      socket.to(data.pin).emit("incoming-call", { from: socket.id, offer: data.offer, type: data.type });
    });

    socket.on("answer-call", (data: { pin: string; answer: any }) => {
      socket.to(data.pin).emit("call-accepted", data.answer);
    });

    socket.on("ice-candidate", (data: { pin: string; candidate: any }) => {
      socket.to(data.pin).emit("ice-candidate", data.candidate);
    });

    socket.on("end-call", (pin: string) => {
      socket.to(pin).emit("call-ended");
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      // Clean up rooms
      for (const [pin, users] of rooms.entries()) {
        if (users.includes(socket.id)) {
          const remainingUsers = users.filter((id) => id !== socket.id);
          if (remainingUsers.length === 0) {
            rooms.delete(pin);
          } else {
            rooms.set(pin, remainingUsers);
            io.to(pin).emit("user-disconnected", socket.id);
          }
          break;
        }
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
