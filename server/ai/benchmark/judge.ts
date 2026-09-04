import { resolveTarget, hasPlatformKey, inferProvider, type ProviderCredentials } from "../providers";
import type { MessagePart } from "../providers";
import { estimateCostUsd } from "../pricing";
import { renderSchematicPng, modelSupportsVision } from "../schematic-image";
import { extractJson } from "./extract-json";

/**
 * Vision-judge panel for benchmark outputs.
 *
 * The validator scores what it can derive from the JSON - terminal ids,
 * fusing, polarity. It cannot see that a layout is cramped, that wires cross
 * the whole canvas, or that the drawing would embarrass an electrician. A
 * vision model looking at the rendered PNG can.
 *
 * One judge is noise: a single cheap model's 0-100 is worth little. The panel
 * asks several *different* models, reports the median, and keeps the standard
 * deviation so a split verdict is visible instead of silently averaged away.
 * Cheap models are deliberate - the money goes into the candidate generation
 * and the one-off Fable exemplars, not into grading.
 */

/** Preferred panel, best-first per vendor. Filtered by which keys exist. */
export const DEFAULT_JUDGE_MODELS = [
  "gpt-5-mini",
  "claude-haiku-4-5",
  // Not 2.5-flash: Google 404s it for new API users as of 2026-08.
  "gemini-3.6-flash",
];

/** Panel disagreement (stddev of overall scores) above this is low-confidence. */
export const JUDGE_DISAGREEMENT_THRESHOLD = 15;

export interface JudgeVerdict {
  model: string;
  ok: boolean;
  overall: number | null;
  dimensions: {
    layout: number | null;
    routing: number | null;
    correctness: number | null;
    completeness: number | null;
  };
  notes: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  durationMs: number;
  error?: string;
}

export interface JudgePanelResult {
  /** Median of the successful judges' overall scores. */
  score: number | null;
  /** Stddev across judges - the disagreement measure. */
  stdDev: number | null;
  /** True when judges disagree enough that the score should not be trusted alone. */
  lowConfidence: boolean;
  verdicts: JudgeVerdict[];
  costUsd: number | null;
  /** Whether an exemplar image was shown for calibration. */
  usedExemplar: boolean;
}

export interface JudgeInput {
  design: { components: any[]; wires: any[] };
  /** The brief the design was generated from. */
  prompt: string;
  systemVoltage: number;
  /** A known-good design for the same case, rendered as a calibration anchor. */
  exemplar?: { components: any[]; wires: any[] } | null;
  judges?: string[];
  credentials?: ProviderCredentials | null;
  signal?: AbortSignal;
}

/** The default panel narrowed to providers that can actually be called. */
export function availableJudges(preferred: string[] = DEFAULT_JUDGE_MODELS): string[] {
  return preferred.filter(m => hasPlatformKey(inferProvider(m)));
}

const JUDGE_SYSTEM_PROMPT = `You are a strict grader of electrical schematic designs for Victron (marine/RV solar) systems. You are shown a rendered schematic image plus a summary of its parts, and you grade the quality of the work.

Grade each dimension 0-100 (100 = professional, publishable work):
- layout: spacing and placement. Overlapping components, cramped corners next to empty space, or misaligned rows score low.
- routing: wire paths. Wires crossing the whole canvas, tangles of crossings, or connections between far-apart components that should be adjacent score low.
- correctness: electrical sanity visible in the drawing - fusing near the battery, a shunt in the negative path, sensible bus bar use, polarity colours consistent (red positive, dark negative).
- completeness: does the design plausibly satisfy the brief, with nothing obviously missing or superfluous.

Then give "overall" as your holistic judgment (not a mechanical average).

Be strict. A mediocre design should land near 50, not 75. Reserve 90+ for work with no visible flaws.

Respond with a single JSON object, no markdown fences:
{"overall": 0-100, "layout": 0-100, "routing": 0-100, "correctness": 0-100, "completeness": 0-100, "notes": "two or three specific observations"}`;

function designSummary(design: { components: any[]; wires: any[] }): string {
  const parts = design.components.map(
    c => `- ${c.type} "${c.name ?? c.id}" at (${c.x}, ${c.y})`
  );
  return `${design.components.length} components, ${design.wires.length} wires:\n${parts.join("\n")}`;
}

