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
}

/**
 * Properties snapshot placed on a SchematicComponent of type "custom" when a
 * definition is dropped onto the canvas. getComponentTerminals/
 * getComponentDimensions in terminal-config.ts read this back.
 */
export function toPlacedProperties(
  definition: CustomComponentDefinition,
  systemVoltage: number
): Record<string, any> {
  return {
    definitionId: definition.id,
    definitionVersion: definition.version,
    terminals: definition.terminals,
    width: definition.width,
    height: definition.height,
    subtitle: definition.subtitle || undefined,
    appearance: definition.appearance || undefined,
    voltage: systemVoltage,
  };
}
