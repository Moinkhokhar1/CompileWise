import { useRef, useState, useCallback } from "react";
import Editor, { OnMount } from "@monaco-editor/react";
import ErrorDiagram from "./ErrorDiagram";

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
  other: "Compiler error",
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
  const [showRawOutput, setShowRawOutput] = useState(false);

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
    const domNode = editor.getDomNode();
    domNode?.addEventListener("paste", (e) => e.preventDefault(), true);
    domNode?.addEventListener("copy", (e) => e.preventDefault(), true);
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
    setShowRawOutput(false);
    try {
      const data: SubmitResponse = await authedFetch("/api/compile/submit", { problemId, code });
      setResult(data);

      if (editorRef.current) {
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
      <div className="editor-panel">
        <div className="editor-toolbar">
          <span className="editor-toolbar-label">main.c</span>
          <button className="btn-primary btn-run" onClick={handleRun} disabled={loading}>
            {loading ? (
              <>
                <span className="spinner" /> Compiling…
              </>
            ) : (
              <>▶ Run</>
            )}
          </button>
        </div>
        <Editor
          height="60vh"
          defaultLanguage="c"
          value={code}
          onChange={(v) => setCode(v ?? "")}
          onMount={handleEditorMount}
          options={{ minimap: { enabled: false }, fontSize: 14, padding: { top: 12 } }}
        />
      </div>

      <div className="result-panel">
        {!result && (
          <div className="placeholder-panel">
            <div className="placeholder-icon">▶</div>
            <p>Click <strong>Run</strong> to compile your code.</p>
          </div>
        )}

        {result?.resolved && (
          <div className="success-card">
            <div className="panel-header success">
              <span className="status-icon success-icon">✓</span>
              <span>Compiled and ran successfully</span>
            </div>
            <div className="terminal-box">
              <pre>{result.stdout || "(no output)"}</pre>
            </div>
          </div>
        )}

        {!result?.resolved && primaryError && (() => {
          const err = primaryError;
          return (
            <div className="error-card">
              <div className="panel-header error">
                <span className="status-icon error-icon">!</span>
                <div>
                  <div className="panel-title">{CATEGORY_LABELS[err.category] ?? "Error"}</div>
                  <div className="panel-subtitle">Line {err.line}, Col {err.column}</div>
                </div>
              </div>

              <div className="panel-body">
                <ErrorDiagram
                  category={err.category}
                  message={err.message}
                  line={err.line}
                  codeLine={code.split("\n")[err.line - 1] ?? ""}
                />

                {result?.explanation && (
                  <div className="explain-box">
                    <div className="explain-row">
                      <span className="explain-label">What it means</span>
                      <p>{result.explanation.plain_explanation}</p>
                    </div>
                    <div className="explain-row">
                      <span className="explain-label">Why it happened here</span>
                      <p>{result.explanation.why_it_happened}</p>
                    </div>
                    <div className="explain-row">
                      <span className="explain-label">Concept</span>
                      <p>{result.explanation.concept}</p>
                    </div>
                  </div>
                )}

                <button className="raw-toggle" onClick={() => setShowRawOutput((v) => !v)}>
                  {showRawOutput ? "▾ Hide" : "▸ Show"} raw compiler output
                </button>
                {showRawOutput && (
                  <div className="terminal-box terminal-box-error">
                    <pre>{err.message}</pre>
                  </div>
                )}

                {hints.length > 0 && (
                  <div className="hint-timeline">
                    {hints.map((h) => (
                      <div key={h.level} className="hint-item">
                        <span className="hint-badge">{h.level}</span>
                        <p>{h.content}</p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="action-row">
                  {!canRequestPatch && hints.length < maxHints && (
                    <button className="btn-hint" onClick={handleHint}>
                      💡 Need hint? <span className="hint-count">{hints.length}/{maxHints}</span>
                    </button>
                  )}

                  {canRequestPatch && !patch && (
                    <button className="btn-patch" onClick={handlePatch}>
                      🔧 Show AI fix patch
                    </button>
                  )}
                </div>

                {patch && (
                  <div className="patch-card">
                    <div className="panel-header patch">
                      <span className="status-icon patch-icon">✦</span>
                      <span>AI-suggested fix</span>
                    </div>
                    <div className="terminal-box">
                      <pre>{patch.patchDiff}</pre>
                    </div>
                    <p className="patch-reasoning">{patch.reasoning}</p>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}