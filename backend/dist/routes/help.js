"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.helpRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const aiTutor_1 = require("../services/aiTutor");
const diagnosticsParser_1 = require("../services/diagnosticsParser");
exports.helpRouter = (0, express_1.Router)();
const hintSchema = zod_1.z.object({ attemptId: zod_1.z.string().uuid() });
exports.helpRouter.post("/hint", auth_1.requireAuth, (0, auth_1.requireRole)("STUDENT"), async (req, res) => {
    const parsed = hintSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const attempt = await db_1.prisma.attempt.findUnique({
        where: { id: parsed.data.attemptId },
        include: {
            hintUsages: { orderBy: { level: "asc" } },
            submission: { include: { user: true, problem: { include: { room: true } } } },
        },
    });
    if (!attempt)
        return res.status(404).json({ error: "Attempt not found" });
    if (attempt.submission.userId !== req.user.id)
        return res.status(403).json({ error: "Not your attempt" });
    const maxHints = attempt.submission.problem.room.allowedHints;
    const nextLevel = attempt.hintUsages.length + 1;
    if (nextLevel > maxHints) {
        return res.status(409).json({
            error: "All hints used",
            hintsExhausted: true,
            message: "You've used all available hints. You can now request an AI fix patch.",
        });
    }
    if (nextLevel > 3) {
        return res.status(400).json({ error: "Hint levels only go up to 3" });
    }
    const diagnostics = (0, diagnosticsParser_1.parseGccDiagnostics)(attempt.compilerRawJson);
    const previousHints = attempt.hintUsages.map((h) => h.content);
    const content = await (0, aiTutor_1.generateHint)(attempt.submission.code, diagnostics, nextLevel, previousHints);
    const hint = await db_1.prisma.hintUsage.create({
        data: { attemptId: attempt.id, level: nextLevel, content },
    });
    res.json({
        level: hint.level,
        content: hint.content,
        hintsRemaining: Math.max(0, maxHints - nextLevel),
    });
});
const patchSchema = zod_1.z.object({ attemptId: zod_1.z.string().uuid() });
exports.helpRouter.post("/ai-patch", auth_1.requireAuth, (0, auth_1.requireRole)("STUDENT"), async (req, res) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const attempt = await db_1.prisma.attempt.findUnique({
        where: { id: parsed.data.attemptId },
        include: {
            hintUsages: { orderBy: { level: "asc" } },
            aiPatch: true,
            submission: { include: { problem: { include: { room: true } } } },
        },
    });
    if (!attempt)
        return res.status(404).json({ error: "Attempt not found" });
    if (attempt.submission.userId !== req.user.id)
        return res.status(403).json({ error: "Not your attempt" });
    const requiredHints = attempt.submission.problem.room.allowedHints;
    if (attempt.hintUsages.length < requiredHints) {
        return res.status(409).json({
            error: `Use all ${requiredHints} hints before requesting an AI patch`,
            hintsUsed: attempt.hintUsages.length,
        });
    }
    if (attempt.aiPatch) {
        return res.json(attempt.aiPatch); // idempotent - don't regenerate/re-log
    }
    const diagnostics = (0, diagnosticsParser_1.parseGccDiagnostics)(attempt.compilerRawJson);
    const result = await (0, aiTutor_1.generatePatch)(attempt.submission.code, diagnostics, attempt.hintUsages.map((h) => h.content));
    const saved = await db_1.prisma.aiPatch.create({
        data: {
            attemptId: attempt.id,
            patchDiff: result.patched_code,
            reasoning: `${result.reasoning}\n\nConcept: ${result.concept_reinforced}`,
        },
    });
    res.json(saved);
});
