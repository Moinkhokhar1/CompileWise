import { spawn } from "child_process";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { Language, LANGUAGE_CONFIG } from "./languages";

const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE || "c-compiler-sandbox:latest";
const COMPILE_TIMEOUT_SEC = 10;
const RUN_TIMEOUT_SEC = 5;
const INTERACTIVE_RUN_TIMEOUT_SEC = 30;
const MEMORY_LIMIT = "128m";
const PIDS_LIMIT = "64";

export interface CompileResult {
  success: boolean;
  diagnosticsJson: string;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  crashed: boolean;
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
    }, timeoutSec * 1000 + 2000);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("close", (code) => {
      clearTimeout(killTimer);
      resolve({ stdout, stderr, code, timedOut });
    });
  });
}

function baseDockerArgs(dir: string, readOnly: boolean): string[] {
  return [
    "run", "--rm",
    "--network", "none",
    "--memory", MEMORY_LIMIT,
    "--memory-swap", MEMORY_LIMIT,
    "--pids-limit", PIDS_LIMIT,
    "--cpus", "1",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "-v", `${dir}:/work:${readOnly ? "ro" : "rw"}`,
    "-w", "/work",
    SANDBOX_IMAGE,
  ];
}

export async function compileCode(sourceCode: string, language: Language): Promise<CompileResult & { workDir: string }> {
  const config = LANGUAGE_CONFIG[language];
  const dir = await mkdtemp(path.join(tmpdir(), "compile-"));
  const sourcePath = path.join(dir, config.sourceFile);
  await writeFile(sourcePath, sourceCode, "utf-8");

  const dockerArgs = [
    ...baseDockerArgs(dir, false),
    "timeout", `${COMPILE_TIMEOUT_SEC}s`,
    ...config.compileCommand,
  ];

  const result = await runDocker(dockerArgs, COMPILE_TIMEOUT_SEC);

  return {
    success: result.code === 0,
    diagnosticsJson: result.stderr,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
    workDir: dir,
  };
}

export async function cleanupWorkDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function runBinary(dir: string, language: Language, stdinInput: string = ""): Promise<RunResult> {
  const config = LANGUAGE_CONFIG[language];
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
    "-w", "/work",
    SANDBOX_IMAGE,
    "timeout", `${RUN_TIMEOUT_SEC}s`,
    ...config.runCommand,
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
    crashed: exitCode !== null && exitCode > 128,
  };
}

export interface InteractiveRunHandle {
  writeStdin(data: string): void;
  closeStdin(): void;
  kill(): void;
  onStdout(cb: (data: string) => void): void;
  onStderr(cb: (data: string) => void): void;
  onExit(cb: (result: { exitCode: number | null; timedOut: boolean; crashed: boolean }) => void): void;
}

export function startInteractiveRun(dir: string, language: Language): InteractiveRunHandle {
  const config = LANGUAGE_CONFIG[language];
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
    "-w", "/work",
    SANDBOX_IMAGE,
    "timeout", `${INTERACTIVE_RUN_TIMEOUT_SEC}s`,
    ...config.runCommand,
  ];

  const child = spawn("docker", dockerArgs, { stdio: ["pipe", "pipe", "pipe"] });

  let timedOut = false;
  const killTimer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, INTERACTIVE_RUN_TIMEOUT_SEC * 1000 + 2000);

  const stdoutHandlers: Array<(data: string) => void> = [];
  const stderrHandlers: Array<(data: string) => void> = [];
  const exitHandlers: Array<(result: { exitCode: number | null; timedOut: boolean; crashed: boolean }) => void> = [];

  child.stdout.on("data", (d) => {
    const text = d.toString();
    stdoutHandlers.forEach((cb) => cb(text));
  });
  child.stderr.on("data", (d) => {
    const text = d.toString();
    stderrHandlers.forEach((cb) => cb(text));
  });

  child.on("close", (code) => {
    clearTimeout(killTimer);
    const result = {
      exitCode: code,
      timedOut,
      crashed: code !== null && code > 128,
    };
    exitHandlers.forEach((cb) => cb(result));
  });

  return {
    writeStdin(data: string) {
      if (!child.stdin.destroyed) child.stdin.write(data);
    },
    closeStdin() {
      if (!child.stdin.destroyed) child.stdin.end();
    },
    kill() {
      clearTimeout(killTimer);
      child.kill("SIGKILL");
    },
    onStdout(cb) {
      stdoutHandlers.push(cb);
    },
    onStderr(cb) {
      stderrHandlers.push(cb);
    },
    onExit(cb) {
      exitHandlers.push(cb);
    },
  };
}
