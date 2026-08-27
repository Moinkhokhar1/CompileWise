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

// GCC's -fdiagnostics-format=json emits an array of objects; each has
// "kind", "message", and a "locations" array with "caret"/"finish" positions.
interface GccJsonDiagnostic {
  kind: string;
  message: string;
  locations?: Array<{
    caret?: { file: string; line: number; "column": number };
    finish?: { file: string; line: number; "column": number };
  }>;
}

function categorize(message: string): ErrorCategory {
  const m = message.toLowerCase();
  if (m.includes("expected ';'")) return "missing-semicolon";
  if (m.includes("expected '}'") || m.includes("expected '{'") || m.includes("unmatched")) return "unmatched-brace";
  if (m.includes("undeclared")) return "undeclared-identifier";
  if (m.includes("implicit declaration")) return "implicit-declaration";
  if (m.includes("incompatible") || m.includes("conflicting types") || m.includes("expected") && m.includes("but argument")) return "type-mismatch";
  if (m.includes("format") && (m.includes("%") || m.includes("specifies type"))) return "format-string";
  if (m.includes("uninitialized")) return "uninitialized";
  if (m.includes("undefined reference")) return "linker";
  if (m.includes("expected")) return "syntax";
  return "other";
}

/**
 * Parses raw gcc -fdiagnostics-format=json stderr output. GCC emits one JSON
 * array per invocation; on some versions it can emit line-delimited objects
 * instead, so we handle both.
 */
export function parseGccDiagnostics(raw: string): ParsedDiagnostic[] {
  if (!raw || !raw.trim()) return [];

  let entries: GccJsonDiagnostic[] = [];
  const trimmed = raw.trim();

  try {
    if (trimmed.startsWith("[")) {
      entries = JSON.parse(trimmed);
    } else {
      // Fallback: line-delimited JSON objects
      entries = trimmed
        .split("\n")
        .filter((l) => l.trim().startsWith("{"))
        .map((l) => JSON.parse(l));
    }
  } catch {
    // Diagnostics weren't valid JSON — typically a linker error, since `ld`
    // writes plain text (gcc's own "[]" empty-array JSON for a successful
    // compile ends up prefixed onto it). Strip that prefix and detect the
    // linker case specifically so it gets its own diagram instead of "other".
    const cleaned = trimmed.replace(/^\[\]\s*/, "").trim();
    const isLinkerError = /undefined reference to/i.test(cleaned);
    return [
      {
        kind: "error",
        message: cleaned.slice(0, 2000) || raw.slice(0, 2000),
        file: "main.c",
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
