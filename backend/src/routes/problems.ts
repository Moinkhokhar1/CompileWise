import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";
import { isLanguage } from "../sandbox/languages";

export const problemsRouter = Router();

const createProblemSchema = z.object({
  roomId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().min(1),
  starterCode: z.string().default(""),
  language: z.enum(["C", "CPP", "JAVA", "PYTHON"]).default("C"),
});

problemsRouter.post("/", requireAuth, requireRole("FACULTY"), async (req: AuthedRequest, res) => {
  const parsed = createProblemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const room = await prisma.room.findUnique({ where: { id: parsed.data.roomId } });
  if (!room || room.facultyId !== req.user!.id) return res.status(403).json({ error: "Not your room" });

  const problem = await prisma.problem.create({ data: parsed.data });
  res.status(201).json(problem);
});

problemsRouter.get("/room/:roomId", requireAuth, async (req: AuthedRequest, res) => {
  const problems = await prisma.problem.findMany({
    where: { roomId: req.params.roomId },
    orderBy: { createdAt: "asc" },
  });
  res.json(problems);
});

problemsRouter.get("/languages", requireAuth, (_req, res) => {
  res.json(["C", "CPP", "JAVA", "PYTHON"].filter(isLanguage));
});
