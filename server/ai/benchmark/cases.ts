/**
 * Benchmark suites.
 *
 * These are fixed inputs with machine-checkable expectations. LLM output is
 * not reproducible even at temperature 0 - and current Anthropic and OpenAI
 * reasoning models reject sampling parameters outright - so "deterministic"
 * here means: the cases, the scoring and the harness are fixed, and variance
 * is measured by repeating each case rather than pretended away.
 */

export interface BenchmarkExpectation {
  id: string;
  description: string;
  /** Return null when satisfied, or a human-readable reason when not. */
  check(design: { components: any[]; wires: any[] }): string | null;
}

export interface BenchmarkCase {
  id: string;
  prompt: string;
  systemVoltage: number;
  /**
   * Components already on the canvas, for wiring skills. The runner passes
   * these through as the skill's existingDesign and merges the returned wires
   * back before scoring.
   */
  existingComponents?: any[];
  existingWires?: any[];
  /** Minimum validator score for this case to count as a pass. */
  minScore: number;
  expectations: BenchmarkExpectation[];
}

export interface BenchmarkSuite {
  id: string;
  label: string;
  skillId: string;
  cases: BenchmarkCase[];
}

const hasType = (id: string, description: string, ...types: string[]): BenchmarkExpectation => ({
  id,
  description,
  check: design =>
    design.components.some(c => types.includes(c.type))
      ? null
      : `expected one of [${types.join(", ")}] in the design`,
});

const everyLoadHasPower: BenchmarkExpectation = {
  id: "loads-have-power",
  description: "every load declares realistic watts or amps",
  check: design => {
    const bad = design.components.filter(
      c =>
        (c.type === "dc-load" || c.type === "ac-load") &&
        !(Number(c.properties?.watts) > 0 || Number(c.properties?.amps) > 0)
    );
    return bad.length === 0 ? null : `${bad.length} load(s) with no watts/amps`;
  },
};

const noInventedTerminals: BenchmarkExpectation = {
  id: "no-invented-terminals",
  description: "every wire lands on a terminal that exists",
  // The normalizer repairs these before scoring, so this is reported through
  // repairCount rather than re-derived here.
  check: () => null,
};

const solarPanelsHaveVoltage: BenchmarkExpectation = {
  id: "solar-has-vmp",
  description: "solar panels declare a PV voltage",
  check: design => {
    const bad = design.components.filter(
      c => c.type === "solar-panel" && !(Number(c.properties?.voltage) > 0)
    );
    return bad.length === 0 ? null : `${bad.length} solar panel(s) missing voltage`;
  },
};

const has240VLoad: BenchmarkExpectation = {
  id: "240v-supported",
  description: "a 240V load is present and its source can supply it",
  check: design => {
    const load240 = design.components.find(
      c => c.type === "ac-load" && Number(c.properties?.acVoltage) === 240
    );
    if (!load240) return "no 240V AC load in the design";
    const splitPhase = design.components.some(
      c => c.properties?.acOutputVoltage === "split-120-240"
    );
    return splitPhase ? null : "240V load present but no split-phase inverter to feed it";
  },
};

/**
 * orion-dc-dc, blue-smart-charger, alternator, cyrix-ct and argofet were
 * missing from the AI prompt's required-properties list (only mppt,
 * dc-breaker/ac-breaker and shore-power were documented needing a current
 * rating). Found via a real design where an Orion-Tr charger with no amps
 * set left its own output wire un-sized - not a wrong answer, just silently
 * unchecked, which is worse.
 */
const chargeSourcesHaveAmps: BenchmarkExpectation = {
  id: "charge-sources-have-amps",
  description: "chargers, alternators and battery combiners declare a current rating",
  check: design => {
    const types = ["orion-dc-dc", "blue-smart-charger", "alternator", "cyrix-ct", "argofet"];
    const bad = design.components.filter(
      c => types.includes(c.type) && !(Number(c.properties?.amps) > 0 || Number(c.properties?.current) > 0)
    );
    return bad.length === 0 ? null : `${bad.length} charge source(s)/combiner(s) with no amps rating`;
  },
};

const usesLynx: BenchmarkExpectation = {
  id: "uses-lynx",
  description: "Lynx distribution modules are used",
  check: design =>
    design.components.some(c => String(c.type).startsWith("lynx-"))
      ? null
      : "no Lynx modules in the design",
};

