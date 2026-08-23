import "dotenv/config";
import express from "express";
import cors from "cors";
import { roomsRouter } from "./routes/rooms";
import { compileRouter } from "./routes/compile";
import { helpRouter } from "./routes/help";
import { authRouter } from "./routes/auth";
import { problemsRouter } from "./routes/problems";

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
app.listen(PORT, () => console.log(`Backend listening on :${PORT}`));
