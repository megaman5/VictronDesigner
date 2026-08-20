/**
 * Overcurrent protection catalog shared by the UI, the AI prompts and the
 * design validator.
 *
 * A DC system needs more than one kind of protection: a Class T on the battery
 * main, a MEGA or MRBF on a charger feed, and a small blade fuse or breaker on
 * a lights circuit. Each fuse family has its own rating range and interrupt
 * capacity, so the picker offers the ratings that family is actually sold in.
 */

export type FuseType = "class-t" | "mrbf" | "anl" | "mega" | "midi" | "blade";

export interface FuseTypeSpec {
  /** Ratings this family is manufactured in, in amps. */
  ratings: number[];
  label: string;
  /** Amps interrupting capacity - how much fault current it can safely break. */
  interruptCapacity: number;
  description: string;
  /** True for families rated to break the fault current of a lithium bank. */
  suitableForLithiumMain: boolean;
}

export const FUSE_TYPES: Record<FuseType, FuseTypeSpec> = {
  "class-t": {
    label: "Class T",
    ratings: [100, 150, 200, 250, 300, 350, 400, 450, 500, 600, 800],
    interruptCapacity: 20000,
    description: "20,000A interrupt - the standard main fuse for lithium battery banks",
    suitableForLithiumMain: true,
  },
  mrbf: {
    label: "MRBF (terminal fuse)",
    ratings: [30, 40, 50, 60, 80, 100, 125, 150, 175, 200, 250, 300],
    interruptCapacity: 10000,
    description: "10,000A interrupt, bolts straight onto a battery terminal",
    suitableForLithiumMain: true,
  },
  anl: {
    label: "ANL",
    ratings: [35, 50, 60, 80, 100, 125, 150, 175, 200, 250, 300, 325, 400, 500, 750],
    interruptCapacity: 6000,
    description: "6,000A interrupt - common on lead-acid house banks and inverter feeds",
    suitableForLithiumMain: false,
  },
  mega: {
    label: "MEGA / AMG",
    ratings: [40, 60, 80, 100, 125, 150, 175, 200, 225, 250, 300, 400, 500],
    interruptCapacity: 2000,
    description: "2,000A interrupt - used in Lynx Distributor slots and charger feeds",
    suitableForLithiumMain: false,
  },
  midi: {
    label: "MIDI / AMI",
    ratings: [30, 40, 50, 60, 70, 80, 100, 125, 150, 200],
    interruptCapacity: 1000,
    description: "1,000A interrupt - mid-size branch circuits such as an MPPT or DC panel feed",
    suitableForLithiumMain: false,
  },
  blade: {
    label: "Blade / ATO",
    ratings: [1, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40],
    interruptCapacity: 1000,
    description: "Small branch circuits - lights, pumps, fans, electronics",
    suitableForLithiumMain: false,
  },
};

export const DEFAULT_FUSE_TYPE: FuseType = "class-t";

/** The fuse family for a component, falling back to Class T for older designs. */
export function getFuseType(component: any): FuseType {
  const t = component?.properties?.fuseType;
  return t && t in FUSE_TYPES ? (t as FuseType) : DEFAULT_FUSE_TYPE;
}

/** Ratings available for a component's fuse family. */
export function getFuseRatings(component: any): number[] {
  return FUSE_TYPES[getFuseType(component)].ratings;
}

/** Nearest rating at or above the required current, or null if the family is too small. */
export function smallestRatingFor(fuseType: FuseType, requiredAmps: number): number | null {
  return FUSE_TYPES[fuseType].ratings.find(r => r >= requiredAmps) ?? null;
}

/**
 * Suggest a fuse family for a circuit of a given size. Used to point users at
 * a blade fuse for a 10A lighting circuit instead of a 100A+ Class T.
 */
export function suggestFuseType(requiredAmps: number, isBatteryMain: boolean): FuseType {
  if (isBatteryMain) return requiredAmps > 300 ? "class-t" : "mrbf";
  if (requiredAmps <= 30) return "blade";
  if (requiredAmps <= 150) return "midi";
  if (requiredAmps <= 300) return "mega";
  return "anl";
}

/** Standard breaker sizes (amps) for DC and AC circuit breakers. */
export const DC_BREAKER_RATINGS = [5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 125, 150, 200, 250, 300];
export const AC_BREAKER_RATINGS = [5, 10, 15, 20, 25, 30, 32, 40, 50, 63, 80, 100];

/** Component types that provide overcurrent protection in the DC path. */
export const DC_PROTECTION_TYPES = new Set([
  "fuse",
  "dc-breaker",
  "lynx-distributor",
  "lynx-shunt",
  "lynx-smart-bms",
]);

/** Component types that provide overcurrent protection in the AC path. */
export const AC_PROTECTION_TYPES = new Set(["ac-breaker", "ac-panel"]);
