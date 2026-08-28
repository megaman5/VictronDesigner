import { TERMINAL_CONFIGS, getComponentTerminals } from "../../../client/src/lib/terminal-config";
import { FUSE_TYPES } from "@shared/protection-devices";
import { AC_OUTPUT_OPTIONS } from "@shared/ac-voltage";

/**
 * Reusable pieces of the system prompt.
 *
 * The component dimension and terminal-id sections are GENERATED from
 * TERMINAL_CONFIGS rather than hand-maintained. A hand-written list is how the
 * Lynx modules ended up documented in one part of the prompt but not another,
 * which cost ten terminal repairs per generated design. Generating them means
 * adding a component to terminal-config.ts updates the prompt automatically.
 */

/** Components the AI should never be told to place directly. */
const INTERNAL_ONLY = new Set(["custom"]);

/** Extra per-model terminals worth calling out explicitly. */
const CONDITIONAL_TERMINAL_NOTES: Record<string, string> = {
  mppt:
    'ALSO "load-positive", "load-negative", but ONLY when properties.model is "75|10", "75|15", "100|15" or "100|20" (the compact models with a LOAD output). Never use load terminals on 150V or 250V models',
};

/** Notes that stop the model guessing at semantics it cannot see. */
const TERMINAL_SEMANTICS: Record<string, string> = {
  "lynx-shunt":
    "batt-* is the BATTERY side and bus-out-* is the SYSTEM side - they are not interchangeable",
  "lynx-smart-bms":
    "batt-* is the BATTERY side and system-* is the SYSTEM side - they are not interchangeable",
  smartshunt:
    '"negative" is the battery side and "system-minus" is the system side - all load current must pass through',
};

export function componentDimensionsFragment(): string {
  const lines = Object.keys(TERMINAL_CONFIGS)
    .filter(type => !INTERNAL_ONLY.has(type))
    .sort()
    .map(type => {
      const cfg = TERMINAL_CONFIGS[type];
      return `- ${type}: ${cfg.width}×${cfg.height}px`;
    });
  return `COMPONENT DIMENSIONS (width × height):\n${lines.join("\n")}`;
}

export function terminalIdsFragment(): string {
  const lines = Object.keys(TERMINAL_CONFIGS)
    .filter(type => !INTERNAL_ONLY.has(type))
    .sort()
    .map(type => {
      const ids = getComponentTerminals(type, null).map(t => `"${t.id}"`);
      let line = `- ${type}: ${ids.join(", ")}`;
      const conditional = CONDITIONAL_TERMINAL_NOTES[type];
      if (conditional) line += `; ${conditional}`;
      const semantics = TERMINAL_SEMANTICS[type];
      if (semantics) line += `\n  * ${semantics}`;
      return line;
    });

  return [
    "EXACT TERMINAL IDS (use these verbatim - inventing terminal names is the single most common failure):",
    ...lines,
    '- Never invent ids such as "main", "line", "dc-positive" or "earth". If you cannot find a suitable terminal above, do not create the wire.',
  ].join("\n");
}

export function fuseGuidanceFragment(): string {
  const families = (Object.keys(FUSE_TYPES) as (keyof typeof FUSE_TYPES)[]).map(key => {
    const spec = FUSE_TYPES[key];
    const min = Math.min(...spec.ratings);
    const max = Math.max(...spec.ratings);
    return `  * fuseType "${key}" (${spec.label}): ${min}-${max}A - ${spec.description}`;
  });

  return [
    "OVERCURRENT PROTECTION:",
    "- Match the protection to the circuit. A 10A lighting circuit takes a blade fuse, NOT a 400A Class T",
    ...families,
    "- Lithium battery main MUST use class-t or mrbf (only those interrupt a lithium short circuit)",
    "- dc-breaker (5-300A) is valid branch protection and doubles as a disconnect",
    "- Shore power MUST pass through an ac-breaker (2-pole) before the inverter/charger AC input",
  ].join("\n");
}

export function acVoltageFragment(): string {
  const options = AC_OUTPUT_OPTIONS.map(o => `  * "${o.value}" - ${o.description}`);
  return [
    "AC OUTPUT VOLTAGE:",
    "- Every inverter (multiplus, quattro, phoenix-inverter, inverter) MUST set acOutputVoltage:",
    ...options,
    '- Default to "120" when the user gives no regional hint',
    '- Use "split-120-240" when the user mentions 240V loads (well pump, dryer, range, large A/C) or a 50A/240V shore hookup',
    "- An ac-load's acVoltage must be one the inverter can supply. A 240V load REQUIRES split-120-240 (or a 230V system)",
  ].join("\n");
}