function buildJudgeUserContent(input: JudgeInput, exemplarAttached: boolean): MessagePart[] {
  const candidate = renderSchematicPng(input.design.components, input.design.wires, {
    maxDimension: 1024,
  });

  const intro = [
    `The design brief was: "${input.prompt}" (${input.systemVoltage}V system).`,
    "",
    `Candidate design - ${designSummary(input.design)}`,
    "",
    exemplarAttached
      ? "The FIRST image is the candidate to grade. The SECOND image is a reference example of high-quality work for a similar brief - use it only to calibrate your standards; grade the candidate on its own merits."
      : "The image is the candidate to grade.",
  ].join("\n");

  const parts: MessagePart[] = [
    { type: "text", text: intro },
    { type: "image", dataUrl: candidate.dataUrl },
  ];

  if (exemplarAttached && input.exemplar) {
    const reference = renderSchematicPng(input.exemplar.components, input.exemplar.wires, {
      maxDimension: 1024,
    });
    parts.push({ type: "image", dataUrl: reference.dataUrl });
  }

  return parts;
}

const clamp = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
};

/**
 * One retry per judge: a dropped judge shrinks the panel to low-confidence,
 * so a transient empty response or rate limit is worth a second attempt.
 */
async function runOneJudge(model: string, content: MessagePart[], input: JudgeInput): Promise<JudgeVerdict> {
  const first = await judgeAttempt(model, content, input);
  if (first.ok || input.signal?.aborted) return first;
  const second = await judgeAttempt(model, content, input);
  if (second.ok) return second;
  // Report the first failure - it is the one a retry was supposed to cure.
  return { ...second, error: first.error ?? second.error };
}

async function judgeAttempt(model: string, content: MessagePart[], input: JudgeInput): Promise<JudgeVerdict> {
  const started = Date.now();
  const base: JudgeVerdict = {
    model,
    ok: false,
    overall: null,
    dimensions: { layout: null, routing: null, correctness: null, completeness: null },
    notes: null,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: null,
    durationMs: 0,
  };

  try {
    const target = resolveTarget({ model, userCredentials: input.credentials ?? null });
    const response = await target.provider.chat(
      {
        model,
        json: true,
        maxOutputTokens: 2000,
        signal: input.signal,
        messages: [
          { role: "system", content: JUDGE_SYSTEM_PROMPT },
          { role: "user", content },
        ],
      },
      target.credentials
    );

    const parsed = extractJson(response.text);
    const overall = clamp(parsed.overall);
    if (overall === null) throw new Error("Judge returned no usable overall score");

    return {
      ...base,
      ok: true,
      overall,
      dimensions: {
        layout: clamp(parsed.layout),
        routing: clamp(parsed.routing),
        correctness: clamp(parsed.correctness),
        completeness: clamp(parsed.completeness),
      },
      notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 2000) : null,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      costUsd: estimateCostUsd(model, response.usage),
      durationMs: Date.now() - started,
    };
  } catch (err: any) {
    return { ...base, durationMs: Date.now() - started, error: err?.message ?? String(err) };
  }
}

/** Aggregate a set of verdicts. Exported for tests. */
export function aggregateVerdicts(verdicts: JudgeVerdict[], usedExemplar: boolean): JudgePanelResult {
  const scores = verdicts
    .filter(v => v.ok && v.overall !== null)
    .map(v => v.overall!)
    .sort((a, b) => a - b);

  let score: number | null = null;
  if (scores.length) {
    const mid = Math.floor(scores.length / 2);
    score = scores.length % 2 ? scores[mid] : Math.round((scores[mid - 1] + scores[mid]) / 2);
  }

  let stdDev: number | null = null;
  if (scores.length >= 2) {
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    stdDev = Math.sqrt(scores.reduce((a, x) => a + (x - mean) ** 2, 0) / (scores.length - 1));
  }

  const costs = verdicts.map(v => v.costUsd).filter((c): c is number => typeof c === "number");

  return {
    score,
    stdDev,
    // A single judge is unaccountable, and a split panel is unresolved - both
    // mean "look at the notes before acting on the number".
    lowConfidence:
      scores.length < 2 || (stdDev !== null && stdDev > JUDGE_DISAGREEMENT_THRESHOLD),
    verdicts,
    costUsd: costs.length ? costs.reduce((a, c) => a + c, 0) : null,
    usedExemplar,
  };
}

export async function judgeDesign(input: JudgeInput): Promise<JudgePanelResult> {
  const judges = (input.judges?.length ? input.judges : availableJudges()).filter(m => {
    if (!modelSupportsVision(m)) {
      console.warn(`[judge] ${m} is not vision-capable; skipping`);
      return false;
    }
    return true;
  });
  if (!judges.length) throw new Error("No vision-capable judge models available");

  const usedExemplar = Boolean(input.exemplar?.components?.length);
  const content = buildJudgeUserContent(input, usedExemplar);

  const verdicts = await Promise.all(judges.map(m => runOneJudge(m, content, input)));
  return aggregateVerdicts(verdicts, usedExemplar);
}
