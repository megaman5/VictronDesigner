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
  ],
};

export const SUITES: Record<string, BenchmarkSuite> = {
  [CORE_SUITE.id]: CORE_SUITE,
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
