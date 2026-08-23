"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseGccDiagnostics = parseGccDiagnostics;
function categorize(message) {
    const m = message.toLowerCase();
    if (m.includes("expected ';'"))
        return "missing-semicolon";
    if (m.includes("expected '}'") || m.includes("expected '{'") || m.includes("unmatched"))
        return "unmatched-brace";
    if (m.includes("undeclared"))
        return "undeclared-identifier";
    if (m.includes("implicit declaration"))
        return "implicit-declaration";
    if (m.includes("incompatible") || m.includes("conflicting types") || m.includes("expected") && m.includes("but argument"))
        return "type-mismatch";
    if (m.includes("format") && (m.includes("%") || m.includes("specifies type")))
        return "format-string";
    if (m.includes("uninitialized"))
        return "uninitialized";
    if (m.includes("undefined reference"))
        return "linker";
    if (m.includes("expected"))
        return "syntax";
    return "other";
}
/**
 * Parses raw gcc -fdiagnostics-format=json stderr output. GCC emits one JSON
 * array per invocation; on some versions it can emit line-delimited objects
 * instead, so we handle both.
 */
function parseGccDiagnostics(raw) {
    if (!raw || !raw.trim())
        return [];
    let entries = [];
    const trimmed = raw.trim();
    try {
        if (trimmed.startsWith("[")) {
            entries = JSON.parse(trimmed);
        }
        else {
            // Fallback: line-delimited JSON objects
            entries = trimmed
                .split("\n")
                .filter((l) => l.trim().startsWith("{"))
                .map((l) => JSON.parse(l));
        }
    }
    catch {
        // Diagnostics weren't valid JSON (e.g. a fatal error before parsing began).
        // Return an "other" bucket so the caller still has something to show.
        return [
            {
                kind: "error",
                message: raw.slice(0, 2000),
                file: "main.c",
                line: 1,
                column: 1,
                category: "other",
            },
        ];
    }
    const parsed = [];
    for (const entry of entries) {
        const loc = entry.locations?.[0];
        if (!loc?.caret)
            continue;
        parsed.push({
            kind: entry.kind || "error",
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
