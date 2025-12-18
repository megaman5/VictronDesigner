export interface TerminalDefinition {
    id: string;
    type: "positive" | "negative" | "ground" | "ac-in" | "ac-out" | "pv-positive" | "pv-negative" | "data";
    label: string;
    mandatory: boolean;
    description?: string;
}

export interface DeviceDefinition {
    type: string;
    name: string;
    description: string;
    category: "source" | "load" | "storage" | "distribution" | "control";
    terminals: TerminalDefinition[];
    wiringRules: string[];
    usageNotes: string;
}

export const DEVICE_DEFINITIONS: Record<string, DeviceDefinition> = {
    multiplus: {
        type: "multiplus",
        name: "MultiPlus Inverter/Charger",
        description: "Combined inverter and charger. Converts DC from battery to AC for loads, and charges battery from AC input (grid/shore).",
        category: "source", // Acts as both source and load, but primarily power handling
        terminals: [
            { id: "ac-in-hot", type: "ac-in", label: "AC IN L", mandatory: false, description: "Grid/Shore Line" },
            { id: "ac-in-neutral", type: "ac-in", label: "AC IN N", mandatory: false, description: "Grid/Shore Neutral" },
            { id: "ac-in-ground", type: "ground", label: "AC IN G", mandatory: false, description: "Grid/Shore Ground" },

            { id: "ac-out-hot", type: "ac-out", label: "AC OUT L", mandatory: true, description: "Load Line" },
            { id: "ac-out-neutral", type: "ac-out", label: "AC OUT N", mandatory: true, description: "Load Neutral" },
            { id: "ac-out-ground", type: "ground", label: "AC OUT G", mandatory: true, description: "Load Ground" },

            { id: "dc-positive", type: "positive", label: "DC+", mandatory: true, description: "Battery Positive" },
            { id: "dc-negative", type: "negative", label: "DC-", mandatory: true, description: "Battery Negative" },
            { id: "chassis-ground", type: "ground", label: "GND", mandatory: true, description: "Chassis Ground" }
        ],
        wiringRules: [
            "DC Positive must be fused close to the battery.",
            "DC Negative should connect to the system side of the shunt if a battery monitor is used.",
            "AC Input requires a circuit breaker.",
            "AC Output should go to an AC distribution panel."
        ],
        usageNotes: "The heart of the system. Handles AC power. Ensure DC cables are sized for the maximum inverter current."
    },
    mppt: {
        type: "mppt",
        name: "MPPT Solar Charge Controller",
        description: "Optimizes solar panel output to charge the battery bank.",
        category: "source",
        terminals: [
            { id: "pv-positive", type: "pv-positive", label: "PV+", mandatory: true, description: "Positive input from solar array" },
            { id: "pv-negative", type: "pv-negative", label: "PV-", mandatory: true, description: "Negative input from solar array" },
            { id: "batt-positive", type: "positive", label: "BATT+", mandatory: true, description: "Positive output to battery/busbar (via fuse)" },
            { id: "batt-negative", type: "negative", label: "BATT-", mandatory: true, description: "Negative output to battery/busbar" }
        ],
        wiringRules: [
            "Connect Battery side FIRST, then PV side.",
            "PV input voltage must never exceed controller max voltage.",
            "Battery positive requires a fuse."
        ],
        usageNotes: "Matches solar voltage to battery voltage. Essential for solar charging."
    },
    cerbo: {
        type: "cerbo",
        name: "Cerbo GX",
        description: "Communication center. Monitors and controls all connected Victron equipment.",
        category: "control",
        terminals: [
            { id: "power-positive", type: "positive", label: "Power +", mandatory: true, description: "DC Power supply (8-70V)" },
            { id: "power-negative", type: "negative", label: "Power -", mandatory: true, description: "DC Ground" },
            { id: "ve-bus", type: "data", label: "VE.Bus", mandatory: false, description: "Connection to MultiPlus/Quattro" },
            { id: "ve-direct", type: "data", label: "VE.Direct", mandatory: false, description: "Connection to MPPTs and BMV/Shunts" },
            { id: "ve-can", type: "data", label: "VE.Can", mandatory: false, description: "Connection to NMEA2000 or other CAN devices" }
        ],
        wiringRules: [
            "Requires a small inline fuse (1A) for power.",
            "Connects to other devices via data cables (RJ45, VE.Direct)."
        ],
        usageNotes: "The brain of the system. Enables remote monitoring via VRM."
    },
    smartshunt: {
        type: "smartshunt",
        name: "SmartShunt",
        description: "Battery monitor. Measures voltage and current to calculate state of charge.",
        category: "control",
        terminals: [
            { id: "battery-minus", type: "negative", label: "TO BATT -", mandatory: true, description: "Connect ONLY to battery negative terminal" },
            { id: "system-minus", type: "negative", label: "TO SYSTEM -", mandatory: true, description: "Connect to negative busbar/loads" },
            { id: "vbatt-plus", type: "positive", label: "Vbatt+", mandatory: true, description: "Voltage sensing wire to battery positive (includes fuse)" }
        ],
        wiringRules: [
            "Must be the very first thing connected to the battery negative.",
            "No other loads should be connected directly to the battery negative.",
            "Current flows from Battery Minus -> Shunt -> System Minus."
        ],
        usageNotes: "Crucial for accurate battery monitoring. Acts as the system's fuel gauge."
    },
    battery: {
        type: "battery",
        name: "Battery Bank",
        description: "Energy storage. Typically LiFePO4 or AGM.",
        category: "storage",
        terminals: [
            { id: "positive", type: "positive", label: "+", mandatory: true, description: "Main positive terminal" },
            { id: "negative", type: "negative", label: "-", mandatory: true, description: "Main negative terminal" }
        ],
        wiringRules: [
            "Positive terminal connects to main fuse/switch then positive busbar.",
            "Negative terminal connects ONLY to the Shunt (if present) or negative busbar."
        ],
        usageNotes: "Stores DC energy. Voltage (12V/24V/48V) must match system voltage."
    },
    "solar-panel": {
        type: "solar-panel",
        name: "Solar Panel",
        description: "Generates DC power from sunlight.",
        category: "source",
        terminals: [
            { id: "positive", type: "pv-positive", label: "+", mandatory: true, description: "PV output positive" },
            { id: "negative", type: "pv-negative", label: "-", mandatory: true, description: "PV output negative" }
        ],
        wiringRules: [
            "Connects to MPPT PV input.",
            "Can be wired in series (higher voltage) or parallel (higher current)."
        ],
        usageNotes: "Source of renewable energy."
    },
    "dc-load": {
        type: "dc-load",
        name: "DC Load",
        description: "Generic DC consumer (Lights, Pump, Fridge).",
        category: "load",
        terminals: [
            { id: "positive", type: "positive", label: "+", mandatory: true, description: "DC Positive input" },
            { id: "negative", type: "negative", label: "-", mandatory: true, description: "DC Negative input" }
        ],
        wiringRules: [
            "Connects to DC fuse block or distribution panel.",
            "Requires appropriate fusing."
        ],
        usageNotes: "Consumes power from the battery/system."
    },
    "ac-load": {
        type: "ac-load",
        name: "AC Load",
        description: "Generic AC consumer (Outlet, Appliance).",
        category: "load",
        terminals: [
            { id: "line", type: "ac-out", label: "L", mandatory: true, description: "Line/Hot" },
            { id: "neutral", type: "ac-out", label: "N", mandatory: true, description: "Neutral" },
            { id: "ground", type: "ground", label: "G", mandatory: true, description: "Ground" }
        ],
        wiringRules: [
            "Connects to AC distribution panel/breaker box.",
            "Powered by Inverter AC Out or Shore Power."
        ],
        usageNotes: "Household appliances running on 120V/230V."
    },
    "busbar-positive": {
        type: "busbar-positive",
        name: "Positive Busbar",
        description: "Distribution point for DC positive connections.",
        category: "distribution",
        terminals: [
            { id: "main", type: "positive", label: "Studs", mandatory: true, description: "Multiple connection points" }
        ],
        wiringRules: [
            "Connects battery (via fuse/switch), chargers, and loads.",
            "Keep connections clean and tight."
        ],
        usageNotes: "Centralizes positive connections."
    },
    "busbar-negative": {
        type: "busbar-negative",
        name: "Negative Busbar",
        description: "Distribution point for DC negative connections.",
        category: "distribution",
        terminals: [
            { id: "main", type: "negative", label: "Studs", mandatory: true, description: "Multiple connection points" }
        ],
        wiringRules: [
            "Connects to Shunt 'System Minus' side.",
            "Connects all load and charger negatives."
        ],
        usageNotes: "Centralizes negative connections."
    },
    fuse: {
        type: "fuse",
        name: "Fuse / Breaker",
        description: "Overcurrent protection device. Essential for safety.",
        category: "distribution",
        terminals: [
            { id: "in", type: "positive", label: "IN", mandatory: true, description: "Line side" },
            { id: "out", type: "positive", label: "OUT", mandatory: true, description: "Load side" }
        ],
        wiringRules: [
            "Must be placed as close as possible to the power source (Battery/Busbar).",
            "Size based on the wire's ampacity, not the load."
        ],
        usageNotes: "Protects the wire from melting in case of a short circuit."
    },
    switch: {
        type: "switch",
        name: "Battery Switch",
        description: "High current disconnect switch.",
        category: "distribution",
        terminals: [
            { id: "in", type: "positive", label: "IN", mandatory: true, description: "From Battery/Fuse" },
            { id: "out", type: "positive", label: "OUT", mandatory: true, description: "To Busbar/Load" }
        ],
        wiringRules: [
            "Install after the main fuse.",
            "Used to isolate the battery bank for service or storage."
        ],
        usageNotes: "Manual disconnect for safety."
    },
    "breaker-panel": {
        type: "breaker-panel",
        name: "AC/DC Breaker Panel",
        description: "Distribution panel with circuit breakers for individual loads.",
        category: "distribution",
        terminals: [
            { id: "main-in-pos", type: "positive", label: "MAIN +", mandatory: true, description: "Main DC Feed" },
            { id: "main-in-neg", type: "negative", label: "MAIN -", mandatory: true, description: "Main DC Negative" },
            { id: "load-1-pos", type: "positive", label: "L1", mandatory: false, description: "Load 1 Positive" },
            { id: "load-2-pos", type: "positive", label: "L2", mandatory: false, description: "Load 2 Positive" },
            { id: "load-3-pos", type: "positive", label: "L3", mandatory: false, description: "Load 3 Positive" },
            { id: "load-4-pos", type: "positive", label: "L4", mandatory: false, description: "Load 4 Positive" }
        ],
        wiringRules: [
            "Connects to the main busbars.",
            "Provides fused outputs for smaller loads (lights, pumps)."
        ],
        usageNotes: "Organizes and protects individual circuits."
    },
    "ac-panel": {
        type: "ac-panel",
        name: "AC Distribution Panel",
        description: "Main breaker box for AC circuits (120V/230V).",
        category: "distribution",
        terminals: [
            { id: "main-in-hot", type: "ac-in", label: "MAIN L", mandatory: true, description: "Main AC Input (Hot)" },
            { id: "main-in-neutral", type: "ac-in", label: "MAIN N", mandatory: true, description: "Main AC Input (Neutral)" },
            { id: "main-in-ground", type: "ground", label: "MAIN G", mandatory: true, description: "Main Ground" },
            { id: "load-1-hot", type: "ac-out", label: "L1", mandatory: false, description: "Load 1 Hot" },
            { id: "load-1-neutral", type: "ac-out", label: "N1", mandatory: false, description: "Load 1 Neutral" },
            { id: "load-1-ground", type: "ground", label: "G1", mandatory: false, description: "Load 1 Ground" },
            { id: "load-2-hot", type: "ac-out", label: "L2", mandatory: false, description: "Load 2 Hot" },
            { id: "load-2-neutral", type: "ac-out", label: "N2", mandatory: false, description: "Load 2 Neutral" },
            { id: "load-2-ground", type: "ground", label: "G2", mandatory: false, description: "Load 2 Ground" }
        ],
        wiringRules: [
            "Connects to Inverter AC OUT or Shore Power.",
            "Distributes AC power to outlets and appliances."
        ],
        usageNotes: "Contains breakers for AC safety."
    },
    "dc-panel": {
        type: "dc-panel",
        name: "DC Distribution Panel",
        description: "Fused distribution block for DC loads.",
        category: "distribution",
        terminals: [
            { id: "main-in-pos", type: "positive", label: "MAIN +", mandatory: true, description: "Main DC Positive Feed" },
            { id: "main-in-neg", type: "negative", label: "MAIN -", mandatory: true, description: "Main DC Negative Feed" },
            { id: "load-1-pos", type: "positive", label: "L1 +", mandatory: false, description: "Load 1 Positive" },
            { id: "load-1-neg", type: "negative", label: "L1 -", mandatory: false, description: "Load 1 Negative" },
            { id: "load-2-pos", type: "positive", label: "L2 +", mandatory: false, description: "Load 2 Positive" },
            { id: "load-2-neg", type: "negative", label: "L2 -", mandatory: false, description: "Load 2 Negative" },
            { id: "load-3-pos", type: "positive", label: "L3 +", mandatory: false, description: "Load 3 Positive" },
            { id: "load-3-neg", type: "negative", label: "L3 -", mandatory: false, description: "Load 3 Negative" }
        ],
        wiringRules: [
            "Connects to main busbars.",
            "Provides fused outputs for DC loads."
        ],
        usageNotes: "Centralized fusing for 12V/24V/48V loads."
    }
};