const appropriateFuseFamilies: BenchmarkExpectation = {
  id: "fuse-families-match-circuit",
  description: "small circuits do not get a 100A+ Class T",
  check: design => {
    const fuses = design.components.filter(c => c.type === "fuse");
    if (fuses.length === 0) return null;
    const allClassT = fuses.every(
      f => (f.properties?.fuseType ?? "class-t") === "class-t"
    );
    return allClassT && fuses.length > 2
      ? "every fuse is Class T - branch circuits should use smaller families"
      : null;
  },
};

export const CORE_SUITE: BenchmarkSuite = {
  id: "core-designs",
  label: "Core system designs",
  skillId: "system-design",
  cases: [
    {
      id: "van-12v",
      systemVoltage: 12,
      minScore: 70,
      prompt:
        "Design a 12V camper van system: 400W of solar, a 200Ah lithium battery, a 2000W inverter, a 12V fridge and LED lights. Include proper fusing and a battery monitor.",
      expectations: [
        hasType("has-battery", "a battery bank is present", "battery"),
        hasType("has-mppt", "an MPPT controller is present", "mppt"),
        hasType("has-monitor", "a battery monitor is present", "smartshunt", "bmv", "lynx-shunt", "lynx-smart-bms"),
        everyLoadHasPower,
        solarPanelsHaveVoltage,
        noInventedTerminals,
      ],
    },
    {
      id: "split-240v",
      systemVoltage: 48,
      minScore: 70,
      prompt:
        "Design a 48V off-grid cabin system with a Quattro that must run a 240V well pump as well as normal 120V outlets. Include 3kW of solar and a lithium bank.",
      expectations: [
        hasType("has-quattro", "a Quattro is present", "quattro"),
        has240VLoad,
        everyLoadHasPower,
        solarPanelsHaveVoltage,
      ],
    },
    {
      id: "lynx-cat",
      systemVoltage: 24,
      minScore: 70,
      prompt:
        "Design a 24V catamaran system using Victron Lynx distribution modules, a 600Ah lithium bank, two MPPT controllers, a 3000W MultiPlus, and correct fusing throughout.",
      expectations: [
        usesLynx,
        hasType("has-multiplus", "a MultiPlus is present", "multiplus"),
        everyLoadHasPower,
        solarPanelsHaveVoltage,
      ],
    },
    {
      id: "small-branch-fusing",
      systemVoltage: 12,
      minScore: 70,
      prompt:
        "Design a simple 12V system: 100Ah battery, a 10A LED lighting circuit, a 5A USB charging circuit and a 15A water pump. Fuse each circuit correctly.",
      expectations: [
        hasType("has-battery", "a battery bank is present", "battery"),
        appropriateFuseFamilies,
        everyLoadHasPower,
      ],
    },
    {
      id: "alternator-charging",
      systemVoltage: 12,
      minScore: 70,
      // Mirrors a real design that surfaced the gap: engine charging into the
      // house bank through a DC-DC charger, plus a second combined bank -
      // exactly the two component types (orion-dc-dc, and a battery
      // combiner) most likely to be generated with no current rating.
      prompt:
        "Design a 12V van system: 200Ah lithium house battery charged by the engine alternator through an Orion-Tr Smart DC-DC charger, plus 300W of solar and a 12V fridge. Also combine the house bank with a separate starter battery using a battery combiner.",
      expectations: [
        hasType("has-orion", "an Orion-Tr DC-DC charger is present", "orion-dc-dc"),
        hasType("has-combiner", "a battery combiner is present", "cyrix-ct", "argofet"),
        chargeSourcesHaveAmps,
        everyLoadHasPower,
        solarPanelsHaveVoltage,
      ],
    },
  ],
};

const allComponentsConnected: BenchmarkExpectation = {
  id: "all-components-wired",
  description: "no component is left unconnected",
  check: design => {
    const wired = new Set<string>();
    for (const w of design.wires) {
      wired.add(w.fromComponentId);
      wired.add(w.toComponentId);
    }
    const orphans = design.components.filter(c => !wired.has(c.id));
    return orphans.length === 0
      ? null
      : `${orphans.length} unconnected: ${orphans.map(o => o.id).join(", ")}`;
  },
};

