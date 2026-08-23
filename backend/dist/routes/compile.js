"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compileRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const compileService_1 = require("../services/compileService");
const aiTutor_1 = require("../services/aiTutor");
exports.compileRouter = (0, express_1.Router)();
const submitSchema = zod_1.z.object({
    problemId: zod_1.z.string().uuid(),
    code: zod_1.z.string().min(1).max(20000),
    stdin: zod_1.z.string().max(5000).optional(),
});
exports.compileRouter.post("/submit", auth_1.requireAuth, (0, auth_1.requireRole)("STUDENT"), async (req, res) => {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const { problemId, code, stdin } = parsed.data;
    const submission = await db_1.prisma.submission.create({
        data: { userId: req.user.id, problemId, code, status: "RUNNING" },
    });
    const outcome = await (0, compileService_1.compileAndRun)(submission.id, code, stdin ?? "");
    let explanation = null;
    if (!outcome.resolved && outcome.diagnostics.length > 0) {
        try {
            explanation = await (0, aiTutor_1.explainError)(code, outcome.diagnostics);
            await db_1.prisma.attempt.update({
                where: { id: outcome.attemptId },
                data: { explanation: JSON.stringify(explanation) },
            });
        }
        catch (err) {
            // AI explanation is best-effort; the raw visualized diagnostics still work without it.
            console.error("explainError failed:", err);
        }
    }
    res.json({
        submissionId: submission.id,
        attemptId: outcome.attemptId,
        resolved: outcome.resolved,
        diagnostics: outcome.diagnostics, // structured, for the error-visualization panel
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        crashed: outcome.crashed,
        timedOut: outcome.timedOut,
        explanation,
    });
});
