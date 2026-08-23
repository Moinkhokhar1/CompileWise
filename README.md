# CompileWise — C Compiler Learning Platform

A room-based web platform where faculty create coding rooms, students join and
write C code in-browser, and every compiler error is translated into a
plain-language explanation with progressive hints and an AI-generated fix as
a last resort — built for first-semester students learning C.

---

## Features

- **Rooms** — faculty create a room and get a short join code; students join
  with that code. Each room can hold multiple problems.
- **Sandboxed compile & run** — every submission compiles and runs inside a
  locked-down, network-isolated Docker container (memory/CPU/PID limits,
  dropped capabilities, non-root user, hard timeouts).
- **Structured error visualization** — `gcc -fdiagnostics-format=json` output
  is parsed into categorized errors (missing semicolon, undeclared
  identifier, type mismatch, linker error, etc.) and shown inline on the
  exact line/column in the editor.
- **AI plain-language explanation** — for every error, an AI call explains
  what the error means, why it happened in *this* code, and the underlying
  concept — without giving away the fix.
- **Progressive hints** — "Need hint?" reveals up to 3 hints, each more
  specific than the last, never containing the literal corrected code.
- **AI fix patch** — once all hints are used and the error persists, the
  student can request a minimal patch with reasoning tied back to the hints
  already given.
- **Progress tracking** — a faculty dashboard shows, per student per problem:
  status (success/error), total attempts, hints used, whether an AI patch
  was used, and which error categories were encountered.
- **Copy-paste blocking** — paste and copy are disabled at the editor level
  as a deterrent (not a hard guarantee — see Limitations).
- **Session persistence** — login state and the student's last-joined room
  survive a page refresh.
- **Room deletion** — faculty can delete a room and everything under it
  (problems, submissions, attempts, hints, patches).

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript + Vite |
| Editor | Monaco Editor |
| Backend | Node.js + Express (TypeScript) |
| Database | PostgreSQL + Prisma ORM |
| Auth | JWT + bcrypt |
| Compiler sandbox | Docker container per run (`gcc -fdiagnostics-format=json`) |
| AI | Google Gemini API |

---

## Project structure

```
c-compiler-platform/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma          # DB schema: rooms, problems, submissions, attempts, hints, patches
│   ├── sandbox-image/
│   │   └── Dockerfile             # locked-down image used to compile/run student code
│   └── src/
│       ├── routes/
│       │   ├── auth.ts            # signup / login
│       │   ├── rooms.ts           # create/join/list/delete rooms, faculty progress dashboard
│       │   ├── problems.ts        # create/list problems within a room
│       │   ├── compile.ts         # POST /api/compile/submit — the core compile+diagnose endpoint
│       │   └── help.ts            # POST /api/help/hint and /api/help/ai-patch
│       ├── services/
│       │   ├── compileService.ts  # orchestrates compile -> run -> DB persistence
│       │   ├── diagnosticsParser.ts # parses gcc JSON diagnostics into categorized errors
│       │   └── aiTutor.ts         # Gemini calls: explain / hint / patch
│       ├── sandbox/
│       │   └── runner.ts          # spawns the locked-down Docker container per submission
│       ├── middleware/auth.ts     # JWT verification + role guard
│       ├── db.ts                  # Prisma client singleton
│       └── index.ts                # Express app entrypoint
└── frontend/
    └── src/
        ├── api.ts                 # API client + localStorage session persistence
        ├── App.tsx                # routes between login / faculty / student screens
        ├── styles.css
        ├── pages/
        │   ├── LoginScreen.tsx
        │   ├── FacultyScreen.tsx  # create/delete rooms, add problems, view progress table
        │   └── StudentScreen.tsx  # join room, pick problem, open workspace
        └── components/
            └── CodeWorkspace.tsx  # Monaco editor + error visualization + hint/patch flow
```

---

## Prerequisites

- **Docker Desktop** — must be installed and running. The backend spawns a
  new sandboxed container for every compile/run, so nothing here works
  without it.
- **Node.js 20+** and npm.
- A **Gemini API key** — get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

---

## Setup, step by step

### 1. Build the sandbox image

From the project root:

```bash
docker build -t c-compiler-sandbox:latest ./backend/sandbox-image
```

This is the locked-down image every student compile/run happens inside.
Build it first so any Dockerfile issues surface early, separately from the
rest of the stack.

### 2. Start PostgreSQL

The simplest path is running Postgres in Docker directly (no separate
install needed):

```bash
docker run --name ccompiler-db \
  -e POSTGRES_USER=app \
  -e POSTGRES_PASSWORD=app \
  -e POSTGRES_DB=ccompiler \
  -p 5432:5432 \
  -d postgres:16
```

