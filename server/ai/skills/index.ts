import { sharedDesignRules } from "./fragments";

/**
 * Named, versioned prompt definitions.
 *
 * Before this existed the system prompt was pasted inline in four places in
 * routes.ts - two of them byte-identical 287-line copies. Every edit had to be
 * made two to four times, and one that wasn't cost ten terminal repairs per
 * generated design. A skill is the single source for one task, and the version
 * string is what makes prompt A/B testing meaningful.
 */

export interface SkillContext {
  systemVoltage: number;
  /** Feedback from the previous validation pass, for iterative refinement. */
  feedback?: string;
  /** Existing design being refined or wired. */
  existingDesign?: { components: unknown[]; wires: unknown[] };
  deviceCatalog?: string;
}

export interface Skill {
  id: string;
  version: string;
  description: string;
  buildSystemPrompt(ctx: SkillContext): string;
  buildUserPrompt(prompt: string, ctx: SkillContext): string;
  /** Response is expected to be a JSON object. */
  json: boolean;
}

const JSON_SHAPE = `RESPONSE FORMAT - return a single JSON object, no markdown fences:
{
  "components": [
    {"id": "battery-1", "type": "battery", "name": "House Bank", "x": 200, "y": 400,
     "properties": {"voltage": 12, "capacity": 400, "batteryType": "LiFePO4"}}
  ],
  "wires": [
    {"fromComponentId": "battery-1", "toComponentId": "fuse-1", "fromTerminal": "positive",
     "toTerminal": "in", "polarity": "positive", "gauge": "4/0 AWG", "length": 2}
  ],
  "description": "one paragraph summary",
  "recommendations": ["short actionable notes"]
}

EVERY component MUST carry realistic "properties". Loads need watts (never 0):
LED lights 10-50W, fridge 50-150W, microwave 1000-1500W, air conditioner 1000-1800W.
Solar panels need BOTH watts and voltage (Vmp, e.g. 18/36/72 - not system voltage).`;

/** Full system design from a natural-language brief. */
export const systemDesignSkill: Skill = {
  id: "system-design",
  version: "2026-08-20.2",
  description: "Design a complete Victron electrical system from a description",
  json: true,
  buildSystemPrompt(ctx) {
    return [
      "You are an expert electrical system designer specializing in Victron Energy marine and RV systems. Design complete, safe, code-compliant electrical systems.",
      `SYSTEM VOLTAGE: ${ctx.systemVoltage}V DC`,
      sharedDesignRules(),
      ctx.deviceCatalog ? `DEVICE REFERENCE:\n${ctx.deviceCatalog}` : "",
      JSON_SHAPE,
    ]
      .filter(Boolean)
      .join("\n\n");
  },
  buildUserPrompt(prompt, ctx) {
    if (ctx.feedback) {
      return [
        `Original request: ${prompt}`,
        "",
        "Your previous design had these problems. Produce a corrected COMPLETE design:",
        ctx.feedback,
      ].join("\n");
    }
    return prompt;
  },
};

/** Wire up components the user has already placed. */
export const wireComponentsSkill: Skill = {
  id: "wire-components",
  version: "2026-08-20.2",
  description: "Create wire connections between components already on the canvas",
  json: true,
  buildSystemPrompt(ctx) {
    return [
      "You are an expert Victron electrical system designer. Your task is to create wire connections for components the user has already placed on a canvas.",
      "CRITICAL: preserve every existing wire that is correct. Only add wires that are missing, and only remove one if it is genuinely wrong.",
      `SYSTEM VOLTAGE: ${ctx.systemVoltage}V DC`,
      sharedDesignRules(),
      `RESPONSE FORMAT - return a single JSON object, no markdown fences:
{
  "wires": [
    {"fromComponentId": "...", "toComponentId": "...", "fromTerminal": "...",
     "toTerminal": "...", "polarity": "positive", "gauge": "4/0 AWG", "length": 3}
  ],
  "description": "what you connected and why"
}
Do NOT invent components - wire only the ids you are given.`,
    ]
      .filter(Boolean)
      .join("\n\n");
  },
  buildUserPrompt(prompt, ctx) {
    const design = ctx.existingDesign
      ? `\n\nComponents on the canvas:\n${JSON.stringify(ctx.existingDesign.components, null, 2)}\n\nExisting wires:\n${JSON.stringify(ctx.existingDesign.wires, null, 2)}`
      : "";
    const feedback = ctx.feedback ? `\n\nProblems to fix:\n${ctx.feedback}` : "";
    return `${prompt}${design}${feedback}`;
  },
};

export const SKILLS: Record<string, Skill> = {
  [systemDesignSkill.id]: systemDesignSkill,
  [wireComponentsSkill.id]: wireComponentsSkill,
};

export function getSkill(id: string): Skill {
  const skill = SKILLS[id];
  if (!skill) throw new Error(`Unknown skill "${id}". Known: ${Object.keys(SKILLS).join(", ")}`);
  return skill;
}

export function listSkills() {
  return Object.values(SKILLS).map(s => ({
    id: s.id,
    version: s.version,
    description: s.description,
  }));
}
