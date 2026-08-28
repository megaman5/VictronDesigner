import type { Terminal } from "./terminal-config";

/**
 * Client-side types and API helpers for user-defined ("Phase 1") custom
 * component definitions. See docs/custom-components-design.md.
 *
 * A definition is the reusable "part" a user designs once in the
 * CustomComponentEditor. Placing one on the canvas creates a normal
 * SchematicComponent of type "custom" whose properties SNAPSHOT the
 * definition's terminals/width/height/name/subtitle/appearance at that
 * moment - see toPlacedProperties() below - so a saved schematic keeps
 * rendering correctly even if the definition is later edited or deleted.
 */

export interface CustomComponentAppearance {
  bodyColor?: string;
}

export interface CustomComponentDefinition {
  id: string;
  ownerId: string;
  name: string;
  subtitle: string | null;
  category: string;
  width: number;
  height: number;
  terminals: Terminal[];
  appearance: CustomComponentAppearance | null;
  /** DC voltages (12/24/48) this part is compatible with; null/empty = not declared (AC, passive, or pass-through). */
  supportedVoltages: number[] | null;
  visibility: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomComponentInput {
  name: string;
  subtitle?: string | null;
  category?: string;
  width: number;
  height: number;
  terminals: Terminal[];
  appearance?: CustomComponentAppearance | null;
  supportedVoltages?: number[] | null;
}

/**
 * Properties snapshot placed on a SchematicComponent of type "custom" when a
 * definition is dropped onto the canvas. getComponentTerminals/
 * getComponentDimensions in terminal-config.ts read this back.
 *
 * Deliberately does NOT set `voltage`. Built-in components freeze the system
 * voltage at drop time, but a custom part has no voltage field in the
 * properties panel to correct it afterwards, so a frozen value would go stale
 * the moment the system voltage changed - and it feeds both wire sizing and
 * inferSystemVoltage(). Omitting it lets both fall back to the live system
 * voltage; `supportedVoltages` is the declared constraint instead.
 */
export function toPlacedProperties(
  definition: CustomComponentDefinition
): Record<string, any> {
  return {
    definitionId: definition.id,
    definitionVersion: definition.version,
    terminals: definition.terminals,
    width: definition.width,
    height: definition.height,
    subtitle: definition.subtitle || undefined,
    appearance: definition.appearance || undefined,
    supportedVoltages: definition.supportedVoltages && definition.supportedVoltages.length > 0
      ? definition.supportedVoltages
      : undefined,
  };
}
