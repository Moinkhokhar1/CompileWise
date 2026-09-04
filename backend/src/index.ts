import "dotenv/config";
import { createServer } from "http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import { roomsRouter } from "./routes/rooms";
import { compileRouter } from "./routes/compile";
import { helpRouter } from "./routes/help";
import { authRouter } from "./routes/auth";
import { problemsRouter } from "./routes/problems";
import { setupInteractiveRunSocket } from "./socket/interactiveRun";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use("/api/auth", authRouter);
app.use("/api/rooms", roomsRouter);
app.use("/api/problems", problemsRouter);
app.use("/api/compile", compileRouter);
app.use("/api/help", helpRouter);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

setupInteractiveRunSocket(io);

httpServer.listen(PORT, () => console.log(`Backend listening on :${PORT}`));
