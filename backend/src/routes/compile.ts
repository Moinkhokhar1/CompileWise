import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";
import { compileAndRun } from "../services/compileService";
import { createInteractiveSession } from "../services/interactiveRunService";
import { explainError } from "../services/aiTutor";

export const compileRouter = Router();

const submitSchema = z.object({
  problemId: z.string().uuid(),
  code: z.string().min(1).max(20000),
  stdin: z.string().max(5000).optional(),
  interactive: z.boolean().optional(),
});

compileRouter.post("/submit", requireAuth, requireRole("STUDENT"), async (req: AuthedRequest, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { problemId, code, stdin, interactive } = parsed.data;

  const problem = await prisma.problem.findUnique({ where: { id: problemId } });
  if (!problem) return res.status(404).json({ error: "Problem not found" });

  const language = problem.language;

  const submission = await prisma.submission.create({
    data: { userId: req.user!.id, problemId, code, status: "RUNNING" },
  });

  if (interactive) {
    const sessionResult = await createInteractiveSession(req.user!.id, submission.id, code, language);

    if (!sessionResult.ok) {
      let explanation = null;
      if (sessionResult.diagnostics.length > 0) {
        try {
          explanation = await explainError(code, sessionResult.diagnostics, language);
          await prisma.attempt.update({
            where: { id: sessionResult.attemptId },
            data: { explanation: JSON.stringify(explanation) },
          });
        } catch (err) {
          console.error("explainError failed:", err);
        }
      }

      return res.json({
        submissionId: submission.id,
        attemptId: sessionResult.attemptId,
        resolved: false,
        interactive: false,
        language,
        diagnostics: sessionResult.diagnostics,
        stdout: "",
        stderr: "",
        crashed: false,
        timedOut: sessionResult.timedOut,
        explanation,
      });
    }

    return res.json({
      submissionId: submission.id,
      attemptId: sessionResult.session.attemptId,
      resolved: true,
      interactive: true,
      sessionId: sessionResult.session.id,
      language,
      diagnostics: sessionResult.diagnostics,
      stdout: "",
      stderr: "",
      crashed: false,
      timedOut: false,
      explanation: null,
    });
  }

  const outcome = await compileAndRun(submission.id, code, language, stdin ?? "");

  let explanation = null;
  if (!outcome.resolved && outcome.diagnostics.length > 0) {
    try {
      explanation = await explainError(code, outcome.diagnostics, language);
      await prisma.attempt.update({
        where: { id: outcome.attemptId },
        data: { explanation: JSON.stringify(explanation) },
      });
    } catch (err) {
      console.error("explainError failed:", err);
    }
  }

  res.json({
    submissionId: submission.id,
    attemptId: outcome.attemptId,
    resolved: outcome.resolved,
    interactive: false,
    language,
    diagnostics: outcome.diagnostics,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    crashed: outcome.crashed,
    timedOut: outcome.timedOut,
    explanation,
  });
});
