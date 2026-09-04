import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import {
  getSession,
  startSessionRun,
  finishSession,
  cleanupSessionForSocket,
} from "../services/interactiveRunService";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

interface AuthedSocket extends Socket {
  user?: { id: string; role: "FACULTY" | "STUDENT" };
}

function verifySocketAuth(socket: AuthedSocket, next: (err?: Error) => void) {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) return next(new Error("Missing auth token"));
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { id: string; role: "FACULTY" | "STUDENT" };
    socket.user = payload;
    next();
  } catch {
    next(new Error("Invalid or expired token"));
  }
}

export function setupInteractiveRunSocket(io: Server): void {
  io.use(verifySocketAuth);

  io.on("connection", (socket: AuthedSocket) => {
    socket.on("run:start", ({ sessionId }: { sessionId: string }) => {
      if (!socket.user || socket.user.role !== "STUDENT") {
        socket.emit("run:error", { message: "Requires student role" });
        return;
      }

      const session = getSession(sessionId, socket.user.id);
      if (!session) {
        socket.emit("run:error", { message: "Session not found or expired" });
        return;
      }

      const handle = startSessionRun(session, socket.id);

      handle.onStdout((data) => {
        session.stdout += data;
        socket.emit("run:stdout", data);
      });

      handle.onStderr((data) => {
        session.stderr += data;
        socket.emit("run:stderr", data);
      });

      handle.onExit(async (result) => {
        await finishSession(sessionId, result);
        socket.emit("run:done", {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          crashed: result.crashed,
          stdout: session.stdout,
          stderr: session.stderr,
        });
      });
    });

    socket.on("run:stdin", ({ sessionId, data }: { sessionId: string; data: string }) => {
      if (!socket.user) return;
      const session = getSession(sessionId, socket.user.id);
      if (!session?.handle) return;
      session.handle.writeStdin(data);
    });

    socket.on("run:kill", ({ sessionId }: { sessionId: string }) => {
      if (!socket.user) return;
      const session = getSession(sessionId, socket.user.id);
      if (!session?.handle) return;
      session.handle.kill();
    });

    socket.on("disconnect", () => {
      cleanupSessionForSocket(socket.id);
    });
  });
}
