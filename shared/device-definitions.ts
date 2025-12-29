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
            { id: "dc-negative", type: "negative", label: "DC-", mandatory: true, description: "Battery Negative" }
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
    "orion-dc-dc": {
        type: "orion-dc-dc",
        name: "Orion-Tr Smart DC-DC",
        description: "Isolated DC-DC charger for charging house batteries from alternator or starter battery. Smart version with Bluetooth.",
        category: "source",
        terminals: [
            { id: "input-positive", type: "positive", label: "IN+", mandatory: true, description: "Input positive (from alternator/starter battery)" },
            { id: "input-negative", type: "negative", label: "IN-", mandatory: true, description: "Input negative" },
            { id: "output-positive", type: "positive", label: "OUT+", mandatory: true, description: "Output positive (to house battery)" },
            { id: "output-negative", type: "negative", label: "OUT-", mandatory: true, description: "Output negative" },
            { id: "remote", type: "data", label: "REM", mandatory: false, description: "Remote on/off and engine running detection" }
        ],
        wiringRules: [
            "Input must be fused close to the starter battery.",
            "Output should be fused close to the house battery.",
            "Use engine running detection for proper alternator protection.",
            "Ensure adequate ventilation - unit generates heat during charging."
        ],
        usageNotes: "Essential for dual-battery systems. Charges house bank from alternator while protecting both batteries."
    },
    "phoenix-inverter": {
        type: "phoenix-inverter",
        name: "Phoenix Inverter",
        description: "Pure sine wave DC to AC inverter. Available in various power ratings.",
        category: "source",
        terminals: [
            { id: "dc-positive", type: "positive", label: "DC+", mandatory: true, description: "Battery positive input" },
            { id: "dc-negative", type: "negative", label: "DC-", mandatory: true, description: "Battery negative input" },
            { id: "ac-out-hot", type: "ac-out", label: "AC L", mandatory: true, description: "AC output line" },
            { id: "ac-out-neutral", type: "ac-out", label: "AC N", mandatory: true, description: "AC output neutral" },
            { id: "ac-out-ground", type: "ground", label: "AC G", mandatory: true, description: "AC output ground" },
            { id: "remote", type: "data", label: "REM", mandatory: false, description: "Remote on/off control" }
        ],
        wiringRules: [
            "DC positive must be fused with Class T fuse close to battery.",
            "Size DC cables for peak current (watts / voltage × 1.25).",
            "Ground the AC output ground to chassis/system ground.",
            "Use remote switch for easy on/off control."
        ],
        usageNotes: "Victron's standalone inverter. Use when AC charging capability is not needed."
    },
    "lynx-distributor": {
        type: "lynx-distributor",
        name: "Lynx Distributor",
        description: "DC power distribution with integrated fuse holders. Part of the Lynx system for high-power installations.",
        category: "distribution",
        terminals: [
            { id: "main-positive", type: "positive", label: "BUS+", mandatory: true, description: "Main positive busbar" },
            { id: "main-negative", type: "negative", label: "BUS-", mandatory: true, description: "Main negative busbar" },
            { id: "fuse-1", type: "positive", label: "F1", mandatory: false, description: "Fused output 1 (MEGA fuse)" },
            { id: "fuse-2", type: "positive", label: "F2", mandatory: false, description: "Fused output 2 (MEGA fuse)" },
            { id: "fuse-3", type: "positive", label: "F3", mandatory: false, description: "Fused output 3 (MEGA fuse)" },
            { id: "fuse-4", type: "positive", label: "F4", mandatory: false, description: "Fused output 4 (MEGA fuse)" }
        ],
        wiringRules: [
            "Connect to Lynx Shunt or battery via main busbars.",
            "Each output requires appropriate MEGA fuse for connected device.",
            "Can be daisy-chained with other Lynx modules.",
            "Provides pre-alarm contacts for blown fuse detection."
        ],
        usageNotes: "Professional power distribution. Each slot accepts MEGA fuses up to 500A."
    },
    "battery-protect": {
        type: "battery-protect",
        name: "Battery Protect",
        description: "Low voltage disconnect to protect batteries from deep discharge. Programmable disconnect/reconnect voltages.",
        category: "control",
        terminals: [
            { id: "input-positive", type: "positive", label: "IN", mandatory: true, description: "Input from battery positive" },
            { id: "output-positive", type: "positive", label: "OUT", mandatory: true, description: "Output to loads" },
            { id: "ground", type: "negative", label: "GND", mandatory: true, description: "Ground/negative connection" },
            { id: "remote", type: "data", label: "REM", mandatory: false, description: "Remote on/off control" }
        ],
        wiringRules: [
            "Install in positive wire between battery and non-critical loads.",
            "Do not use for charging circuits - only for load disconnect.",
            "Program appropriate disconnect voltage for battery type.",
            "Use for loads that can tolerate sudden disconnection."
        ],
        usageNotes: "Protects battery from over-discharge. Program settings via Bluetooth or DIP switches."
    },
    "blue-smart-charger": {
        type: "blue-smart-charger",
        name: "Blue Smart IP65 Charger",
        description: "Waterproof AC to DC battery charger with Bluetooth. For shore power charging.",
        category: "source",
        terminals: [
            { id: "ac-in-hot", type: "ac-in", label: "AC L", mandatory: true, description: "AC input line" },
            { id: "ac-in-neutral", type: "ac-in", label: "AC N", mandatory: true, description: "AC input neutral" },
            { id: "ac-in-ground", type: "ground", label: "AC G", mandatory: true, description: "AC input ground" },
            { id: "dc-positive", type: "positive", label: "DC+", mandatory: true, description: "DC output positive" },
            { id: "dc-negative", type: "negative", label: "DC-", mandatory: true, description: "DC output negative" }
        ],
        wiringRules: [
            "AC input requires appropriate breaker protection.",
            "DC output should be fused close to the battery.",
            "Select correct charge profile for battery type via Bluetooth app.",
            "IP65 rated - suitable for engine rooms and outdoor installation."
        ],
        usageNotes: "Dedicated shore power charger. Use when MultiPlus charging is not available or needed."
    },
    battery: {
        type: "battery",
        name: "Battery Bank",
        description: "Energy storage. Configurable type (LiFePO4, AGM, Lithium), voltage, and capacity.",
        category: "storage",
        terminals: [
            { id: "positive", type: "positive", label: "+", mandatory: true, description: "Main positive terminal" },
            { id: "negative", type: "negative", label: "-", mandatory: true, description: "Main negative terminal" }
        ],
        wiringRules: [
            "Positive terminal connects to Class T fuse then positive busbar.",
            "Negative terminal connects ONLY to the Shunt (if present) or negative busbar.",
            "LiFePO4 batteries require a BMS and Class T fuse protection.",
            "AGM batteries should be charged at lower voltage settings than LiFePO4."
        ],
        usageNotes: "Stores DC energy. Set type (LiFePO4/AGM/Lithium), voltage (12V/24V/48V), and capacity (Ah) in properties."
    },
    inverter: {
        type: "inverter",
        name: "Inverter",
        description: "Converts DC battery power to AC power. Generic inverter with configurable wattage.",
        category: "source",
        terminals: [
            { id: "dc-positive", type: "positive", label: "DC+", mandatory: true, description: "Battery positive input" },
            { id: "dc-negative", type: "negative", label: "DC-", mandatory: true, description: "Battery negative input" },
            { id: "ac-out-hot", type: "ac-out", label: "AC L", mandatory: true, description: "AC output line/hot" },
            { id: "ac-out-neutral", type: "ac-out", label: "AC N", mandatory: true, description: "AC output neutral" },
            { id: "ac-out-ground", type: "ground", label: "AC G", mandatory: true, description: "AC output ground" }
        ],
        wiringRules: [
            "DC positive must be fused with a Class T fuse close to the battery.",
            "DC cables must be sized for the inverter's maximum DC current (watts / voltage * 1.25).",
            "AC output should connect to an AC distribution panel or breaker.",
            "Chassis ground should be bonded to the system ground."
        ],
        usageNotes: "Set the wattage in properties. DC current draw = watts / battery voltage."
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
            { id: "line", type: "ac-in", label: "L", mandatory: true, description: "Line/Hot" },
            { id: "neutral", type: "ac-in", label: "N", mandatory: true, description: "Neutral" },
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
        name: "Class T Fuse",
        description: "High-interrupt Class T fuse for battery and inverter protection. Essential for high-current DC systems.",
        category: "distribution",
        terminals: [
            { id: "in", type: "positive", label: "IN", mandatory: true, description: "Line side (battery)" },
            { id: "out", type: "positive", label: "OUT", mandatory: true, description: "Load side (inverter/busbar)" }
        ],
        wiringRules: [
            "Must be placed as close as possible to the battery positive terminal.",
            "Size based on the inverter's maximum DC current draw plus 25% safety margin.",
            "Class T fuses provide high-interrupt capacity (up to 20,000A) for lithium battery protection."
        ],
        usageNotes: "Required for lithium battery systems. Protects against catastrophic short circuits."
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
    },
    "shore-power": {
        type: "shore-power",
        name: "Shore Power / Grid",
        description: "AC power source from shore power, grid, or generator. Provides AC power to chargers and inverters.",
        category: "source",
        terminals: [
            { id: "ac-out-hot", type: "ac-out", label: "L", mandatory: true, description: "Line (Hot)" },
            { id: "ac-out-neutral", type: "ac-out", label: "N", mandatory: true, description: "Neutral" },
            { id: "ac-out-ground", type: "ground", label: "G", mandatory: true, description: "Ground" },
        ],
        wiringRules: [
            "Connect to Blue Smart Charger AC input or MultiPlus AC input.",
            "Requires proper grounding.",
            "Use appropriate circuit breaker for protection.",
        ],
        usageNotes: "AC power source for charging batteries via AC chargers or powering loads through inverters with transfer switches.",
    },
    "transfer-switch": {
        type: "transfer-switch",
        name: "Transfer Switch",
        description: "Switches AC power between two sources (e.g., inverter and shore power). Can be manual or automatic.",
        category: "distribution",
        terminals: [
            { id: "source1-hot", type: "ac-in", label: "Source 1 L", mandatory: true, description: "Source 1 Line (e.g., Inverter)" },
            { id: "source1-neutral", type: "ac-in", label: "Source 1 N", mandatory: true, description: "Source 1 Neutral" },
            { id: "source1-ground", type: "ground", label: "Source 1 G", mandatory: true, description: "Source 1 Ground" },
            { id: "source2-hot", type: "ac-in", label: "Source 2 L", mandatory: true, description: "Source 2 Line (e.g., Shore Power)" },
            { id: "source2-neutral", type: "ac-in", label: "Source 2 N", mandatory: true, description: "Source 2 Neutral" },
            { id: "source2-ground", type: "ground", label: "Source 2 G", mandatory: true, description: "Source 2 Ground" },
            { id: "output-hot", type: "ac-out", label: "Output L", mandatory: true, description: "Output Line to Loads" },
            { id: "output-neutral", type: "ac-out", label: "Output N", mandatory: true, description: "Output Neutral" },
            { id: "output-ground", type: "ground", label: "Output G", mandatory: true, description: "Output Ground" },
        ],
        wiringRules: [
            "Source 1 typically connects to inverter output.",
            "Source 2 typically connects to shore power.",
            "Output connects to AC loads or AC distribution panel.",
            "Automatic switches prioritize one source and switch when it fails.",
            "Manual switches require user operation.",
        ],
        usageNotes: "Allows seamless switching between inverter power and shore power. Automatic switches provide uninterrupted power.",
    },
    alternator: {
        type: "alternator",
        name: "Alternator",
        description: "Vehicle alternator that charges the starter battery while engine is running. Can charge house battery via DC-DC charger (Orion).",
        category: "source",
        terminals: [
            { id: "output-positive", type: "positive", label: "B+", mandatory: true, description: "Alternator output positive (to starter battery)" },
            { id: "output-negative", type: "negative", label: "B-", mandatory: true, description: "Alternator ground (chassis)" },
        ],
        wiringRules: [
            "Output connects to starter battery positive terminal.",
            "Ground is typically through engine block/chassis.",
            "Use Orion DC-DC charger to charge house battery from alternator.",
            "Never connect alternator directly to house battery - use isolator or DC-DC charger.",
            "Typical alternator output: 60-200A depending on size.",
        ],
        usageNotes: "Primary charging source while driving. Most alternators are 12V or 24V with typical outputs of 60-200A. Use with Orion DC-DC charger for safe house battery charging.",
    },
};
