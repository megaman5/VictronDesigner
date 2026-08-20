/**
 * AC voltage helpers shared by the client UI, the server validator, and the
 * wire calculator.
 *
 * Victron sells both 120V (North America) and 230V (Europe/Australia) models,
 * plus 120/240V split-phase MultiPlus and Quattro models for North American
 * shore power and well pumps / dryers / air conditioners that need 240V.
 */

/** AC voltages the designer supports on load and source components. */
export const SUPPORTED_AC_VOLTAGES = [110, 120, 220, 230, 240] as const;

/**
 * AC output configurations an inverter/charger can be set to.
 * "split-120-240" is the North American split-phase output (two 120V legs,
 * 240V line-to-line) used by 120/240V MultiPlus and Quattro models.
 */
export type ACOutputConfig = "120" | "230" | "split-120-240";

export const AC_OUTPUT_OPTIONS: { value: ACOutputConfig; label: string; description: string }[] = [
  { value: "120", label: "120V AC (North America)", description: "Single phase 120V - standard US/Canada output" },
  { value: "230", label: "230V AC (Europe/Australia)", description: "Single phase 230V - EU/AU/UK models" },
  { value: "split-120-240", label: "120/240V split phase", description: "Two 120V legs, 240V line-to-line - US split-phase models" },
];

/** Component types that produce/distribute AC and therefore carry an output setting. */
export const AC_SOURCE_TYPES = new Set([
  "multiplus",
  "quattro",
  "phoenix-inverter",
  "inverter",
  "shore-power",
  "transfer-switch",
  "ac-panel",
]);

function isSupported(v: unknown): v is number {
  return typeof v === "number" && (SUPPORTED_AC_VOLTAGES as readonly number[]).includes(v);
}

/**
 * Nominal AC voltage an inverter/shore source puts out.
 * Split-phase sources report 240V (their line-to-line voltage); use
 * getSupportedACVoltages() when checking which loads they can feed.
 */
export function getInverterACVoltage(component: any): number {
  const config = component?.properties?.acOutputVoltage as ACOutputConfig | number | undefined;
  if (config === "split-120-240") return 240;
  if (isSupported(config)) return config;
  if (typeof config === "string") {
    const parsed = parseInt(config, 10);
    if (isSupported(parsed)) return parsed;
  }
  // Fall back to a plain acVoltage property, then to 120V (North America)
  if (isSupported(component?.properties?.acVoltage)) return component.properties.acVoltage;
  return 120;
}

/** True when the component is configured for 120/240V split phase output. */
export function isSplitPhase(component: any): boolean {
  return component?.properties?.acOutputVoltage === "split-120-240";
}

/**
 * Which load voltages an AC source can legally feed.
 * A split-phase 120/240V source feeds both 120V and 240V loads.
 * 110/120 and 220/230/240 are treated as compatible families - a 230V inverter
 * can run a 220V load, and a 120V inverter a 110V load.
 */
export function getSupportedACVoltages(component: any): number[] {
  if (isSplitPhase(component)) return [110, 120, 220, 230, 240];
  const v = getInverterACVoltage(component);
  return v <= 120 ? [110, 120] : [220, 230, 240];
}

/**
 * Get AC voltage for a component (110V, 120V, 220V, 230V, 240V)
 * Defaults to 120V if not specified
 */
export function getACVoltage(component: any): number {
  // AC sources carry their own output setting, which may be split-phase
  if (AC_SOURCE_TYPES.has(component?.type) && component?.properties?.acOutputVoltage !== undefined) {
    return getInverterACVoltage(component);
  }
  const acVoltage = component?.properties?.acVoltage || component?.properties?.voltage;
  if (isSupported(acVoltage)) return acVoltage;
  // Default to 120V for North America
  return 120;
}
