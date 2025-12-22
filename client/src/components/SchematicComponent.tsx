import { TERMINAL_CONFIGS, Terminal } from "@/lib/terminal-config";

interface ComponentProperties {
  voltage?: number;
  capacity?: number;
  batteryType?: string;
  watts?: number;
  amps?: number;
  fuseRating?: number;
  [key: string]: any;
}

interface SchematicComponentProps {
  type: string;
  name: string;
  properties?: ComponentProperties;
  selected?: boolean;
  validationStatus?: "error" | "warning";
  onClick?: (e?: React.MouseEvent) => void;
  onTerminalClick?: (terminal: Terminal, e: React.MouseEvent) => void;
  highlightedTerminals?: string[]; // Terminal IDs to highlight
}

export function SchematicComponent({
  type,
  name,
  properties = {},
  selected,
  validationStatus,
  onClick,
  onTerminalClick,
  highlightedTerminals = []
}: SchematicComponentProps) {
  const config = TERMINAL_CONFIGS[type];

  const handleTerminalClick = (terminal: Terminal, e: React.MouseEvent) => {
    console.log('Terminal clicked:', terminal.id, 'on component type:', type);
    e.stopPropagation();
    e.preventDefault();
    onTerminalClick?.(terminal, e);
  };

  const renderShape = () => {
    switch (type) {
      case "multiplus":
        return (
          <svg width="180" height="140" viewBox="0 0 180 140">
            {/* Main blue housing */}
            <rect x="10" y="10" width="160" height="120" fill="hsl(var(--victron-blue))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" rx="8" />

            {/* Top label area */}
            <rect x="20" y="20" width="140" height="30" fill="hsl(var(--victron-blue-light))" rx="4" />
            <text x="90" y="32" textAnchor="middle" className="fill-white text-xs font-bold">MultiPlus</text>
            <text x="90" y="44" textAnchor="middle" className="fill-white text-[10px] opacity-90">Inverter/Charger</text>

            {/* LED indicators */}
            <circle cx="30" cy="65" r="4" fill="#00ff00" className="opacity-80" />
            <circle cx="45" cy="65" r="4" fill="#ffaa00" className="opacity-80" />
            <circle cx="60" cy="65" r="4" fill="#ff0000" className="opacity-80" />

            {/* Connection terminals */}
            <rect x="20" y="85" width="140" height="35" fill="black" fillOpacity="0.2" rx="3" />
            <text x="90" y="100" textAnchor="middle" className="fill-white text-[9px] font-semibold">AC IN    AC OUT    DC</text>
            <circle cx="40" cy="110" r="5" fill="hsl(var(--background))" stroke="white" strokeWidth="1" />
            <circle cx="90" cy="110" r="5" fill="hsl(var(--background))" stroke="white" strokeWidth="1" />
            <circle cx="140" cy="110" r="5" fill="hsl(var(--background))" stroke="white" strokeWidth="1" />

            {/* Victron branding */}
            <text x="90" y="127" textAnchor="middle" className="fill-white text-[8px] opacity-70">victron energy</text>
          </svg>
        );

      case "mppt": {
        const mpptAmps = properties.amps || properties.current || 30;
        return (
          <svg width="160" height="130" viewBox="0 0 160 130">
            {/* Main blue housing */}
            <rect x="10" y="10" width="140" height="110" fill="hsl(var(--victron-blue))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" rx="8" />

            {/* LCD Display area */}
            <rect x="25" y="25" width="110" height="45" fill="#2a4a5a" rx="3" />
            <rect x="30" y="30" width="100" height="35" fill="#3d6d7a" rx="2" />

            {/* Display content */}
            <text x="80" y="42" textAnchor="middle" className="fill-cyan-300 text-xs font-mono">BULK</text>
            <text x="50" y="58" textAnchor="middle" className="fill-cyan-300 text-[10px] font-mono">PV 45V</text>
            <text x="110" y="58" textAnchor="middle" className="fill-cyan-300 text-[10px] font-mono">{mpptAmps}A</text>

            {/* Product label */}
            <text x="80" y="85" textAnchor="middle" className="fill-white text-xs font-bold">SmartSolar</text>
            <text x="80" y="98" textAnchor="middle" className="fill-white text-[10px]">MPPT 100|{mpptAmps}</text>

            {/* Connection terminals */}
            <circle cx="30" cy="108" r="4" fill="hsl(var(--background))" stroke="white" strokeWidth="1" />
            <circle cx="50" cy="108" r="4" fill="hsl(var(--background))" stroke="white" strokeWidth="1" />
            <circle cx="110" cy="108" r="4" fill="hsl(var(--background))" stroke="white" strokeWidth="1" />
            <circle cx="130" cy="108" r="4" fill="hsl(var(--background))" stroke="white" strokeWidth="1" />

            <text x="40" y="122" textAnchor="middle" className="fill-white text-[8px]">PV</text>
            <text x="120" y="122" textAnchor="middle" className="fill-white text-[8px]">BATT</text>
          </svg>
        );
      }

      case "cerbo":
        return (
          <svg width="180" height="120" viewBox="0 0 180 120">
            {/* Main blue housing */}
            <rect x="10" y="10" width="160" height="100" fill="hsl(var(--victron-blue))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" rx="8" />

            {/* Touch screen display */}
            <rect x="25" y="20" width="130" height="70" fill="#1a1a1a" rx="4" />
            <rect x="30" y="25" width="120" height="60" fill="#2a2a2a" rx="2" />

            {/* Screen content - Dashboard */}
            <text x="90" y="38" textAnchor="middle" className="fill-cyan-400 text-xs font-bold">CERBO GX</text>
            <line x1="40" y1="45" x2="140" y2="45" stroke="hsl(var(--border))" strokeWidth="1" />

            {/* Status indicators on screen */}
            <circle cx="50" cy="58" r="6" fill="#00ff00" />
            <text x="65" y="61" className="fill-white text-[9px]">Inverter</text>

            <circle cx="50" cy="72" r="6" fill="#00ff00" />
            <text x="65" y="75" className="fill-white text-[9px]">Solar</text>

            {/* Connection ports on side */}
            <rect x="160" y="30" width="8" height="6" fill="#333" />
            <rect x="160" y="45" width="8" height="6" fill="#333" />
            <rect x="160" y="60" width="8" height="6" fill="#333" />
            <rect x="160" y="75" width="8" height="6" fill="#333" />

            {/* Branding */}
            <text x="90" y="103" textAnchor="middle" className="fill-white text-[8px] opacity-70">victron energy</text>
          </svg>
        );

      case "bmv":
        return (
          <svg width="140" height="140" viewBox="0 0 140 140">
            {/* Main blue housing */}
            <rect x="10" y="15" width="120" height="110" fill="hsl(var(--victron-blue))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" rx="8" />

            {/* LCD Display */}
            <rect x="20" y="25" width="100" height="55" fill="#2a4a5a" rx="3" />
            <rect x="23" y="28" width="94" height="49" fill="#3d6d7a" rx="2" />

            {/* Display readings */}
            <text x="70" y="42" textAnchor="middle" className="fill-cyan-300 text-sm font-mono font-bold">12.8V</text>
            <text x="70" y="57" textAnchor="middle" className="fill-cyan-300 text-xs font-mono">8.1A</text>
            <text x="70" y="70" textAnchor="middle" className="fill-cyan-300 text-xs font-mono">103W</text>

            {/* Product label */}
            <text x="70" y="95" textAnchor="middle" className="fill-white text-xs font-bold">BMV-712</text>
            <text x="70" y="107" textAnchor="middle" className="fill-white text-[9px]">SMART</text>

            {/* Control buttons */}
            <circle cx="35" cy="115" r="6" fill="#1a1a1a" stroke="white" strokeWidth="1" />
            <text x="35" y="117" textAnchor="middle" className="fill-white text-[7px]">◀</text>

            <circle cx="70" cy="115" r="6" fill="#1a1a1a" stroke="white" strokeWidth="1" />
            <text x="70" y="117" textAnchor="middle" className="fill-white text-[7px]">✓</text>

            <circle cx="105" cy="115" r="6" fill="#1a1a1a" stroke="white" strokeWidth="1" />
            <text x="105" y="117" textAnchor="middle" className="fill-white text-[7px]">▶</text>

            {/* Connection terminal */}
            <rect x="125" y="55" width="10" height="8" fill="hsl(var(--background))" stroke="white" strokeWidth="1" />
          </svg>
        );

      case "smartshunt":
        return (
          <svg width="140" height="130" viewBox="0 0 140 130">
            {/* Main blue housing */}
            <rect x="10" y="15" width="120" height="100" fill="hsl(var(--victron-blue))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" rx="8" />

            {/* Product label */}
            <text x="70" y="32" textAnchor="middle" className="fill-white text-xs font-bold">SmartShunt</text>
            <text x="70" y="45" textAnchor="middle" className="fill-white text-[10px] opacity-90">500A/50mV</text>

            {/* LED indicator */}
            <circle cx="70" cy="60" r="5" fill="#00ff00" className="opacity-80" />
            <text x="70" y="73" textAnchor="middle" className="fill-white text-[8px]">BLUETOOTH</text>

            {/* Shunt bar representation */}
            <rect x="20" y="82" width="100" height="18" fill="#1a1a1a" stroke="white" strokeWidth="1" rx="2" />
            <line x1="30" y1="91" x2="110" y2="91" stroke="hsl(var(--wire-negative))" strokeWidth="3" />

            {/* Terminal labels */}
            <text x="20" y="112" textAnchor="start" className="fill-white text-[7px]">BATT-</text>
            <text x="70" y="112" textAnchor="middle" className="fill-white text-[7px]">SYS-</text>
            <text x="120" y="112" textAnchor="end" className="fill-white text-[7px]">DATA</text>

            {/* Victron branding */}
            <text x="70" y="125" textAnchor="middle" className="fill-white text-[8px] opacity-70">victron energy</text>
          </svg>
        );

      case "busbar-positive":
        return (
          <svg width="200" height="60" viewBox="0 0 200 60">
            {/* Main copper bus bar */}
            <rect x="10" y="20" width="180" height="20" fill="#b87333" stroke="#8b5a2b" strokeWidth="2" rx="2" />

            {/* Metallic shine effect */}
            <rect x="12" y="22" width="176" height="4" fill="#d4a574" opacity="0.5" />

            {/* Mounting holes */}
            <circle cx="20" cy="30" r="3" fill="#2a2a2a" />
            <circle cx="180" cy="30" r="3" fill="#2a2a2a" />

            {/* Connection screws */}
            {[40, 60, 80, 100, 120, 140].map((x, i) => (
              <g key={i}>
                <circle cx={x} cy="40" r="5" fill="#4a4a4a" stroke="#2a2a2a" strokeWidth="1" />
                <line x1={x - 2} y1={40} x2={x + 2} y2={40} stroke="#6a6a6a" strokeWidth="1" />
              </g>
            ))}

            {/* Label */}
            <text x="100" y="12" textAnchor="middle" className="fill-foreground text-[10px] font-bold">POSITIVE BUS BAR</text>
            <text x="100" y="54" textAnchor="middle" className="fill-destructive text-[9px] font-semibold">+ DC</text>
          </svg>
        );

      case "busbar-negative":
        return (
          <svg width="200" height="60" viewBox="0 0 200 60">
            {/* Main copper bus bar */}
            <rect x="10" y="20" width="180" height="20" fill="#2a2a2a" stroke="#1a1a1a" strokeWidth="2" rx="2" />

            {/* Metallic shine effect */}
            <rect x="12" y="22" width="176" height="4" fill="#4a4a4a" opacity="0.5" />

            {/* Mounting holes */}
            <circle cx="20" cy="30" r="3" fill="#0a0a0a" />
            <circle cx="180" cy="30" r="3" fill="#0a0a0a" />

            {/* Connection screws */}
            {[40, 60, 80, 100, 120, 140].map((x, i) => (
              <g key={i}>
                <circle cx={x} cy="40" r="5" fill="#4a4a4a" stroke="#2a2a2a" strokeWidth="1" />
                <line x1={x - 2} y1={40} x2={x + 2} y2={40} stroke="#6a6a6a" strokeWidth="1" />
              </g>
            ))}

            {/* Label */}
            <text x="100" y="12" textAnchor="middle" className="fill-foreground text-[10px] font-bold">NEGATIVE BUS BAR</text>
            <text x="100" y="54" textAnchor="middle" className="fill-foreground text-[9px] font-semibold">- DC</text>
          </svg>
        );

      case "battery": {
        const batteryType = properties.batteryType || 'LiFePO4';
        const voltage = properties.voltage || 12;
        const capacity = properties.capacity || 200;
        const wattHours = voltage * capacity;
        
        // Color scheme based on battery type
        const isLithium = batteryType === 'LiFePO4' || batteryType === 'Lithium';
        const casingColor = isLithium ? '#1e3a5f' : '#1a1a2e';
        const casingStroke = isLithium ? '#2a5a8f' : '#2a2a3e';
        const typeColor = isLithium ? '#4ade80' : '#9ca3af';
        
        return (
          <svg width="160" height="110" viewBox="0 0 160 110">
            {/* Battery casing */}
            <rect x="20" y="25" width="120" height="70" fill={casingColor} stroke={casingStroke} strokeWidth="2" rx="6" />

            {/* Terminal posts */}
            <rect x="140" y="48" width="12" height="24" fill={casingColor} stroke={casingStroke} strokeWidth="2" />

            {/* Battery label */}
            <text x="80" y="15" textAnchor="middle" className="fill-foreground text-sm font-bold">{name || 'Battery Bank'}</text>
            <text x="80" y="48" textAnchor="middle" style={{ fill: typeColor }} className="text-xs font-medium">{batteryType}</text>
            <text x="80" y="63" textAnchor="middle" className="fill-gray-200 text-sm font-bold">{voltage}V {capacity}Ah</text>
            <text x="80" y="78" textAnchor="middle" className="fill-gray-400 text-[10px]">{wattHours}Wh</text>

            {/* Lithium indicator for LiFePO4 */}
            {isLithium && (
              <g>
                <rect x="25" y="82" width="30" height="10" fill="#22c55e" opacity="0.3" rx="2" />
                <text x="40" y="90" textAnchor="middle" className="fill-green-400 text-[7px] font-bold">BMS</text>
              </g>
            )}

            {/* Warning symbols */}
            <path d="M 60 85 L 65 75 L 70 85 Z" fill="orange" stroke="orange" strokeWidth="1" />
            <text x="62" y="83" className="fill-black text-[8px] font-bold">!</text>

            {/* Terminal indicators */}
            <circle cx="10" cy="60" r="6" fill="hsl(var(--wire-negative))" stroke="hsl(var(--foreground))" strokeWidth="1" />
            <text x="10" y="63" textAnchor="middle" className="fill-white text-xs font-bold">−</text>

            <circle cx="150" cy="60" r="6" fill="hsl(var(--wire-positive))" stroke="hsl(var(--foreground))" strokeWidth="1" />
            <text x="150" y="63" textAnchor="middle" className="fill-white text-xs font-bold">+</text>
          </svg>
        );
      }

      case "solar-panel": {
        const watts = properties.watts || properties.power || 300;
        const voltage = properties.voltage || 12;
        const panelType = properties.panelType || "Monocrystalline";
        return (
          <svg width="140" height="120" viewBox="0 0 140 120">
            {/* Panel frame */}
            <rect x="15" y="20" width="110" height="75" fill="#1a1a3a" stroke="#2a2a4a" strokeWidth="3" rx="4" />

            {/* Solar cells grid */}
            <rect x="20" y="25" width="100" height="65" fill="#0a0a2a" />

            {/* Grid pattern for cells */}
            <line x1="20" y1="42" x2="120" y2="42" stroke="#2a2a4a" strokeWidth="1" />
            <line x1="20" y1="57" x2="120" y2="57" stroke="#2a2a4a" strokeWidth="1" />
            <line x1="20" y1="73" x2="120" y2="73" stroke="#2a2a4a" strokeWidth="1" />
            <line x1="45" y1="25" x2="45" y2="90" stroke="#2a2a4a" strokeWidth="1" />
            <line x1="70" y1="25" x2="70" y2="90" stroke="#2a2a4a" strokeWidth="1" />
            <line x1="95" y1="25" x2="95" y2="90" stroke="#2a2a4a" strokeWidth="1" />

            {/* Solar reflection effect */}
            <rect x="25" y="30" width="15" height="15" fill="url(#solarGradient)" opacity="0.3" />

            {/* Power and voltage display */}
            <rect x="25" y="50" width="90" height="20" fill="#0a0a1a" rx="2" />
            <text x="70" y="60" textAnchor="middle" className="fill-green-400 text-[10px] font-mono font-bold">{watts}W</text>
            <text x="70" y="68" textAnchor="middle" className="fill-gray-400 text-[8px]">{voltage}V</text>

            {/* Label */}
            <text x="70" y="13" textAnchor="middle" className="fill-foreground text-xs font-semibold">{name || 'Solar Panel'}</text>
            <text x="70" y="107" textAnchor="middle" className="fill-foreground text-[10px]">{panelType}</text>

            {/* Junction box */}
            <rect x="60" y="95" width="20" height="10" fill="#2a2a2a" stroke="#3a3a3a" strokeWidth="1" />

            {/* Gradient definition */}
            <defs>
              <linearGradient id="solarGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: 'white', stopOpacity: 0.8 }} />
                <stop offset="100%" style={{ stopColor: 'transparent', stopOpacity: 0 }} />
              </linearGradient>
            </defs>
          </svg>
        );
      }

      case "ac-load": {
        const watts = properties.watts || properties.power || 0;
        const acVoltage = properties.acVoltage || properties.voltage || 120;
        const current = watts > 0 && acVoltage > 0 ? (watts / acVoltage).toFixed(1) : 0;
        return (
          <svg width="120" height="100" viewBox="0 0 120 100">
            {/* Generic AC appliance icon */}
            <rect x="20" y="25" width="80" height="55" fill="#3a3a3a" stroke="#4a4a4a" strokeWidth="2" rx="6" />

            {/* Power symbol */}
            <circle cx="60" cy="52" r="18" fill="none" stroke="white" strokeWidth="3" />
            <line x1="60" y1="40" x2="60" y2="60" stroke="white" strokeWidth="3" />

            {/* Power and voltage display */}
            {watts > 0 && (
              <rect x="25" y="40" width="70" height="18" fill="#0a0a1a" rx="2" />
            )}
            {watts > 0 && (
              <text x="60" y="50" textAnchor="middle" className="fill-yellow-400 text-[9px] font-mono font-bold">{watts}W</text>
            )}
            {watts > 0 && (
              <text x="60" y="57" textAnchor="middle" className="fill-gray-400 text-[8px]">{acVoltage}V AC</text>
            )}

            {/* Connection */}
            <rect x="10" y="48" width="15" height="8" fill="hsl(var(--background))" stroke="hsl(var(--foreground))" strokeWidth="2" />

            <text x="60" y="17" textAnchor="middle" className="fill-foreground text-xs font-semibold">{name || 'AC Load'}</text>
            {watts > 0 ? (
              <text x="60" y="93" textAnchor="middle" className="fill-foreground text-[10px]">{current}A @ {acVoltage}V AC</text>
            ) : (
              <text x="60" y="93" textAnchor="middle" className="fill-foreground text-[10px]">{acVoltage}V AC Appliances</text>
            )}
          </svg>
        );
      }

      case "dc-load": {
        const watts = properties.watts || properties.power || 0;
        const voltage = properties.voltage || 12;
        const current = watts > 0 && voltage > 0 ? (watts / voltage).toFixed(1) : 0;
        return (
          <svg width="120" height="100" viewBox="0 0 120 100">
            {/* Generic DC device */}
            <rect x="20" y="25" width="80" height="55" fill="#2a2a3a" stroke="#3a3a4a" strokeWidth="2" rx="6" />

            {/* DC symbol */}
            <line x1="45" y1="52" x2="75" y2="52" stroke="white" strokeWidth="3" />
            <line x1="45" y1="45" x2="45" y2="59" stroke="white" strokeWidth="2" />
            <line x1="75" y1="45" x2="75" y2="59" stroke="white" strokeWidth="2" />

            {/* Power and voltage display */}
            {watts > 0 && (
              <rect x="25" y="40" width="70" height="18" fill="#0a0a1a" rx="2" />
            )}
            {watts > 0 && (
              <text x="60" y="50" textAnchor="middle" className="fill-cyan-400 text-[9px] font-mono font-bold">{watts}W</text>
            )}
            {watts > 0 && (
              <text x="60" y="57" textAnchor="middle" className="fill-gray-400 text-[8px]">{voltage}V DC</text>
            )}

            {/* Connection */}
            <rect x="10" y="48" width="15" height="8" fill="hsl(var(--background))" stroke="hsl(var(--foreground))" strokeWidth="2" />

            <text x="60" y="17" textAnchor="middle" className="fill-foreground text-xs font-semibold">{name || 'DC Load'}</text>
            {watts > 0 ? (
              <text x="60" y="93" textAnchor="middle" className="fill-foreground text-[10px]">{current}A @ {voltage}V DC</text>
            ) : (
              <text x="60" y="93" textAnchor="middle" className="fill-foreground text-[10px]">{voltage}V DC Devices</text>
            )}
          </svg>
        );
      }

      case "fuse": {
        const fuseRating = properties.fuseRating || properties.amps || 400;
        return (
          <svg width="80" height="60" viewBox="0 0 80 60">
            {/* Fuse holder body - blue for Class T */}
            <rect x="10" y="15" width="60" height="30" fill="#1e3a5f" stroke="#2a5a8f" strokeWidth="2" rx="4" />

            {/* Fuse element window */}
            <rect x="25" y="20" width="30" height="20" fill="#0a1a2e" rx="2" />
            
            {/* Class T indicator */}
            <text x="40" y="28" textAnchor="middle" className="fill-cyan-400 text-[8px] font-bold">CLASS T</text>
            <text x="40" y="37" textAnchor="middle" className="fill-white text-[9px] font-bold">{fuseRating}A</text>

            {/* Connection terminals */}
            <circle cx="10" cy="30" r="4" fill="#b87333" stroke="#8b5a2b" strokeWidth="1" />
            <circle cx="70" cy="30" r="4" fill="#b87333" stroke="#8b5a2b" strokeWidth="1" />

            {/* Label */}
            <text x="40" y="8" textAnchor="middle" className="fill-foreground text-[9px] font-bold">CLASS T FUSE</text>
            <text x="40" y="55" textAnchor="middle" className="fill-muted-foreground text-[7px]">20kAIC</text>
          </svg>
        );
      }

      case "switch":
        return (
          <svg width="80" height="80" viewBox="0 0 80 80">
            {/* Switch base */}
            <rect x="10" y="10" width="60" height="60" fill="#cc0000" stroke="#990000" strokeWidth="2" rx="8" />

            {/* Rotary knob */}
            <circle cx="40" cy="40" r="20" fill="#aa0000" stroke="#880000" strokeWidth="2" />
            <rect x="36" y="25" width="8" height="30" fill="#ffcccc" rx="2" />

            {/* Labels */}
            <text x="40" y="65" textAnchor="middle" className="fill-white text-[8px] font-bold">ON</text>
            <text x="40" y="25" textAnchor="middle" className="fill-white text-[8px] font-bold">OFF</text>
            <text x="40" y="78" textAnchor="middle" className="fill-foreground text-[9px] font-bold">SWITCH</text>
          </svg>
        );

      case "breaker-panel":
        return (
          <svg width="160" height="200" viewBox="0 0 160 200">
            {/* Panel housing */}
            <rect x="5" y="5" width="150" height="190" fill="#e0e0e0" stroke="#999" strokeWidth="2" rx="4" />

            {/* Header */}
            <rect x="15" y="15" width="130" height="25" fill="#333" rx="2" />
            <text x="80" y="32" textAnchor="middle" className="fill-white text-xs font-bold">DISTRIBUTION</text>

            {/* Breaker Rows */}
            {[0, 1, 2, 3].map((i) => (
              <g key={i} transform={`translate(0, ${i * 30})`}>
                {/* Breaker switch */}
                <rect x="20" y="55" width="40" height="20" fill="#fff" stroke="#666" strokeWidth="1" rx="2" />
                <rect x="25" y="58" width="10" height="14" fill="#333" rx="1" />
                {/* Label */}
                <text x="70" y="68" className="fill-black text-[10px] font-mono">LOAD {i + 1}</text>
                {/* LED */}
                <circle cx="130" cy="65" r="3" fill="#00ff00" opacity="0.8" />
              </g>
            ))}

            {/* Main Breaker Area */}
            <rect x="15" y="165" width="130" height="25" fill="#ccc" stroke="#999" strokeWidth="1" rx="2" />
            <text x="80" y="182" textAnchor="middle" className="fill-black text-[10px] font-bold">MAIN DC INPUT</text>
          </svg>
        );
      case "ac-panel":
        return (
          <svg width="180" height="220" viewBox="0 0 180 220">
            <rect x="0" y="0" width="180" height="220" rx="4" fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="2" />
            <rect x="0" y="0" width="180" height="30" rx="4" fill="hsl(var(--muted))" />
            <text x="90" y="20" textAnchor="middle" className="fill-foreground text-xs font-bold">AC DISTRIBUTION</text>

            {/* Breakers */}
            <rect x="20" y="40" width="120" height="20" rx="2" fill="hsl(var(--background))" stroke="hsl(var(--border))" />
            <rect x="25" y="45" width="30" height="10" rx="1" fill="hsl(var(--primary))" />
            <text x="65" y="55" className="fill-foreground text-[10px]">Load 1</text>

            <rect x="20" y="120" width="120" height="20" rx="2" fill="hsl(var(--background))" stroke="hsl(var(--border))" />
            <rect x="25" y="125" width="30" height="10" rx="1" fill="hsl(var(--primary))" />
            <text x="65" y="135" className="fill-foreground text-[10px]">Load 2</text>

            {/* Main Input Area */}
            <rect x="10" y="180" width="160" height="30" rx="2" fill="hsl(var(--muted))" opacity="0.3" />
            <text x="90" y="198" textAnchor="middle" className="fill-muted-foreground text-[10px]">MAIN INPUT</text>
          </svg>
        );
      case "dc-panel":
        return (
          <svg width="160" height="240" viewBox="0 0 160 240">
            <rect x="0" y="0" width="160" height="240" rx="4" fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="2" />
            <rect x="0" y="0" width="160" height="30" rx="4" fill="hsl(var(--muted))" />
            <text x="80" y="20" textAnchor="middle" className="fill-foreground text-xs font-bold">DC DISTRIBUTION</text>

            {/* Fuses/Breakers */}
            {[0, 1, 2].map((i) => (
              <g key={i} transform={`translate(20, ${40 + i * 60})`}>
                <rect x="0" y="0" width="100" height="40" rx="2" fill="hsl(var(--background))" stroke="hsl(var(--border))" />
                <circle cx="20" cy="20" r="8" fill="hsl(var(--destructive))" opacity="0.2" />
                <text x="40" y="25" className="fill-foreground text-[10px]">Load {i + 1}</text>
              </g>
            ))}

            {/* Main Input Area */}
            <rect x="10" y="210" width="140" height="20" rx="2" fill="hsl(var(--muted))" opacity="0.3" />
            <text x="80" y="223" textAnchor="middle" className="fill-muted-foreground text-[10px]">MAIN INPUT</text>
          </svg>
        );
      case "orion-dc-dc": {
        const orionAmps = properties.amps || 30;
        return (
          <svg width="160" height="120" viewBox="0 0 160 120">
            {/* Main blue housing */}
            <rect x="10" y="15" width="140" height="90" fill="hsl(var(--victron-blue))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" rx="8" />

            {/* Top label area */}
            <rect x="20" y="22" width="120" height="28" fill="hsl(var(--victron-blue-light))" rx="4" />
            <text x="80" y="34" textAnchor="middle" className="fill-white text-[10px] font-bold">Orion-Tr Smart</text>
            <text x="80" y="45" textAnchor="middle" className="fill-white text-[9px]">DC-DC Charger</text>

            {/* LED indicators */}
            <circle cx="30" cy="62" r="4" fill="#00ff00" className="opacity-80" />
            <circle cx="45" cy="62" r="4" fill="#0088ff" className="opacity-80" />
            
            {/* Current display */}
            <rect x="60" y="55" width="80" height="20" fill="#0a1a2e" rx="3" />
            <text x="100" y="68" textAnchor="middle" className="fill-cyan-300 text-xs font-mono">{orionAmps}A</text>

            {/* Direction arrow */}
            <text x="80" y="88" textAnchor="middle" className="fill-white text-sm">→</text>
            <text x="30" y="92" textAnchor="middle" className="fill-white text-[8px]">IN</text>
            <text x="130" y="92" textAnchor="middle" className="fill-white text-[8px]">OUT</text>

            {/* Victron branding */}
            <text x="80" y="112" textAnchor="middle" className="fill-foreground text-[8px] opacity-70">victron energy</text>
          </svg>
        );
      }

      case "phoenix-inverter": {
        const phoenixWatts = properties.watts || 1200;
        const kw = phoenixWatts >= 1000 ? `${(phoenixWatts / 1000).toFixed(1)}kW` : `${phoenixWatts}W`;
        return (
          <svg width="160" height="130" viewBox="0 0 160 130">
            {/* Main blue housing */}
            <rect x="10" y="15" width="140" height="100" fill="hsl(var(--victron-blue))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" rx="8" />

            {/* Top label area */}
            <rect x="20" y="22" width="120" height="30" fill="hsl(var(--victron-blue-light))" rx="4" />
            <text x="80" y="34" textAnchor="middle" className="fill-white text-xs font-bold">Phoenix</text>
            <text x="80" y="46" textAnchor="middle" className="fill-white text-[10px]">Inverter {kw}</text>

            {/* LED indicators */}
            <circle cx="30" cy="68" r="4" fill="#00ff00" className="opacity-80" />
            <text x="45" y="70" className="fill-white text-[8px]">ON</text>
            <circle cx="30" cy="82" r="4" fill="#ffaa00" className="opacity-50" />
            <text x="45" y="84" className="fill-white text-[8px]">ECO</text>

            {/* Power display */}
            <rect x="70" y="60" width="70" height="28" fill="#0a1a2e" rx="3" />
            <text x="105" y="72" textAnchor="middle" className="fill-green-400 text-[10px] font-mono">{phoenixWatts}W</text>
            <text x="105" y="83" textAnchor="middle" className="fill-gray-400 text-[7px]">PURE SINE</text>

            {/* DC/AC labels */}
            <text x="20" y="102" className="fill-white text-[8px] font-bold">DC IN</text>
            <text x="115" y="102" className="fill-white text-[8px] font-bold">AC OUT</text>

            {/* Victron branding */}
            <text x="80" y="122" textAnchor="middle" className="fill-foreground text-[8px] opacity-70">victron energy</text>
          </svg>
        );
      }

      case "lynx-distributor":
        return (
          <svg width="220" height="100" viewBox="0 0 220 100">
            {/* Main housing */}
            <rect x="5" y="10" width="210" height="80" fill="#2a2a3a" stroke="#3a3a4a" strokeWidth="2" rx="6" />

            {/* Top label */}
            <rect x="15" y="15" width="190" height="22" fill="hsl(var(--victron-blue))" rx="3" />
            <text x="110" y="30" textAnchor="middle" className="fill-white text-xs font-bold">LYNX DISTRIBUTOR</text>

            {/* Busbar visualization */}
            <rect x="15" y="42" width="190" height="12" fill="#b87333" stroke="#8b5a2b" strokeWidth="1" rx="2" />
            <rect x="17" y="44" width="186" height="3" fill="#d4a574" opacity="0.5" />

            {/* Fuse slots */}
            {[60, 100, 140, 180].map((x, i) => (
              <g key={i}>
                <rect x={x - 15} y="58" width="30" height="25" fill="#1a1a1a" stroke="#333" strokeWidth="1" rx="2" />
                <rect x={x - 10} y="62" width="20" height="10" fill="#333" rx="1" />
                <text x={x} y="80" textAnchor="middle" className="fill-gray-400 text-[7px]">F{i + 1}</text>
              </g>
            ))}

            {/* Input label */}
            <text x="25" y="75" textAnchor="middle" className="fill-gray-400 text-[8px]">BUS</text>

            {/* Victron branding */}
            <text x="110" y="96" textAnchor="middle" className="fill-foreground text-[7px] opacity-70">victron energy</text>
          </svg>
        );

      case "battery-protect": {
        const bpAmps = properties.amps || 100;
        return (
          <svg width="120" height="100" viewBox="0 0 120 100">
            {/* Main blue housing */}
            <rect x="10" y="15" width="100" height="70" fill="hsl(var(--victron-blue))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" rx="6" />

            {/* Label */}
            <text x="60" y="30" textAnchor="middle" className="fill-white text-[9px] font-bold">Battery Protect</text>
            <text x="60" y="42" textAnchor="middle" className="fill-white text-[10px]">{bpAmps}A</text>

            {/* LED indicator */}
            <circle cx="60" cy="55" r="5" fill="#00ff00" className="opacity-80" />

            {/* Status text */}
            <text x="60" y="70" textAnchor="middle" className="fill-white text-[8px]">ACTIVE</text>

            {/* Direction arrow */}
            <text x="60" y="82" textAnchor="middle" className="fill-white text-sm">→</text>
            <text x="20" y="82" textAnchor="middle" className="fill-white text-[7px]">IN</text>
            <text x="100" y="82" textAnchor="middle" className="fill-white text-[7px]">OUT</text>

            {/* Victron branding */}
            <text x="60" y="95" textAnchor="middle" className="fill-foreground text-[7px] opacity-70">victron energy</text>
          </svg>
        );
      }

      case "blue-smart-charger": {
        const chargerAmps = properties.amps || 15;
        return (
          <svg width="140" height="120" viewBox="0 0 140 120">
            {/* Main blue housing */}
            <rect x="10" y="15" width="120" height="90" fill="hsl(var(--victron-blue))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" rx="8" />

            {/* Top label area */}
            <rect x="20" y="22" width="100" height="28" fill="hsl(var(--victron-blue-light))" rx="4" />
            <text x="70" y="34" textAnchor="middle" className="fill-white text-[9px] font-bold">Blue Smart IP65</text>
            <text x="70" y="45" textAnchor="middle" className="fill-white text-[10px]">Charger {chargerAmps}A</text>

            {/* LED indicator */}
            <circle cx="70" cy="62" r="5" fill="#00ff00" className="opacity-80" />
            <text x="70" y="75" textAnchor="middle" className="fill-white text-[8px]">CHARGING</text>

            {/* AC/DC labels */}
            <text x="25" y="92" textAnchor="middle" className="fill-white text-[8px] font-bold">AC IN</text>
            <text x="115" y="92" textAnchor="middle" className="fill-white text-[8px] font-bold">DC OUT</text>

            {/* Bluetooth icon */}
            <circle cx="110" cy="60" r="8" fill="#0088ff" opacity="0.3" />
            <text x="110" y="63" textAnchor="middle" className="fill-white text-[8px]">B</text>

            {/* Victron branding */}
            <text x="70" y="112" textAnchor="middle" className="fill-foreground text-[8px] opacity-70">victron energy</text>
          </svg>
        );
      }

      case "inverter": {
        const watts = properties.watts || properties.powerRating || 3000;
        const kw = watts >= 1000 ? `${(watts / 1000).toFixed(1)}kW` : `${watts}W`;
        
        return (
          <svg width="160" height="120" viewBox="0 0 160 120">
            {/* Main housing */}
            <rect x="10" y="15" width="140" height="90" fill="#2a2a3a" stroke="#3a3a4a" strokeWidth="2" rx="6" />

            {/* Top panel */}
            <rect x="15" y="20" width="130" height="25" fill="#1a1a2a" rx="3" />
            <text x="80" y="30" textAnchor="middle" className="fill-cyan-400 text-xs font-bold">INVERTER</text>
            <text x="80" y="40" textAnchor="middle" className="fill-white text-[10px]">{kw} Pure Sine</text>

            {/* LED indicators */}
            <circle cx="30" cy="58" r="4" fill="#00ff00" opacity="0.8" />
            <text x="45" y="60" className="fill-gray-400 text-[8px]">ON</text>
            <circle cx="30" cy="72" r="4" fill="#ffaa00" opacity="0.5" />
            <text x="45" y="74" className="fill-gray-400 text-[8px]">FAULT</text>

            {/* DC/AC labels */}
            <rect x="15" y="85" width="50" height="15" fill="#1a1a1a" rx="2" />
            <text x="40" y="95" textAnchor="middle" className="fill-red-400 text-[9px] font-bold">DC IN</text>
            
            <rect x="95" y="85" width="50" height="15" fill="#1a1a1a" rx="2" />
            <text x="120" y="95" textAnchor="middle" className="fill-yellow-400 text-[9px] font-bold">AC OUT</text>

            {/* Power display */}
            <rect x="70" y="52" width="75" height="28" fill="#0a0a1a" rx="3" />
            <text x="107" y="63" textAnchor="middle" className="fill-green-400 text-[10px] font-mono">{watts}W</text>
            <text x="107" y="75" textAnchor="middle" className="fill-gray-400 text-[8px]">RATED</text>

            {/* Label */}
            <text x="80" y="10" textAnchor="middle" className="fill-foreground text-xs font-semibold">{name || 'Inverter'}</text>
          </svg>
        );
      }

      default:
        return (
          <svg width="140" height="100" viewBox="0 0 140 100">
            <rect x="10" y="15" width="120" height="70" fill="hsl(var(--victron-blue))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" rx="8" />
            <text x="70" y="55" textAnchor="middle" className="fill-white text-sm font-semibold">{name || "Component"}</text>
          </svg>
        );
    }
  };

  return (
    <div
      className={`cursor-pointer transition-all pointer-events-auto ${
        selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
      } ${
        validationStatus === "error" 
          ? "ring-2 ring-red-500 ring-offset-2 ring-offset-background animate-pulse" 
          : validationStatus === "warning"
          ? "ring-2 ring-yellow-500 ring-offset-2 ring-offset-background"
          : ""
      }`}
      onClick={onClick}
    >
      <div className="hover-elevate active-elevate-2 rounded-md relative" style={{ background: 'transparent' }}>
        {renderShape()}

        {/* Terminal connection points overlay */}
        {config && (
          <svg
            className="absolute top-0 left-0 pointer-events-none"
            width={config.width}
            height={config.height}
            viewBox={`0 0 ${config.width} ${config.height}`}
            style={{ overflow: 'visible', zIndex: 10 }}
          >
            {config.terminals.map((terminal) => {
              const isHighlighted = highlightedTerminals.includes(terminal.id);
              return (
                <g key={terminal.id}>
                  {/* Terminal connection point */}
                  <circle
                    cx={terminal.x}
                    cy={terminal.y}
                    r={isHighlighted ? 10 : 7}
                    fill={terminal.color}
                    stroke="white"
                    strokeWidth={isHighlighted ? 3 : 2}
                    className="pointer-events-auto cursor-crosshair"
                    style={{ pointerEvents: 'auto' }}
                    opacity={isHighlighted ? 1 : 0.95}
                    onClick={(e) => handleTerminalClick(terminal, e as any)}
                    onPointerDown={(e) => handleTerminalClick(terminal, e as any)}
                    data-testid={`terminal-${type}-${terminal.id}`}
                  />

                  {/* Pulsing ring when highlighted */}
                  {isHighlighted && (
                    <circle
                      cx={terminal.x}
                      cy={terminal.y}
                      r={12}
                      fill="none"
                      stroke={terminal.color}
                      strokeWidth={2}
                      opacity={0.6}
                      className="pointer-events-none"
                    >
                      <animate
                        attributeName="r"
                        values="8;14;8"
                        dur="1.5s"
                        repeatCount="indefinite"
                      />
                      <animate
                        attributeName="opacity"
                        values="0.8;0.2;0.8"
                        dur="1.5s"
                        repeatCount="indefinite"
                      />
                    </circle>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}