Verify it's running:

```bash
docker ps
```

You should see `ccompiler-db` with status `Up`. Next time, don't `docker run`
again — just `docker start ccompiler-db` to bring the same container (and its
data) back up.

### 3. Configure the backend

```bash
cd backend
cp ../.env.example .env
```

Edit `backend/.env` so it contains:

```
DATABASE_URL=postgresql://app:app@localhost:5432/ccompiler
GEMINI_API_KEY=your-real-key-here
JWT_SECRET=any-random-string
```

`.env` must live inside `backend/`, not the project root — that's where
Prisma and npm look for it.

### 4. Install dependencies and create the database tables

```bash
npm install
npx prisma migrate dev --name init
```

This reads `prisma/schema.prisma` and creates all tables (`User`, `Room`,
`Problem`, `Submission`, `Attempt`, `HintUsage`, `AiPatch`) inside the
`ccompiler` database.

### 5. Start the backend

```bash
npm run dev
```

You should see `Backend listening on :4000`. Confirm it's healthy:

```bash
curl localhost:4000/api/health
```

Expect back `{"ok":true}`.

### 6. Start the frontend

In a **new** terminal tab, from the project root:

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

### 7. Try it out

- Sign up once as **Faculty** — create a room, note the join code, add a
  problem with some starter code.
- Sign up again as **Student** (use a private/incognito window, since the
  app holds one session at a time) — join with the room code, open the
  problem, write/break some C code, and click **Run**.

---

## How the core flow works

1. Student clicks **Run** → code is sent to `POST /api/compile/submit`.
2. The backend spins up a throwaway Docker container, compiles the code with
   `gcc -fdiagnostics-format=json`, and — if compilation succeeds — runs the
   resulting binary in a second locked-down container.
3. Diagnostics are parsed into structured, categorized errors and shown
   inline on the exact line/column in Monaco.
4. If there's an error, Gemini generates a plain-language explanation
   (what it means, why it happened here, the underlying concept) — without
   revealing the fix.
5. The student can request up to 3 hints, each stricter than the last.
6. Once all hints are used and the error still isn't resolved, the student
   can request an AI patch with reasoning.
7. Every attempt, hint use, and patch use is recorded in the database and
   rolled up into the faculty progress table.

---

## Known limitations / not yet built

- **Copy-paste blocking is a deterrent, not a guarantee.** It's disabled at
  the DOM level in the editor, but a determined student could still work
  around it (e.g. typing from another screen). Treat it as a soft nudge, not
  airtight enforcement.
- **No realtime updates.** The faculty progress table is refresh-on-demand,
  not live-updating via websockets.
- **No diagram-style error visualizations yet** (e.g. bracket-matching
  diagrams, pointer box-and-arrow illustrations) — explanations are
  currently plain text only.
- **Hard delete only.** Deleting a room permanently removes all its
  problems and student progress — there's no archive/undo. Fine for
  dev/testing; worth changing to a soft-delete flag before using with real
  student data.
- **`API_BASE` is hardcoded** to `http://localhost:4000` in
  `frontend/src/api.ts` — fine for local dev, needs to become an
  environment variable before deploying anywhere else.

---

## Troubleshooting

**`Environment variable not found: DATABASE_URL`**
Your `.env` file isn't in `backend/`, or you're running the command from
the wrong folder. `cd backend` and confirm `.env` is present there before
running Prisma commands.

**`P1010: User 'app' was denied access` or `Can't reach database server`**
Usually a port mismatch or a stopped container. Run `docker ps` to confirm
`ccompiler-db` is up, and check `DATABASE_URL` in `backend/.env` matches the
port it's actually mapped to (default `5432`).

**`port is already allocated` when running `docker compose up db`**
You likely already have a Postgres container running manually
(`ccompiler-db`). You don't need both — stop the compose one
(`docker compose stop db`) and keep using the manual container.

**Gemini `404 Not Found` / model deprecated error**
Google occasionally retires model names. The error message names the
replacement model directly — update `MODEL` in
`backend/src/services/aiTutor.ts` to the name given in the error. To see
every model your key currently has access to:

```bash
curl "https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_GEMINI_API_KEY"
```

**`Unexpected token '<', "<!DOCTYPE"... is not valid JSON` in the browser**
The frontend tried to call the backend but got an HTML error page instead
of JSON — almost always means the backend isn't running. Check the backend
terminal tab and confirm `curl localhost:4000/api/health` returns
`{"ok":true}`.

**404 on `/api/auth/login` or `/api/auth/signup`**
The running backend is missing the auth routes — usually means you're
running an older copy of the code. Re-check that `backend/src/routes/auth.ts`
exists and is wired into `backend/src/index.ts`.