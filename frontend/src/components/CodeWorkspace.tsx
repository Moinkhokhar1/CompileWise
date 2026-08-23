import { useRef, useState, useCallback } from "react";
import Editor, { OnMount } from "@monaco-editor/react";

interface Diagnostic {
  kind: "error" | "warning" | "note";
  message: string;
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  category: string;
}

interface Explanation {
  plain_explanation: string;
  why_it_happened: string;
  concept: string;
}

interface SubmitResponse {
  submissionId: string;
  attemptId: string;
  resolved: boolean;
  diagnostics: Diagnostic[];
  stdout: string;
  stderr: string;
  crashed: boolean;
  timedOut: boolean;
  explanation: Explanation | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  "missing-semicolon": "Missing semicolon",
  "unmatched-brace": "Unmatched bracket/brace",
  "undeclared-identifier": "Undeclared variable/function",
  "implicit-declaration": "Function used before declaring it",
  "type-mismatch": "Type mismatch",
  "format-string": "printf/scanf format mismatch",
  uninitialized: "Uninitialized variable",
  linker: "Linker error (missing definition)",
  syntax: "Syntax error",
  other: "Error",
};

export default function CodeWorkspace({
  problemId,
  starterCode,
  authToken,
  apiBase,
  maxHints = 3,
}: {
  problemId: string;
  starterCode: string;
  authToken: string;
  apiBase: string;
  maxHints?: number;
}) {
  const editorRef = useRef<any>(null);
  const [code, setCode] = useState(starterCode);
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [hints, setHints] = useState<{ level: number; content: string }[]>([]);
  const [patch, setPatch] = useState<{ patchDiff: string; reasoning: string } | null>(null);
  const [loading, setLoading] = useState(false);

  // --- Block paste (deterrent, not a hard guarantee - see backend logging too) ---
  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
    const domNode = editor.getDomNode();
    domNode?.addEventListener("paste", (e) => e.preventDefault(), true);
    domNode?.addEventListener("copy", (e) => e.preventDefault(), true); // optional: block copy too
  };

  const authedFetch = useCallback(
    (path: string, body: unknown) =>
      fetch(`${apiBase}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    [apiBase, authToken]
  );

  async function handleRun() {
    setLoading(true);
    setHints([]);
    setPatch(null);
    try {
      const data: SubmitResponse = await authedFetch("/api/compile/submit", { problemId, code });
      setResult(data);

      // Highlight the error line(s) in the editor
      if (editorRef.current && data.diagnostics.length > 0) {
        const monaco = (window as any).monaco;
        const markers = data.diagnostics.map((d) => ({
          startLineNumber: d.line,
          startColumn: d.column,
          endLineNumber: d.endLine ?? d.line,
          endColumn: d.endColumn ?? d.column + 1,
          message: d.message,
          severity:
            d.kind === "error"
              ? monaco.MarkerSeverity.Error
              : d.kind === "warning"
              ? monaco.MarkerSeverity.Warning
              : monaco.MarkerSeverity.Info,
        }));
        monaco.editor.setModelMarkers(editorRef.current.getModel(), "compiler", markers);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleHint() {
    if (!result) return;
    const data = await authedFetch("/api/help/hint", { attemptId: result.attemptId });
    if (data.error) {
      alert(data.message ?? data.error);
      return;
    }
    setHints((prev) => [...prev, { level: data.level, content: data.content }]);
  }

  async function handlePatch() {
    if (!result) return;
    const data = await authedFetch("/api/help/ai-patch", { attemptId: result.attemptId });
    if (data.error) {
      alert(data.error);
      return;
    }
    setPatch({ patchDiff: data.patchDiff, reasoning: data.reasoning });
  }

  const primaryError = result?.diagnostics.find((d) => d.kind === "error");
  const canRequestPatch = hints.length >= maxHints && !result?.resolved;

    return (
    <div className="workspace-grid">
      <div>
        <Editor
          height="60vh"
          defaultLanguage="c"
          value={code}
          onChange={(v) => setCode(v ?? "")}
          onMount={handleEditorMount}
          options={{ minimap: { enabled: false }, fontSize: 14 }}
        />
        <button className="btn-primary" onClick={handleRun} disabled={loading} style={{ marginTop: 8 }}>
          {loading ? "Compiling…" : "Run"}
        </button>
      </div>

      <div style={{ overflowY: "auto" }}>
        {result?.resolved && (
          <div className="success-panel">
            ✅ Compiled and ran successfully.
            <pre>{result.stdout}</pre>
          </div>
        )}

        {!result?.resolved && primaryError && (
          <div className="error-panel">
            <strong>{CATEGORY_LABELS[primaryError.category] ?? "Error"}</strong>
            <div className="error-detail">Line {primaryError.line}, Col {primaryError.column}</div>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{primaryError.message}</pre>

            {result?.explanation && (
              <div className="explain-box">
                <p><strong>What this means:</strong> {result.explanation.plain_explanation}</p>
                <p><strong>Why it happened here:</strong> {result.explanation.why_it_happened}</p>
                <p><strong>Concept:</strong> {result.explanation.concept}</p>
              </div>
            )}

            {hints.map((h) => (
              <div key={h.level} className="hint-box">
                <strong>Hint {h.level}:</strong> {h.content}
              </div>
            ))}

            {!canRequestPatch && hints.length < maxHints && (
              <button className="btn-secondary" onClick={handleHint} style={{ marginTop: 12 }}>
                Need hint? ({hints.length}/{maxHints} used)
              </button>
            )}

            {canRequestPatch && !patch && (
              <button className="btn-secondary" onClick={handlePatch} style={{ marginTop: 12 }}>
                Show AI fix patch
              </button>
            )}

            {patch && (
              <div className="patch-box">
                <strong>AI patch:</strong>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{patch.patchDiff}</pre>
                <p style={{ fontSize: 13 }}>{patch.reasoning}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}