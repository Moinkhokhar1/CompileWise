import { FinishReason, GenerationConfig, GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { ParsedDiagnostic } from "./diagnosticsParser";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const MODEL = "gemini-3.6-flash"; // fast + cheap, good fit for hint/explain latency; swap to gemini-1.5-pro if you want stronger reasoning

// Optional: "low" | "medium" | "high". Unset means we don't send thinkingConfig
// at all, which keeps this working on model versions that don't accept it.
const THINKING_LEVEL = process.env.GEMINI_THINKING_LEVEL;

function buildContext(code: string, diagnostics: ParsedDiagnostic[]) {
  const errorLines = diagnostics
    .map((d) => `Line ${d.line}, Col ${d.column} [${d.kind}/${d.category}]: ${d.message}`)
    .join("\n");
  return `Student's C code:\n\`\`\`c\n${code}\n\`\`\`\n\nCompiler diagnostics:\n${errorLines}`;
}

// Gemini returns response.text() as a single string; helper keeps the
// call sites below symmetrical with how the Anthropic version worked.
//
// Important: this is a reasoning model, and its internal thinking tokens are
// charged against maxOutputTokens. A budget sized for the visible answer alone
// gets swallowed by thinking, the candidate comes back with
// finishReason: MAX_TOKENS, and the SDK does NOT treat that as an error --
// text() just hands back whatever fragment escaped (often a few characters,
// sometimes ""). That is how half-written hints reached students. So: budget
// generously, retry once at double, and refuse to return a truncated answer.
async function callGemini(
  system: string,
  userContent: string,
  opts: { json?: boolean; maxTokens: number; label: string }
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const maxOutputTokens = opts.maxTokens * (attempt + 1);
    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: system,
      generationConfig: {
        maxOutputTokens,
        ...(opts.json ? { responseMimeType: "application/json" } : {}),
        ...(THINKING_LEVEL ? { thinkingConfig: { thinkingLevel: THINKING_LEVEL } } : {}),
      } as GenerationConfig,
    });

    const result = await model.generateContent(userContent);
    const candidate = result.response.candidates?.[0];
    const text = result.response.text().trim();

    if (candidate?.finishReason === FinishReason.MAX_TOKENS) {
      const usage = result.response.usageMetadata as { thoughtsTokenCount?: number } | undefined;
      console.warn(
        `[aiTutor] ${opts.label} truncated at maxOutputTokens=${maxOutputTokens} ` +
          `(visible text ${text.length} chars, thinking ${usage?.thoughtsTokenCount ?? "?"} tokens)` +
          (attempt === 0 ? " - retrying with double the budget" : "")
      );
      continue;
    }
    if (!text) {
      throw new Error(`${opts.label}: model returned no text (finishReason=${candidate?.finishReason ?? "none"})`);
    }
    return text;
  }

  throw new Error(`${opts.label}: response still truncated by the token limit after a retry`);
}

// The model is asked for bare JSON, but a stray fence or preamble shouldn't
// take the whole feature down - pull out the outermost object before parsing.
function parseJson<T>(raw: string, label: string): T {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const body = cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1);
  try {
    return JSON.parse(body || cleaned) as T;
  } catch {
    throw new Error(`${label}: model did not return valid JSON (got ${raw.length} chars)`);
  }
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

  const text = await callGemini(system, buildContext(code, diagnostics), {
    json: true,
    maxTokens: 4096,
    label: "explainError",
  });
  return parseJson<{ plain_explanation: string; why_it_happened: string; concept: string }>(text, "explainError");
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

  // 2048 is far more than 1-3 sentences needs; the headroom is for the model's
  // thinking pass, which bills against the same budget.
  const text = await callGemini(system, buildContext(code, diagnostics), {
    maxTokens: 2048,
    label: `generateHint(level ${level})`,
  });
  return text;
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
