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
            "AC Output should go to an AC distribution panel.",
            "Set acOutputVoltage to match the region: \"120\" (North America), \"230\" (Europe/Australia), or \"split-120-240\" for North American split-phase models that also feed 240V loads."
        ],
        usageNotes: "The heart of the system. Handles AC power. Ensure DC cables are sized for the maximum inverter current. 120/240V split-phase models are needed for 240V loads such as well pumps, dryers and electric ranges."
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
            { id: "load-positive", type: "positive", label: "LOAD+", mandatory: false, description: "Load output positive - ONLY on 75|10, 75|15, 100|15 and 100|20 models" },
            { id: "load-negative", type: "negative", label: "LOAD-", mandatory: false, description: "Load output negative - ONLY on 75|10, 75|15, 100|15 and 100|20 models" },
            { id: "batt-negative", type: "negative", label: "BATT-", mandatory: true, description: "Negative output to battery/busbar" }
        ],
        wiringRules: [
            "Connect Battery side FIRST, then PV side.",
            "PV input voltage must never exceed controller max voltage.",
            "Battery positive requires a fuse.",
            "LOAD output (75|10, 75|15, 100|15, 100|20 only) drives small DC loads with low-voltage disconnect - it is limited to the controller's rated current and must not be used for the inverter."
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
        description: "Isolated DC-DC charger for dual-voltage 12/24V or 24/12V systems, charging house batteries from alternator or starter battery. Smart version with Bluetooth.",
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
        usageNotes: "Essential for dual-battery and dual-voltage systems. Use 12/24V models to charge a 24V house bank from a 12V alternator/starter battery, or 24/12V models for 12V loads from 24V systems."
    },
    "battery-balancer": {
        type: "battery-balancer",
        name: "Victron Battery Balancer",
        description: "Balances the charge state of two 12V batteries connected in series for a 24V battery bank.",
        category: "control",
        terminals: [
            { id: "bank-positive", type: "positive", label: "24V+", mandatory: true, description: "Positive terminal of the 24V battery bank" },
            { id: "midpoint", type: "positive", label: "MID", mandatory: true, description: "Series midpoint between the two 12V batteries" },
            { id: "bank-negative", type: "negative", label: "0V-", mandatory: true, description: "Negative terminal of the 24V battery bank" },
            { id: "alarm", type: "data", label: "ALARM", mandatory: false, description: "Alarm contact for midpoint deviation" }
        ],
        wiringRules: [
            "Use when a 24V bank is built from two 12V batteries in series.",
            "Connect 24V+, midpoint, and 0V- sense leads directly to the battery bank with appropriate small fuses.",
            "Install one balancer per 24V string; use multiple balancers for larger series/parallel banks.",
            "Do not use on a single 12V battery bank."
        ],
        usageNotes: "Keeps series-connected 12V batteries balanced in 24V systems and provides midpoint deviation alarm output."
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
            { id: "fuse-4", type: "positive", label: "F4", mandatory: false, description: "Fused output 4 (MEGA fuse)" },
            { id: "neg-1", type: "negative", label: "N1", mandatory: false, description: "Unfused negative return 1" },
            { id: "neg-2", type: "negative", label: "N2", mandatory: false, description: "Unfused negative return 2" },
            { id: "neg-3", type: "negative", label: "N3", mandatory: false, description: "Unfused negative return 3" },
            { id: "neg-4", type: "negative", label: "N4", mandatory: false, description: "Unfused negative return 4" },
            { id: "bus-out-positive", type: "positive", label: "OUT+", mandatory: false, description: "Positive busbar to the next Lynx module" },
            { id: "bus-out-negative", type: "negative", label: "OUT-", mandatory: false, description: "Negative busbar to the next Lynx module" }
        ],
        wiringRules: [
            "Connect to Lynx Shunt or battery via main busbars.",
            "Each output requires appropriate MEGA fuse for connected device.",
            "Can be daisy-chained with other Lynx modules.",
            "Provides pre-alarm contacts for blown fuse detection."
        ],
        usageNotes: "Professional power distribution. Each slot accepts MEGA fuses up to 500A."
    },
    "lynx-power-in": {
        type: "lynx-power-in",
        name: "Lynx Power In",
        description: "Passive 1000A positive/negative busbar pair with four unfused connection pairs. Used to join batteries or Lynx modules.",
        category: "distribution",
        terminals: [
            { id: "main-positive", type: "positive", label: "BUS+", mandatory: true, description: "Main positive busbar" },
            { id: "main-negative", type: "negative", label: "BUS-", mandatory: true, description: "Main negative busbar" },
            { id: "pos-1", type: "positive", label: "P1", mandatory: false, description: "Unfused positive connection 1" },
            { id: "pos-2", type: "positive", label: "P2", mandatory: false, description: "Unfused positive connection 2" },
            { id: "pos-3", type: "positive", label: "P3", mandatory: false, description: "Unfused positive connection 3" },
            { id: "pos-4", type: "positive", label: "P4", mandatory: false, description: "Unfused positive connection 4" },
            { id: "neg-1", type: "negative", label: "N1", mandatory: false, description: "Unfused negative connection 1" },
            { id: "neg-2", type: "negative", label: "N2", mandatory: false, description: "Unfused negative connection 2" },
            { id: "neg-3", type: "negative", label: "N3", mandatory: false, description: "Unfused negative connection 3" },
            { id: "neg-4", type: "negative", label: "N4", mandatory: false, description: "Unfused negative connection 4" },
            { id: "bus-out-positive", type: "positive", label: "OUT+", mandatory: false, description: "Positive busbar to the next Lynx module" },
            { id: "bus-out-negative", type: "negative", label: "OUT-", mandatory: false, description: "Negative busbar to the next Lynx module" }
        ],
        wiringRules: [
            "Connections are UNFUSED - every battery landed here still needs its own fuse.",
            "Bolts directly to a Lynx Distributor, Lynx Shunt or Lynx Smart BMS via the busbars.",
            "Typically used to parallel multiple batteries into one bank."
        ],
        usageNotes: "Pure busbar - no fuses, no monitoring. Rated 1000A."
    },
    "lynx-shunt": {
        type: "lynx-shunt",
        name: "Lynx Shunt VE.Can",
        description: "Lynx busbar module with an integrated 1000A shunt for battery monitoring and a main fuse holder on the positive bar.",
        category: "distribution",
        terminals: [
            { id: "batt-positive", type: "positive", label: "BATT+", mandatory: true, description: "Battery positive (fused inside the module)" },
            { id: "batt-negative", type: "negative", label: "BATT-", mandatory: true, description: "Battery negative - shunt measures here" },
            { id: "bus-out-positive", type: "positive", label: "SYS+", mandatory: true, description: "System positive to loads/chargers or the next Lynx module" },
            { id: "bus-out-negative", type: "negative", label: "SYS-", mandatory: true, description: "System negative to loads/chargers or the next Lynx module" },
            { id: "ve-can", type: "data", label: "VE.Can", mandatory: false, description: "VE.Can to Cerbo GX" }
        ],
        wiringRules: [
            "Battery connects to the BATT+ / BATT- side; everything else connects on the SYS+ / SYS- side.",
            "ALL system current must pass through the module so the shunt reads correctly - same rule as a SmartShunt.",
            "The integrated fuse holder satisfies the main battery fuse requirement.",
            "Connect VE.Can to a Cerbo GX for monitoring."
        ],
        usageNotes: "Replaces a separate SmartShunt plus main fuse in a Lynx system."
    },
    "lynx-smart-bms": {
        type: "lynx-smart-bms",
        name: "Lynx Smart BMS",
        description: "Battery management system for Victron lithium (VE.Can) batteries with an integrated contactor, shunt and pre-alarm.",
        category: "distribution",
        terminals: [
            { id: "batt-positive", type: "positive", label: "BATT+", mandatory: true, description: "Battery bank positive" },
            { id: "batt-negative", type: "negative", label: "BATT-", mandatory: true, description: "Battery bank negative" },
            { id: "system-positive", type: "positive", label: "SYS+", mandatory: true, description: "System positive to loads/chargers" },
            { id: "system-negative", type: "negative", label: "SYS-", mandatory: true, description: "System negative to loads/chargers" },
            { id: "bms-can", type: "data", label: "BMS-Can", mandatory: false, description: "BMS-Can to the lithium batteries" },
            { id: "ve-can", type: "data", label: "VE.Can", mandatory: false, description: "VE.Can to Cerbo GX" },
            { id: "allow-to-charge", type: "data", label: "ATC", mandatory: false, description: "Allow-to-charge signal to chargers" }
        ],
        wiringRules: [
            "Only for Victron lithium batteries with BMS-Can (Smart Lithium / NG).",
            "Battery side and system side must not be swapped - the contactor disconnects the system side.",
            "The integrated shunt monitors all system current, so no separate SmartShunt is needed.",
            "The battery cable still needs its own fuse."
        ],
        usageNotes: "Available in 500A and 1000A. Combines BMS, contactor, shunt and pre-alarm in one Lynx module."
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
            "AGM batteries should be charged at lower voltage settings than LiFePO4.",
            "SERIES wiring (to build a higher voltage, e.g. 2x12V = 24V): connect battery1 'positive' to battery2 'negative' (this is the series link, polarity 'negative'). The bank's output is battery1 'negative' (bank minus) and battery2 'positive' (bank plus). Only the bank output positive needs a fuse - the series link does NOT.",
            "Series batteries must be identical (same voltage, capacity, age, and chemistry). The series total voltage must match the system voltage.",
            "For 24V or 48V banks built from 12V batteries in series, add a Victron Battery Balancer across the string."
        ],
        usageNotes: "Stores DC energy. Set type (LiFePO4/AGM/Lithium), voltage (12V/24V/48V), and capacity (Ah) in properties. For series banks, set each battery to its individual voltage (e.g. 12V) and the system voltage to the series total (e.g. 24V)."
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
        name: "Fuse",
        description: "DC fuse. The fuseType property selects the family: class-t, mrbf, anl, mega, midi or blade.",
        category: "distribution",
        terminals: [
            { id: "in", type: "positive", label: "IN", mandatory: true, description: "Line side (battery)" },
            { id: "out", type: "positive", label: "OUT", mandatory: true, description: "Load side (inverter/busbar)" }
        ],
        wiringRules: [
            "The main battery fuse must be placed as close as possible to the battery positive terminal.",
            "Size based on the downstream device's maximum current plus 25% safety margin.",
            "Battery main on a lithium bank: class-t (20,000A interrupt) or mrbf (10,000A).",
            "Branch circuits: blade up to 30A, midi up to 150A, mega or anl for larger charger and inverter feeds.",
            "Do NOT put a 100A+ Class T fuse on a small circuit - use the family that matches the current."
        ],
        usageNotes: "Every battery positive needs protection. Pick the fuse family that matches the circuit size."
    },
    "dc-breaker": {
        type: "dc-breaker",
        name: "DC Circuit Breaker",
        description: "Resettable DC breaker for branch circuits. Also works as a disconnect switch.",
        category: "distribution",
        terminals: [
            { id: "in", type: "positive", label: "IN", mandatory: true, description: "Line side (battery/busbar)" },
            { id: "out", type: "positive", label: "OUT", mandatory: true, description: "Load side (panel/device)" }
        ],
        wiringRules: [
            "Use for a DC panel feed, an MPPT, a windlass or any circuit the user wants to switch off.",
            "Set amps to the circuit rating (5-300A).",
            "Do NOT use as the main battery fuse on a lithium bank - a breaker cannot interrupt a lithium short circuit. Use class-t or mrbf there."
        ],
        usageNotes: "Resettable protection plus disconnect in one device."
    },
    "ac-breaker": {
        type: "ac-breaker",
        name: "AC Circuit Breaker",
        description: "AC breaker for a shore power main or an AC branch circuit.",
        category: "distribution",
        terminals: [
            { id: "in-hot", type: "ac-in", label: "L IN", mandatory: true, description: "Line in (from shore/inverter)" },
            { id: "in-neutral", type: "ac-in", label: "N IN", mandatory: true, description: "Neutral in" },
            { id: "in-ground", type: "ground", label: "G IN", mandatory: false, description: "Ground in" },
            { id: "out-hot", type: "ac-out", label: "L OUT", mandatory: true, description: "Line out (to panel/load)" },
            { id: "out-neutral", type: "ac-out", label: "N OUT", mandatory: true, description: "Neutral out" },
            { id: "out-ground", type: "ground", label: "G OUT", mandatory: false, description: "Ground out" }
        ],
        wiringRules: [
            "Shore power inlet must go through an AC main breaker before anything else.",
            "Use 2 poles for a shore power main and for any 240V split-phase circuit.",
            "Match the rating to the shore inlet (15A, 30A, 50A) or to the branch circuit."
        ],
        usageNotes: "Standard AC protection. Place between shore power and the inverter/charger AC input."
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
