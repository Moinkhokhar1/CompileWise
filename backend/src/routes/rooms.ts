import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";

export const roomsRouter = Router();

function generateJoinCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

const createRoomSchema = z.object({
  title: z.string().min(1),
  allowedHints: z.number().int().min(0).max(10).optional(),
});

roomsRouter.post("/", requireAuth, requireRole("FACULTY"), async (req: AuthedRequest, res) => {
  const parsed = createRoomSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const room = await prisma.room.create({
    data: {
      title: parsed.data.title,
      allowedHints: parsed.data.allowedHints ?? 3,
      facultyId: req.user!.id,
      code: generateJoinCode(),
    },
  });
  res.status(201).json(room);
});

// NEW: lets the faculty dashboard reload their rooms (with problem counts)
// after a page refresh instead of losing everything from React state.
roomsRouter.get("/mine", requireAuth, requireRole("FACULTY"), async (req: AuthedRequest, res) => {
  const rooms = await prisma.room.findMany({
    where: { facultyId: req.user!.id },
    include: { problems: { select: { id: true, title: true, description: true, starterCode: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(rooms);
});

roomsRouter.post("/join/:code", requireAuth, requireRole("STUDENT"), async (req: AuthedRequest, res) => {
  const room = await prisma.room.findUnique({ where: { code: req.params.code.toUpperCase() } });
  if (!room) return res.status(404).json({ error: "Room not found" });

  await prisma.roomMember.upsert({
    where: { roomId_userId: { roomId: room.id, userId: req.user!.id } },
    create: { roomId: room.id, userId: req.user!.id },
    update: {},
  });

  res.json(room);
});

// Faculty dashboard: per-student progress across a room.
roomsRouter.get("/:roomId/progress", requireAuth, requireRole("FACULTY"), async (req: AuthedRequest, res) => {
  const room = await prisma.room.findUnique({ where: { id: req.params.roomId } });
  if (!room || room.facultyId !== req.user!.id) return res.status(403).json({ error: "Not your room" });

  const submissions = await prisma.submission.findMany({
    where: { problem: { roomId: room.id } },
    include: {
      user: { select: { id: true, name: true } },
      problem: { select: { id: true, title: true } },
      attempts: {
        include: { hintUsages: true, aiPatch: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const byStudent: Record<string, any> = {};
  for (const s of submissions) {
    const key = s.user.id;
    byStudent[key] ??= {
      studentName: s.user.name,
      problems: {},
    };
    const p = (byStudent[key].problems[s.problem.id] ??= {
      title: s.problem.title,
      status: s.status,
      totalAttempts: 0,
      hintsUsed: 0,
      usedAiPatch: false,
      errorCategoriesEncountered: new Set<string>(),
    });
    p.status = s.status;
    p.totalAttempts += s.attempts.length;
    for (const a of s.attempts) {
      p.hintsUsed += a.hintUsages.length;
      if (a.aiPatch) p.usedAiPatch = true;
      if (a.errorCategory) p.errorCategoriesEncountered.add(a.errorCategory);
    }
  }

  for (const student of Object.values(byStudent) as any[]) {
    for (const problem of Object.values(student.problems) as any[]) {
      problem.errorCategoriesEncountered = Array.from(problem.errorCategoriesEncountered);
    }
  }

  res.json(byStudent);
},

// Deletes a room and everything under it (problems, submissions, attempts,
// hints, patches) via cascading deletes driven from the DB relations.
roomsRouter.delete("/:roomId", requireAuth, requireRole("FACULTY"), async (req: AuthedRequest, res) => {
  const room = await prisma.room.findUnique({ where: { id: req.params.roomId } });
  if (!room) return res.status(404).json({ error: "Room not found" });
  if (room.facultyId !== req.user!.id) return res.status(403).json({ error: "Not your room" });

  const problems = await prisma.problem.findMany({ where: { roomId: room.id }, select: { id: true } });
  const problemIds = problems.map((p) => p.id);

  const submissions = await prisma.submission.findMany({
    where: { problemId: { in: problemIds } },
    select: { id: true },
  });
  const submissionIds = submissions.map((s) => s.id);

  const attempts = await prisma.attempt.findMany({
    where: { submissionId: { in: submissionIds } },
    select: { id: true },
  });
  const attemptIds = attempts.map((a) => a.id);

  // Prisma's schema here has no onDelete: Cascade set, so we delete
  // bottom-up manually to avoid foreign key violations.
  await prisma.hintUsage.deleteMany({ where: { attemptId: { in: attemptIds } } });
  await prisma.aiPatch.deleteMany({ where: { attemptId: { in: attemptIds } } });
  await prisma.attempt.deleteMany({ where: { id: { in: attemptIds } } });
  await prisma.submission.deleteMany({ where: { id: { in: submissionIds } } });
  await prisma.problem.deleteMany({ where: { id: { in: problemIds } } });
  await prisma.roomMember.deleteMany({ where: { roomId: room.id } });
  await prisma.room.delete({ where: { id: room.id } });

  res.json({ success: true });
})
);