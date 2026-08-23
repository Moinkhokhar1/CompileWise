"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compileAndRun = compileAndRun;
const runner_1 = require("../sandbox/runner");
const diagnosticsParser_1 = require("./diagnosticsParser");
const db_1 = require("../db");
async function compileAndRun(submissionId, code, stdinInput = "") {
    const compileResult = await (0, runner_1.compileCode)(code);
    const diagnostics = (0, diagnosticsParser_1.parseGccDiagnostics)(compileResult.diagnosticsJson);
    let stdout = "";
    let stderr = compileResult.stderr;
    let crashed = false;
    let timedOut = compileResult.timedOut;
    if (compileResult.success) {
        const runResult = await (0, runner_1.runBinary)(compileResult.workDir, stdinInput);
        stdout = runResult.stdout;
        stderr += runResult.stderr;
        crashed = runResult.crashed;
        timedOut = timedOut || runResult.timedOut;
    }
    await (0, runner_1.cleanupWorkDir)(compileResult.workDir);
    const resolved = compileResult.success && !crashed && !timedOut;
    const primaryCategory = diagnostics.find((d) => d.kind === "error")?.category ?? (crashed ? "other" : null);
    const attempt = await db_1.prisma.attempt.create({
        data: {
            submissionId,
            compilerRawJson: compileResult.diagnosticsJson || "[]",
            errorCategory: resolved ? null : primaryCategory,
            resolved,
        },
    });
    await db_1.prisma.submission.update({
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