export function layoutFragment(): string {
  return [
    "CANVAS: 2000px wide × 1500px tall",
    "LAYOUT RULES:",
    "- Minimum 300px horizontal and 250px vertical between component centres - components must not overlap",
    "- Snap all positions to the 20px grid",
    "- Left to right: sources (solar, shore, alternator) → conversion (MPPT, inverter) → storage → distribution → loads",
    // From the second iteration the user turn carries a rendered picture of
    // the design so far; say so, or the model has no reason to trust it.
    "- On later iterations you are given an image of the current layout. Read it for overlapping boxes, crowded areas and wire runs that cross the whole canvas, and fix those as well as the listed errors",
    "ORIENTATION (optional, per component):",
    "- \"rotation\": 0, 90, 180 or 270 turns a component clockwise. No other value is valid",
    "- \"mirrorX\": true / \"mirrorY\": true flip it without turning it",
    "- Terminals move with the body, so turning a part re-aims its wires. Use it to face a component toward what it connects to instead of routing a long way around - e.g. turn a busbar 90 degrees to run it vertically beside a stack of loads",
    "- A quarter turn swaps the component's width and height; keep the spacing rules above true of the turned footprint",
    "- Leave it out entirely when the default orientation is fine. Do not rotate purely for variety",
  ].join("\n");
}

export function wiringRulesFragment(): string {
  return [
    "WIRING RULES:",
    "- SmartShunt/Lynx Shunt: ALL load and charge current must pass through it. Battery negative to the battery side, everything else to the system side",
    "- Use bus bars when 3+ connections of the same polarity are needed; never mix polarities on one bar",
    "- Battery positive must connect DIRECTLY to a fuse or dc-breaker",
    "- Every wire needs fromComponentId, toComponentId, fromTerminal, toTerminal, polarity, gauge and length",
    '- polarity is one of "positive", "negative", "hot", "neutral", "ground"',
    "- polarity MUST match the terminal it lands on:",
    '  * terminal contains "hot" -> polarity "hot"',
    '  * terminal contains "neutral" -> polarity "neutral"',
    '  * terminal contains "ground" -> polarity "ground"',
    '  * terminal is positive/negative -> polarity "positive"/"negative" (DC)',
  ].join("\n");
}

/**
 * Required per-component properties.
 *
 * The first version of this prompt compressed these away and the benchmark
 * immediately showed solar panels losing their Vmp, so the explicit
 * correct/wrong examples earn their tokens.
 */
export function requiredPropertiesFragment(): string {
  return [
    "REQUIRED PROPERTIES - every component MUST have a populated \"properties\" object:",
    '- battery: {"voltage": 12|24|48, "capacity": <Ah>, "batteryType": "LiFePO4"|"AGM"|"Gel"}',
    '- solar-panel: {"watts": <100-500>, "voltage": <Vmp: 18, 36, 72 - NOT the system voltage>}',
    '  ✅ CORRECT: {"watts": 300, "voltage": 18}',
    '  ❌ WRONG:   {"watts": 300}            - missing voltage, validation FAILS',
    '  ❌ WRONG:   {"watts": 300, "voltage": 12} - that is system voltage, not Vmp',
    '- dc-load / ac-load: {"watts": <realistic, never 0>} and ac-load also needs {"acVoltage": 120|230|240}',
    '  LED lights 10-50W, fridge 50-150W, water pump 50-100W, microwave 1000-1500W, A/C 1000-1800W',
    '  ❌ WRONG: {"watts": 0} or omitting properties entirely - validation FAILS',
    '- mppt: {"maxCurrent": <A>, "model": "<e.g. 100|20 or 150|45>"}',
    '- multiplus / quattro / inverter / phoenix-inverter: {"powerRating": <W>, "acOutputVoltage": "120"|"230"|"split-120-240"}',
    '- fuse: {"fuseType": "<family>", "fuseRating": <A within that family\'s range>}',
    '- dc-breaker: {"amps": <5-300>}   ac-breaker: {"amps": <5-100>, "poles": 1|2}',
    '- shore-power: {"voltage": 120|230|240, "maxAmps": 15|30|50}',
    "",
    "WIRE GAUGE FORMAT: \"10 AWG\" with a space. ❌ WRONG: \"10AWG\".",
  ].join("\n");
}

/** Everything shared by the design-generating skills. */
export function sharedDesignRules(): string {
  return [
    layoutFragment(),
    componentDimensionsFragment(),
    terminalIdsFragment(),
    requiredPropertiesFragment(),
    wiringRulesFragment(),
    acVoltageFragment(),
    fuseGuidanceFragment(),
  ].join("\n\n");
}
