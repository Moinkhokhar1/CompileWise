"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.problemsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
exports.problemsRouter = (0, express_1.Router)();
const createProblemSchema = zod_1.z.object({
    roomId: zod_1.z.string().uuid(),
    title: zod_1.z.string().min(1),
    description: zod_1.z.string().min(1),
    starterCode: zod_1.z.string().default(""),
});
exports.problemsRouter.post("/", auth_1.requireAuth, (0, auth_1.requireRole)("FACULTY"), async (req, res) => {
    const parsed = createProblemSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const room = await db_1.prisma.room.findUnique({ where: { id: parsed.data.roomId } });
    if (!room || room.facultyId !== req.user.id)
        return res.status(403).json({ error: "Not your room" });
    const problem = await db_1.prisma.problem.create({ data: parsed.data });
    res.status(201).json(problem);
});
exports.problemsRouter.get("/room/:roomId", auth_1.requireAuth, async (req, res) => {
    const problems = await db_1.prisma.problem.findMany({
        where: { roomId: req.params.roomId },
        orderBy: { createdAt: "asc" },
    });
    res.json(problems);
});
