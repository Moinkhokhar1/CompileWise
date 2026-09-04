import { Language, LANGUAGE_CONFIG } from "../sandbox/languages";

export interface ParsedDiagnostic {
  kind: "error" | "warning" | "note";
  message: string;
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  category: ErrorCategory;
}

export type ErrorCategory =
  | "syntax"
  | "undeclared-identifier"
  | "type-mismatch"
  | "missing-semicolon"
  | "unmatched-brace"
  | "implicit-declaration"
  | "linker"
  | "format-string"
  | "uninitialized"
  | "other";

interface GccJsonDiagnostic {
  kind: string;
  message: string;
  locations?: Array<{
    caret?: { file: string; line: number; column: number };
    finish?: { file: string; line: number; column: number };
  }>;
}

function categorize(message: string): ErrorCategory {
  const m = message.toLowerCase();
  if (m.includes("expected ';'") || m.includes("';' expected")) return "missing-semicolon";
  if (m.includes("expected '}'") || m.includes("expected '{'") || m.includes("unmatched")) return "unmatched-brace";
  if (m.includes("undeclared") || m.includes("cannot find symbol") || m.includes("cannot resolve")) return "undeclared-identifier";
  if (m.includes("implicit declaration")) return "implicit-declaration";
  if (m.includes("incompatible") || m.includes("conflicting types") || (m.includes("expected") && m.includes("but argument"))) return "type-mismatch";
  if (m.includes("format") && (m.includes("%") || m.includes("specifies type"))) return "format-string";
  if (m.includes("uninitialized")) return "uninitialized";
  if (m.includes("undefined reference")) return "linker";
  if (m.includes("indentationerror") || m.includes("syntaxerror") || m.includes("expected")) return "syntax";
  return "other";
}

export function parseDiagnostics(raw: string, language: Language): ParsedDiagnostic[] {
  const sourceFile = LANGUAGE_CONFIG[language].sourceFile;
  switch (language) {
    case "C":
    case "CPP":
      return parseGccDiagnostics(raw, sourceFile);
    case "JAVA":
      return parseJavaDiagnostics(raw, sourceFile);
    case "PYTHON":
      return parsePythonDiagnostics(raw, sourceFile);
  }
}

export function parseGccDiagnostics(raw: string, sourceFile = "main.c"): ParsedDiagnostic[] {
  if (!raw || !raw.trim()) return [];

  let entries: GccJsonDiagnostic[] = [];
  const trimmed = raw.trim();

  try {
    if (trimmed.startsWith("[")) {
      entries = JSON.parse(trimmed);
    } else {
      entries = trimmed
        .split("\n")
        .filter((l) => l.trim().startsWith("{"))
        .map((l) => JSON.parse(l));
    }
  } catch {
    const cleaned = trimmed.replace(/^\[\]\s*/, "").trim();
    const isLinkerError = /undefined reference to/i.test(cleaned);
    return [
      {
        kind: "error",
        message: cleaned.slice(0, 2000) || raw.slice(0, 2000),
        file: sourceFile,
        line: 1,
        column: 1,
        category: isLinkerError ? "linker" : "other",
      },
    ];
  }

  const parsed: ParsedDiagnostic[] = [];
  for (const entry of entries) {
    const loc = entry.locations?.[0];
    if (!loc?.caret) continue;
    parsed.push({
      kind: (entry.kind as ParsedDiagnostic["kind"]) || "error",
      message: entry.message,
      file: loc.caret.file,
      line: loc.caret.line,
      column: loc.caret.column,
      endLine: loc.finish?.line,
      endColumn: loc.finish?.column,
      category: categorize(entry.message),
    });
  }
  return parsed;
}

function parseJavaDiagnostics(raw: string, sourceFile: string): ParsedDiagnostic[] {
  if (!raw || !raw.trim()) return [];

  const parsed: ParsedDiagnostic[] = [];
  const lineRe = /^(.+\.java):(\d+):\s*(error|warning):\s*(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = lineRe.exec(raw)) !== null) {
    parsed.push({
      kind: match[3] as ParsedDiagnostic["kind"],
      message: match[4],
      file: match[1],
      line: parseInt(match[2], 10),
      column: 1,
      category: categorize(match[4]),
    });
  }

  if (parsed.length === 0) {
    return [
      {
        kind: "error",
        message: raw.trim().slice(0, 2000),
        file: sourceFile,
        line: 1,
        column: 1,
        category: categorize(raw),
      },
    ];
  }

  return parsed;
}

function parsePythonDiagnostics(raw: string, sourceFile: string): ParsedDiagnostic[] {
  if (!raw || !raw.trim()) return [];

  const trimmed = raw.trim();
  const lineMatch = trimmed.match(/File "(?:\/work\/)?([^"]+)", line (\d+)/);
  const errorMatch = trimmed.match(/^(\w+Error|\w+Exception):\s*(.+)$/m);

  const line = lineMatch ? parseInt(lineMatch[2], 10) : 1;
  const message = errorMatch ? `${errorMatch[1]}: ${errorMatch[2]}` : trimmed.slice(0, 2000);

  return [
    {
      kind: "error",
      message,
      file: lineMatch?.[1] ?? sourceFile,
      line,
      column: 1,
      category: categorize(message),
    },
  ];
}
