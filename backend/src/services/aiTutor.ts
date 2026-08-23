import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { ParsedDiagnostic } from "./diagnosticsParser";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const MODEL = "gemini-3.6-flash"; // fast + cheap, good fit for hint/explain latency; swap to gemini-1.5-pro if you want stronger reasoning

function buildContext(code: string, diagnostics: ParsedDiagnostic[]) {
  const errorLines = diagnostics
    .map((d) => `Line ${d.line}, Col ${d.column} [${d.kind}/${d.category}]: ${d.message}`)
    .join("\n");
  return `Student's C code:\n\`\`\`c\n${code}\n\`\`\`\n\nCompiler diagnostics:\n${errorLines}`;
}

// Gemini returns response.text() as a single string; helper keeps the
// call sites below symmetrical with how the Anthropic version worked.
async function callGemini(system: string, userContent: string, opts: { json?: boolean; maxTokens: number }) {
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: system,
    generationConfig: {
      maxOutputTokens: opts.maxTokens,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  });

  const result = await model.generateContent(userContent);
  return result.response.text();
}

/**
 * Plain-language explanation of the error(s), aimed at a first-semester student.
 * Returned as structured JSON so the frontend can render it inside the
 * error-visualization panel (not just as a paragraph).
 */
export async function explainError(code: string, diagnostics: ParsedDiagnostic[]) {
  const system = `You are a patient C programming tutor for first-semester students.
Given code and a compiler diagnostic, explain in simple, non-jargon language:
1. What the error means in plain English
2. Why it happened in THIS specific code (point to the exact construct)
3. The underlying concept the student should understand (in one sentence)

Do NOT give the corrected code or the exact fix. Only build understanding.
Respond ONLY with JSON, no markdown fences, no preamble:
{"plain_explanation": string, "why_it_happened": string, "concept": string}`;

  const text = await callGemini(system, buildContext(code, diagnostics), { json: true, maxTokens: 500 });
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

/**
 * Progressive hint generator. level 1 = vague nudge, level 3 = near-complete
 * conceptual pointer, but still never the literal fixed line.
 */
export async function generateHint(
  code: string,
  diagnostics: ParsedDiagnostic[],
  level: 1 | 2 | 3,
  previousHints: string[]
) {
  const specificity = {
    1: "Very general — point only to the broad area/category of the problem (e.g. 'check your loop bounds'). Do not mention line numbers.",
    2: "More specific — point to the exact line and what kind of mistake is likely there, without stating the fix.",
    3: "Strongly guiding — describe almost exactly what needs to change conceptually, but still do not write the corrected code.",
  }[level];

  const system = `You are a C tutor giving hint level ${level} of 3 to a first-semester student.
Specificity for this level: ${specificity}
Never provide corrected code. Keep it to 1-3 sentences.
Previous hints already given (do not repeat them): ${previousHints.join(" | ") || "none"}
Respond with plain text only, no JSON, no markdown.`;

  const text = await callGemini(system, buildContext(code, diagnostics), { maxTokens: 200 });
  return text.trim();
}

/**
 * Final AI patch after all hints are exhausted and the error persists.
 * Still includes reasoning, not just the diff, to keep it pedagogical.
 */
export async function generatePatch(code: string, diagnostics: ParsedDiagnostic[], previousHints: string[]) {
  const system = `You are a C tutor. The student has used all 3 hints and is still stuck.
Provide a minimal fix and a short explanation of why it works, tied back to the
hints already given: ${previousHints.join(" | ")}
Respond ONLY with JSON, no markdown fences:
{"patched_code": string, "reasoning": string, "concept_reinforced": string}`;

  const text = await callGemini(system, buildContext(code, diagnostics), { json: true, maxTokens: 1200 });
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}
