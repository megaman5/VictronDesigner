import { z } from "zod";
import type { SchematicComponent, Wire } from "./schema";

export const DESIGN_DOCUMENT_VERSION = 1 as const;

const finite = z.number().finite();
const componentSchema = z.object({
  id: z.string().min(1), type: z.string().min(1), name: z.string(),
  x: finite, y: finite, properties: z.record(z.unknown()).default({}),
}).passthrough();
const wireSchema = z.object({
  id: z.string().min(1), fromComponentId: z.string().min(1), toComponentId: z.string().min(1),
  // Empty terminal names are retained for legacy center-to-center wires.
  fromTerminal: z.string().default(""), toTerminal: z.string().default(""),
  polarity: z.enum(["positive", "negative", "hot", "neutral", "ground"]),
  length: finite.nonnegative(), gauge: z.string().optional(), current: finite.nonnegative().optional(),
  voltageDrop: finite.optional(), conductorMaterial: z.enum(["copper", "aluminum"]).optional(),
  waypoints: z.array(z.object({ x: finite, y: finite })).optional(),
}).passthrough();

export interface DesignDocument {
  schemaVersion: typeof DESIGN_DOCUMENT_VERSION;
  metadata: { id?: string; name: string; description?: string; [key: string]: unknown };
  systemVoltage: number;
  components: SchematicComponent[];
  wires: Wire[];
  calculationOptions: Record<string, unknown>;
  requirements?: unknown;
  [key: string]: unknown;
}

export const designDocumentSchema = z.object({
  schemaVersion: z.literal(DESIGN_DOCUMENT_VERSION),
  metadata: z.object({ id: z.string().optional(), name: z.string(), description: z.string().optional() }).passthrough(),
  systemVoltage: finite.positive(),
  components: z.array(componentSchema), wires: z.array(wireSchema),
  calculationOptions: z.record(z.unknown()).default({}),
}).passthrough().superRefine((document, context) => {
  const componentIds = new Set<string>();
  const wireIds = new Set<string>();
  document.components.forEach((component, index) => {
    if (componentIds.has(component.id)) context.addIssue({ code: "custom", path: ["components", index, "id"], message: `Duplicate component ID: ${component.id}` });
    componentIds.add(component.id);
  });
  document.wires.forEach((wire, index) => {
    if (wireIds.has(wire.id)) context.addIssue({ code: "custom", path: ["wires", index, "id"], message: `Duplicate wire ID: ${wire.id}` });
    wireIds.add(wire.id);
    for (const field of ["fromComponentId", "toComponentId"] as const) {
      if (!componentIds.has(wire[field])) context.addIssue({ code: "custom", path: ["wires", index, field], message: `Wire ${wire.id} references missing component ${wire[field]}` });
    }
  });
});

/** Loads both versioned documents and existing API/local recovery records without stripping extensions. */
export function loadDesignDocument(input: unknown): DesignDocument {
  const record = z.record(z.unknown()).parse(input);
  const adapted = record.schemaVersion === undefined ? {
    ...record,
    schemaVersion: DESIGN_DOCUMENT_VERSION,
    metadata: { ...(typeof record.metadata === "object" && record.metadata ? record.metadata : {}),
      ...(typeof record.id === "string" ? { id: record.id } : {}),
      name: typeof record.name === "string" ? record.name : "Untitled design",
      ...(typeof record.description === "string" ? { description: record.description } : {}),
    },
    systemVoltage: record.systemVoltage ?? 12,
    components: record.components ?? [], wires: record.wires ?? [],
    calculationOptions: record.calculationOptions ?? {},
  } : record;
  return designDocumentSchema.parse(adapted) as DesignDocument;
}

export function createDesignDocument(): DesignDocument {
  return loadDesignDocument({ components: [], wires: [], systemVoltage: 12 });
}

/** Stable across object key order, unlike JSON.stringify of an incoming payload. */
export function documentFingerprint(document: DesignDocument): string {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
    return JSON.stringify(value) ?? "null";
  };
  let hash = 2166136261;
  for (const char of canonical(document)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `v${document.schemaVersion}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