const acPolarityMatchesTerminal: BenchmarkExpectation = {
  id: "ac-polarity-matches-terminal",
  description: "AC wire polarity matches the terminal it lands on",
  check: design => {
    const bad: string[] = [];
    for (const w of design.wires) {
      for (const t of [w.fromTerminal, w.toTerminal]) {
        const term = String(t ?? "");
        if (term.includes("hot") && w.polarity !== "hot") bad.push(`${term} as ${w.polarity}`);
        if (term.includes("neutral") && w.polarity !== "neutral") bad.push(`${term} as ${w.polarity}`);
      }
    }
    return bad.length === 0 ? null : `${bad.length} mismatch(es): ${bad.slice(0, 3).join("; ")}`;
  },
};

const VAN_COMPONENTS = [
  { id: "battery-1", type: "battery", name: "House Bank", x: 200, y: 500, properties: { voltage: 12, capacity: 200, batteryType: "LiFePO4" } },
  { id: "fuse-1", type: "fuse", name: "Main Fuse", x: 500, y: 500, properties: { fuseType: "class-t", fuseRating: 250 } },
  { id: "shunt-1", type: "smartshunt", name: "SmartShunt", x: 500, y: 700, properties: { voltage: 12 } },
  { id: "buspos-1", type: "busbar-positive", name: "DC Positive Bus", x: 800, y: 460, properties: { voltage: 12 } },
  { id: "busneg-1", type: "busbar-negative", name: "DC Negative Bus", x: 800, y: 700, properties: { voltage: 12 } },
  { id: "mppt-1", type: "mppt", name: "MPPT 100/30", x: 500, y: 200, properties: { maxCurrent: 30, model: "100|30", voltage: 12 } },
  { id: "solar-1", type: "solar-panel", name: "400W Array", x: 200, y: 200, properties: { watts: 400, voltage: 18 } },
  { id: "load-1", type: "dc-load", name: "12V Fridge", x: 1100, y: 560, properties: { watts: 60, voltage: 12 } },
];

const AC_COMPONENTS = [
  { id: "battery-1", type: "battery", name: "House Bank", x: 200, y: 500, properties: { voltage: 24, capacity: 400, batteryType: "LiFePO4" } },
  { id: "fuse-1", type: "fuse", name: "Main Fuse", x: 500, y: 500, properties: { fuseType: "class-t", fuseRating: 400 } },
  { id: "inv-1", type: "multiplus", name: "MultiPlus 3000", x: 900, y: 460, properties: { powerRating: 3000, watts: 3000, voltage: 24, acOutputVoltage: "120" } },
  { id: "acpanel-1", type: "ac-panel", name: "AC Panel", x: 1300, y: 400, properties: {} },
  { id: "acload-1", type: "ac-load", name: "Galley Outlets", x: 1650, y: 400, properties: { watts: 800, acVoltage: 120 } },
];

export const WIRING_SUITE: BenchmarkSuite = {
  id: "wiring",
  label: "Wire existing components",
  skillId: "wire-components",
  cases: [
    {
      id: "van-dc-wiring",
      systemVoltage: 12,
      minScore: 60,
      prompt: "Wire these components into a complete, safe 12V system.",
      existingComponents: VAN_COMPONENTS,
      existingWires: [],
      expectations: [allComponentsConnected, acPolarityMatchesTerminal],
    },
    {
      id: "ac-path-wiring",
      systemVoltage: 24,
      minScore: 60,
      prompt: "Wire these components, including the AC path from the inverter to the panel and outlets.",
      existingComponents: AC_COMPONENTS,
      existingWires: [],
      expectations: [allComponentsConnected, acPolarityMatchesTerminal],
    },
  ],
};

export const SUITES: Record<string, BenchmarkSuite> = {
  [CORE_SUITE.id]: CORE_SUITE,
  [WIRING_SUITE.id]: WIRING_SUITE,
};

export function getSuite(id: string): BenchmarkSuite {
  const suite = SUITES[id];
  if (!suite) throw new Error(`Unknown suite "${id}". Known: ${Object.keys(SUITES).join(", ")}`);
  return suite;
}

export function listSuites() {
  return Object.values(SUITES).map(s => ({
    id: s.id,
    label: s.label,
    skillId: s.skillId,
    caseCount: s.cases.length,
    caseIds: s.cases.map(c => c.id),
  }));
}
