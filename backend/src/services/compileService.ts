import { compileCode, runBinary, cleanupWorkDir } from "../sandbox/runner";
import { parseGccDiagnostics, ParsedDiagnostic } from "./diagnosticsParser";
import { prisma } from "../db";

export interface CompileAndRunOutcome {
  attemptId: string;
  compiled: boolean;
  diagnostics: ParsedDiagnostic[];
  stdout: string;
  stderr: string;
  crashed: boolean;
  timedOut: boolean;
  resolved: boolean; // true if it compiled AND ran without crashing
}

export async function compileAndRun(
  submissionId: string,
  code: string,
  stdinInput: string = ""
): Promise<CompileAndRunOutcome> {
  const compileResult = await compileCode(code);
  const diagnostics = parseGccDiagnostics(compileResult.diagnosticsJson);

  let stdout = "";
  let stderr = compileResult.stderr;
  let crashed = false;
  let timedOut = compileResult.timedOut;

  if (compileResult.success) {
    const runResult = await runBinary(compileResult.workDir, stdinInput);
    stdout = runResult.stdout;
    stderr += runResult.stderr;
    crashed = runResult.crashed;
    timedOut = timedOut || runResult.timedOut;
  }

  await cleanupWorkDir(compileResult.workDir);

  const resolved = compileResult.success && !crashed && !timedOut;
  const primaryCategory = diagnostics.find((d) => d.kind === "error")?.category ?? (crashed ? "other" : null);

  const attempt = await prisma.attempt.create({
    data: {
      submissionId,
      compilerRawJson: compileResult.diagnosticsJson || "[]",
      errorCategory: resolved ? null : primaryCategory,
      resolved,
    },
  });

  await prisma.submission.update({
    where: { id: submissionId },
    data: { status: resolved ? "SUCCESS" : "ERROR" },
  });

  return {
    attemptId: attempt.id,
    compiled: compileResult.success,
    diagnostics,
    stdout,
    stderr,
    crashed,
    timedOut,
    resolved,
  };
}
