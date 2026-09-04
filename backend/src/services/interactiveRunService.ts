import { v4 as uuidv4 } from "uuid";
import { compileCode, cleanupWorkDir, startInteractiveRun, InteractiveRunHandle } from "../sandbox/runner";
import { parseDiagnostics } from "./diagnosticsParser";
import { Language } from "../sandbox/languages";
import { prisma } from "../db";

export interface InteractiveSession {
  id: string;
  userId: string;
  attemptId: string;
  submissionId: string;
  language: Language;
  workDir: string;
  handle: InteractiveRunHandle | null;
  socketId: string | null;
  stdout: string;
  stderr: string;
}

const sessions = new Map<string, InteractiveSession>();

export async function createInteractiveSession(
  userId: string,
  submissionId: string,
  code: string,
  language: Language
): Promise<
  | { ok: true; session: InteractiveSession; diagnostics: ReturnType<typeof parseDiagnostics> }
  | { ok: false; attemptId: string; diagnostics: ReturnType<typeof parseDiagnostics>; timedOut: boolean }
> {
  const compileResult = await compileCode(code, language);
  const diagnostics = parseDiagnostics(compileResult.diagnosticsJson, language);

  const primaryCategory = diagnostics.find((d) => d.kind === "error")?.category ?? null;

  const attempt = await prisma.attempt.create({
    data: {
      submissionId,
      compilerRawJson: compileResult.diagnosticsJson || "[]",
      errorCategory: compileResult.success ? null : primaryCategory,
      resolved: false,
    },
  });

  if (!compileResult.success) {
    await cleanupWorkDir(compileResult.workDir);
    await prisma.submission.update({ where: { id: submissionId }, data: { status: "ERROR" } });
    return { ok: false, attemptId: attempt.id, diagnostics, timedOut: compileResult.timedOut };
  }

  const session: InteractiveSession = {
    id: uuidv4(),
    userId,
    attemptId: attempt.id,
    submissionId,
    language,
    workDir: compileResult.workDir,
    handle: null,
    socketId: null,
    stdout: "",
    stderr: "",
  };

  sessions.set(session.id, session);
  return { ok: true, session, diagnostics };
}

export function getSession(sessionId: string, userId: string): InteractiveSession | null {
  const session = sessions.get(sessionId);
  if (!session || session.userId !== userId) return null;
  return session;
}

export function startSessionRun(session: InteractiveSession, socketId: string): InteractiveRunHandle {
  if (session.handle) session.handle.kill();

  session.socketId = socketId;
  session.stdout = "";
  session.stderr = "";
  session.handle = startInteractiveRun(session.workDir, session.language);
  return session.handle;
}

export async function finishSession(
  sessionId: string,
  result: { exitCode: number | null; timedOut: boolean; crashed: boolean }
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  const resolved = !result.crashed && !result.timedOut && (result.exitCode === 0 || result.exitCode === null);

  await prisma.attempt.update({
    where: { id: session.attemptId },
    data: {
      resolved,
      errorCategory: resolved ? null : result.crashed ? "other" : null,
    },
  });

  await prisma.submission.update({
    where: { id: session.submissionId },
    data: { status: resolved ? "SUCCESS" : "ERROR" },
  });

  if (session.handle) {
    session.handle.kill();
    session.handle = null;
  }

  await cleanupWorkDir(session.workDir);
  sessions.delete(sessionId);
}

export function cleanupSessionForSocket(socketId: string): void {
  for (const [id, session] of sessions) {
    if (session.socketId === socketId) {
      if (session.handle) session.handle.kill();
      cleanupWorkDir(session.workDir).catch(() => {});
      sessions.delete(id);
    }
  }
}
