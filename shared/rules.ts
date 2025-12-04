import { DEVICE_DEFINITIONS } from "./device-definitions";

export interface WiringRule {
    id: string;
    name: string;
    description: string;
    validate: (
        fromComponent: any,
        fromTerminal: string,
        toComponent: any,
        toTerminal: string,
        wire: any
    ) => ValidationResult;
}

export interface ValidationResult {
    valid: boolean;
    message?: string;
    severity?: "error" | "warning";
}

export const RULES: WiringRule[] = [
    {
        id: "polarity-match",
        name: "Polarity Match",
        description: "Positive must connect to Positive, Negative to Negative",
        validate: (fromComp, fromTermId, toComp, toTermId, wire) => {
            const fromDef = DEVICE_DEFINITIONS[fromComp.type];
            const toDef = DEVICE_DEFINITIONS[toComp.type];

            const fromTerm = fromDef?.terminals.find(t => t.id === fromTermId);
            const toTerm = toDef?.terminals.find(t => t.id === toTermId);

            if (!fromTerm || !toTerm) return { valid: true }; // Skip if definitions missing

            // Allow AC to AC (Hot/Neutral/Ground)
            if (fromTerm.type.startsWith("ac-") && toTerm.type.startsWith("ac-")) {
                // Check for specific AC mismatches (e.g. Hot to Neutral)
                if (fromTerm.type === "ac-in" && toTerm.type === "ac-in") return { valid: false, message: "Cannot connect Input to Input", severity: "error" };
                if (fromTerm.type === "ac-out" && toTerm.type === "ac-out") return { valid: false, message: "Cannot connect Output to Output", severity: "error" };

                // Check for Hot/Neutral/Ground mismatch if types are specific
                // Note: definitions use "ac-in", "ac-out", "ground". 
                // We need to check the ID or label for Hot/Neutral specificity if type is generic
                const isGroundFrom = fromTerm.type === "ground" || fromTerm.id.includes("ground");
                const isGroundTo = toTerm.type === "ground" || toTerm.id.includes("ground");

                if (isGroundFrom !== isGroundTo) {
                    return { valid: false, message: "Must connect Ground to Ground", severity: "error" };
                }

                return { valid: true };
            }

            // PV to PV
            if (fromTerm.type.startsWith("pv-") && toTerm.type.startsWith("pv-")) {
                if (fromTerm.type !== toTerm.type) {
                    return { valid: false, message: "PV Polarity Mismatch (+ to -)", severity: "error" };
                }
                return { valid: true };
            }

            // DC to DC
            if ((fromTerm.type === "positive" || fromTerm.type === "negative") &&
                (toTerm.type === "positive" || toTerm.type === "negative")) {

                if (fromTerm.type !== toTerm.type) {
                    // Allow series connections (Pos to Neg) ONLY for batteries or solar panels
                    if (fromComp.type === "battery" && toComp.type === "battery") return { valid: true };
                    if (fromComp.type === "solar-panel" && toComp.type === "solar-panel") return { valid: true };

                    return { valid: false, message: "DC Polarity Mismatch (+ to -)", severity: "error" };
                }
            }

            // Cross-domain (AC to DC)
            const isFromAC = fromTerm.type.startsWith("ac-");
            const isToAC = toTerm.type.startsWith("ac-");
            if (isFromAC !== isToAC) {
                return { valid: false, message: "Cannot connect AC to DC", severity: "error" };
            }

            return { valid: true };
        }
    },
    {
        id: "voltage-match",
        name: "Voltage Compatibility",
        description: "Components must operate at compatible voltages",
        validate: (fromComp, fromTermId, toComp, toTermId) => {
            // Skip if voltage not defined
            if (!fromComp.voltage || !toComp.voltage) return { valid: true };

            // Allow small differences (e.g. 12V vs 12.8V)
            const diff = Math.abs(fromComp.voltage - toComp.voltage);
            if (diff > 5) { // Arbitrary threshold, maybe too loose for 12V vs 24V
                // Check for specific incompatible levels like 12 vs 24 vs 48
                const v1 = fromComp.voltage;
                const v2 = toComp.voltage;

                // If both are standard system voltages (12, 24, 48), they must match
                const isStandard = (v: number) => [12, 24, 48].includes(v);
                if (isStandard(v1) && isStandard(v2) && v1 !== v2) {
                    return { valid: false, message: `Voltage Mismatch: ${v1}V vs ${v2}V`, severity: "error" };
                }
            }
            return { valid: true };
        }
    }
];

export function validateConnection(
    fromComp: any,
    fromTermId: string,
    toComp: any,
    toTermId: string,
    wire: any = {}
): ValidationResult {
    for (const rule of RULES) {
        const result = rule.validate(fromComp, fromTermId, toComp, toTermId, wire);
        if (!result.valid) return result;
    }
    return { valid: true };
}
