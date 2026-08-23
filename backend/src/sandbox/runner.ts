import { spawn } from "child_process";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE || "c-compiler-sandbox:latest";
const COMPILE_TIMEOUT_SEC = 10;
const RUN_TIMEOUT_SEC = 5;
const MEMORY_LIMIT = "128m";
const PIDS_LIMIT = "64";

export interface CompileResult {
  success: boolean;
  diagnosticsJson: string; // raw -fdiagnostics-format=json output (possibly empty)
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  crashed: boolean; // killed by signal (e.g. segfault -> SIGSEGV)
}

function runDocker(args: string[], timeoutSec: number): Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutSec * 1000 + 2000); // small buffer over the in-container `timeout`

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("close", (code) => {
      clearTimeout(killTimer);
      resolve({ stdout, stderr, code, timedOut });
    });
  });
}

/**
 * Compiles untrusted C source inside a locked-down, network-isolated container.
 * Uses -fdiagnostics-format=json so errors can be parsed structurally rather than
 * regex-matched against human-readable gcc text.
 */
export async function compileCode(sourceCode: string): Promise<CompileResult & { workDir: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "ccompile-"));
  const sourcePath = path.join(dir, "main.c");
  await writeFile(sourcePath, sourceCode, "utf-8");

  const dockerArgs = [
    "run", "--rm",
    "--network", "none",
    "--memory", MEMORY_LIMIT,
    "--memory-swap", MEMORY_LIMIT,
    "--pids-limit", PIDS_LIMIT,
    "--cpus", "1",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "-v", `${dir}:/work:rw`,
    SANDBOX_IMAGE,
    "timeout", `${COMPILE_TIMEOUT_SEC}s`,
    "gcc", "-fdiagnostics-format=json", "-Wall", "-Wextra",
    "-o", "/work/a.out", "/work/main.c",
  ];

  const result = await runDocker(dockerArgs, COMPILE_TIMEOUT_SEC);
  // Caller is responsible for cleanupWorkDir() once it's done running the binary.

  return {
    success: result.code === 0,
    diagnosticsJson: result.stderr, // gcc writes JSON diagnostics to stderr
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
    workDir: dir,
  };
}

export async function cleanupWorkDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/**
 * Executes a successfully-compiled binary. Because compileCode() and runBinary()
 * are separate container invocations, the binary must be recompiled into a shared
 * temp dir passed to both -- see services/compileService.ts for orchestration.
 */
export async function runBinary(dir: string, stdinInput: string = ""): Promise<RunResult> {
  const dockerArgs = [
    "run", "--rm", "-i",
    "--network", "none",
    "--memory", MEMORY_LIMIT,
    "--memory-swap", MEMORY_LIMIT,
    "--pids-limit", PIDS_LIMIT,
    "--cpus", "1",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "-v", `${dir}:/work:ro`,
    SANDBOX_IMAGE,
    "timeout", `${RUN_TIMEOUT_SEC}s`, "/work/a.out",
  ];

  const child = spawn("docker", dockerArgs, { stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.write(stdinInput);
  child.stdin.end();

  let stdout = "";
  let stderr = "";
  let timedOut = false;

  const killTimer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, RUN_TIMEOUT_SEC * 1000 + 2000);

  child.stdout.on("data", (d) => (stdout += d.toString()));
  child.stderr.on("data", (d) => (stderr += d.toString()));

  const exitCode: number | null = await new Promise((resolve) => {
    child.on("close", (code) => {
      clearTimeout(killTimer);
      resolve(code);
    });
  });

  return {
    stdout,
    stderr,
    exitCode,
    timedOut,
    crashed: exitCode !== null && exitCode > 128, // 128+signal convention (e.g. 139 = SIGSEGV)
  };
}
