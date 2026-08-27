import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";
import { generateHint, generatePatch } from "../services/aiTutor";
import { parseGccDiagnostics } from "../services/diagnosticsParser";

export const helpRouter = Router();

const hintSchema = z.object({ attemptId: z.string().uuid() });

helpRouter.post("/hint", requireAuth, requireRole("STUDENT"), async (req: AuthedRequest, res) => {
  const parsed = hintSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const attempt = await prisma.attempt.findUnique({
    where: { id: parsed.data.attemptId },
    include: {
      hintUsages: { orderBy: { level: "asc" } },
      submission: { include: { user: true, problem: { include: { room: true } } } },
    },
  });
  if (!attempt) return res.status(404).json({ error: "Attempt not found" });
  if (attempt.submission.userId !== req.user!.id) return res.status(403).json({ error: "Not your attempt" });

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

  const diagnostics = parseGccDiagnostics(attempt.compilerRawJson);
  const previousHints = attempt.hintUsages.map((h) => h.content);

  // Only record the HintUsage once we have a complete hint - a truncated or
  // failed generation must not burn one of the student's limited hints.
  let content: string;
  try {
    content = await generateHint(
      attempt.submission.code,
      diagnostics,
      nextLevel as 1 | 2 | 3,
      previousHints
    );
  } catch (err) {
    console.error("generateHint failed:", err);
    return res.status(503).json({
      error: "Hint unavailable",
      message: "The AI tutor didn't return a complete hint. Please try again — this didn't use up a hint.",
    });
  }

  const hint = await prisma.hintUsage.create({
    data: { attemptId: attempt.id, level: nextLevel, content },
  });

  res.json({
    level: hint.level,
    content: hint.content,
    hintsRemaining: Math.max(0, maxHints - nextLevel),
  });
});

const patchSchema = z.object({ attemptId: z.string().uuid() });

helpRouter.post("/ai-patch", requireAuth, requireRole("STUDENT"), async (req: AuthedRequest, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const attempt = await prisma.attempt.findUnique({
    where: { id: parsed.data.attemptId },
    include: {
      hintUsages: { orderBy: { level: "asc" } },
      aiPatch: true,
      submission: { include: { problem: { include: { room: true } } } },
    },
  });
  if (!attempt) return res.status(404).json({ error: "Attempt not found" });
  if (attempt.submission.userId !== req.user!.id) return res.status(403).json({ error: "Not your attempt" });

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

  const diagnostics = parseGccDiagnostics(attempt.compilerRawJson);
  let result;
  try {
    result = await generatePatch(
      attempt.submission.code,
      diagnostics,
      attempt.hintUsages.map((h) => h.content)
    );
  } catch (err) {
    // Express 4 doesn't catch async rejections, so an uncaught throw here would
    // leave the student's request hanging instead of failing.
    console.error("generatePatch failed:", err);
    return res.status(503).json({
      error: "The AI tutor didn't return a complete fix. Please try again.",
    });
  }

  const saved = await prisma.aiPatch.create({
    data: {
      attemptId: attempt.id,
      patchDiff: result.patched_code,
      reasoning: `${result.reasoning}\n\nConcept: ${result.concept_reinforced}`,
    },
  });

  res.json(saved);
});
