import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";
import { compileAndRun } from "../services/compileService";
import { explainError } from "../services/aiTutor";

export const compileRouter = Router();

const submitSchema = z.object({
  problemId: z.string().uuid(),
  code: z.string().min(1).max(20000),
  stdin: z.string().max(5000).optional(),
});

compileRouter.post("/submit", requireAuth, requireRole("STUDENT"), async (req: AuthedRequest, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { problemId, code, stdin } = parsed.data;

  const submission = await prisma.submission.create({
    data: { userId: req.user!.id, problemId, code, status: "RUNNING" },
  });

  const outcome = await compileAndRun(submission.id, code, stdin ?? "");

  let explanation = null;
  if (!outcome.resolved && outcome.diagnostics.length > 0) {
    try {
      explanation = await explainError(code, outcome.diagnostics);
      await prisma.attempt.update({
        where: { id: outcome.attemptId },
        data: { explanation: JSON.stringify(explanation) },
      });
    } catch (err) {
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
