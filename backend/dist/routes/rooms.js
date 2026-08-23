"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.roomsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
exports.roomsRouter = (0, express_1.Router)();
function generateJoinCode() {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
}
const createRoomSchema = zod_1.z.object({
    title: zod_1.z.string().min(1),
    allowedHints: zod_1.z.number().int().min(0).max(10).optional(),
});
exports.roomsRouter.post("/", auth_1.requireAuth, (0, auth_1.requireRole)("FACULTY"), async (req, res) => {
    const parsed = createRoomSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const room = await db_1.prisma.room.create({
        data: {
            title: parsed.data.title,
            allowedHints: parsed.data.allowedHints ?? 3,
            facultyId: req.user.id,
            code: generateJoinCode(),
        },
    });
    res.status(201).json(room);
});
// NEW: lets the faculty dashboard reload their rooms (with problem counts)
// after a page refresh instead of losing everything from React state.
exports.roomsRouter.get("/mine", auth_1.requireAuth, (0, auth_1.requireRole)("FACULTY"), async (req, res) => {
    const rooms = await db_1.prisma.room.findMany({
        where: { facultyId: req.user.id },
        include: { problems: { select: { id: true, title: true, description: true, starterCode: true } } },
        orderBy: { createdAt: "desc" },
    });
    res.json(rooms);
});
exports.roomsRouter.post("/join/:code", auth_1.requireAuth, (0, auth_1.requireRole)("STUDENT"), async (req, res) => {
    const room = await db_1.prisma.room.findUnique({ where: { code: req.params.code.toUpperCase() } });
    if (!room)
        return res.status(404).json({ error: "Room not found" });
    await db_1.prisma.roomMember.upsert({
        where: { roomId_userId: { roomId: room.id, userId: req.user.id } },
        create: { roomId: room.id, userId: req.user.id },
        update: {},
    });
    res.json(room);
});
// Faculty dashboard: per-student progress across a room.
exports.roomsRouter.get("/:roomId/progress", auth_1.requireAuth, (0, auth_1.requireRole)("FACULTY"), async (req, res) => {
    const room = await db_1.prisma.room.findUnique({ where: { id: req.params.roomId } });
    if (!room || room.facultyId !== req.user.id)
        return res.status(403).json({ error: "Not your room" });
    const submissions = await db_1.prisma.submission.findMany({
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
    const byStudent = {};
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
            errorCategoriesEncountered: new Set(),
        });
        p.status = s.status;
        p.totalAttempts += s.attempts.length;
        for (const a of s.attempts) {
            p.hintsUsed += a.hintUsages.length;
            if (a.aiPatch)
                p.usedAiPatch = true;
            if (a.errorCategory)
                p.errorCategoriesEncountered.add(a.errorCategory);
        }
    }
    for (const student of Object.values(byStudent)) {
        for (const problem of Object.values(student.problems)) {
            problem.errorCategoriesEncountered = Array.from(problem.errorCategoriesEncountered);
        }
    }
    res.json(byStudent);
}, 
// Deletes a room and everything under it (problems, submissions, attempts,
// hints, patches) via cascading deletes driven from the DB relations.
exports.roomsRouter.delete("/:roomId", auth_1.requireAuth, (0, auth_1.requireRole)("FACULTY"), async (req, res) => {
    const room = await db_1.prisma.room.findUnique({ where: { id: req.params.roomId } });
    if (!room)
        return res.status(404).json({ error: "Room not found" });
    if (room.facultyId !== req.user.id)
        return res.status(403).json({ error: "Not your room" });
    const problems = await db_1.prisma.problem.findMany({ where: { roomId: room.id }, select: { id: true } });
    const problemIds = problems.map((p) => p.id);
    const submissions = await db_1.prisma.submission.findMany({
        where: { problemId: { in: problemIds } },
        select: { id: true },
    });
    const submissionIds = submissions.map((s) => s.id);
    const attempts = await db_1.prisma.attempt.findMany({
        where: { submissionId: { in: submissionIds } },
        select: { id: true },
    });
    const attemptIds = attempts.map((a) => a.id);
    // Prisma's schema here has no onDelete: Cascade set, so we delete
    // bottom-up manually to avoid foreign key violations.
    await db_1.prisma.hintUsage.deleteMany({ where: { attemptId: { in: attemptIds } } });
    await db_1.prisma.aiPatch.deleteMany({ where: { attemptId: { in: attemptIds } } });
    await db_1.prisma.attempt.deleteMany({ where: { id: { in: attemptIds } } });
    await db_1.prisma.submission.deleteMany({ where: { id: { in: submissionIds } } });
    await db_1.prisma.problem.deleteMany({ where: { id: { in: problemIds } } });
    await db_1.prisma.roomMember.deleteMany({ where: { roomId: room.id } });
    await db_1.prisma.room.delete({ where: { id: room.id } });
    res.json({ success: true });
}));
