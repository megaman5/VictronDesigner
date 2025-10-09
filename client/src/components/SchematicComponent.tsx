interface SchematicComponentProps {
  type: string;
  name: string;
  selected?: boolean;
  onClick?: () => void;
}

export function SchematicComponent({ type, name, selected, onClick }: SchematicComponentProps) {
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
      
      case "mppt":
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
            <text x="110" y="58" textAnchor="middle" className="fill-cyan-300 text-[10px] font-mono">30A</text>
            
            {/* Product label */}
            <text x="80" y="85" textAnchor="middle" className="fill-white text-xs font-bold">SmartSolar</text>
            <text x="80" y="98" textAnchor="middle" className="fill-white text-[10px]">MPPT 100|30</text>
            
            {/* Connection terminals */}
            <circle cx="30" cy="108" r="4" fill="hsl(var(--background))" stroke="white" strokeWidth="1" />
            <circle cx="50" cy="108" r="4" fill="hsl(var(--background))" stroke="white" strokeWidth="1" />
            <circle cx="110" cy="108" r="4" fill="hsl(var(--background))" stroke="white" strokeWidth="1" />
            <circle cx="130" cy="108" r="4" fill="hsl(var(--background))" stroke="white" strokeWidth="1" />
            
            <text x="40" y="122" textAnchor="middle" className="fill-white text-[8px]">PV</text>
            <text x="120" y="122" textAnchor="middle" className="fill-white text-[8px]">BATT</text>
          </svg>
        );
      
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
      
      case "battery":
        return (
          <svg width="160" height="110" viewBox="0 0 160 110">
            {/* Battery casing - gray/black */}
            <rect x="20" y="25" width="120" height="70" fill="#1a1a2e" stroke="#2a2a3e" strokeWidth="2" rx="6" />
            
            {/* Terminal posts */}
            <rect x="140" y="48" width="12" height="24" fill="#1a1a2e" stroke="#2a2a3e" strokeWidth="2" />
            
            {/* Battery label */}
            <text x="80" y="15" textAnchor="middle" className="fill-foreground text-sm font-bold">Battery Bank</text>
            <text x="80" y="48" textAnchor="middle" className="fill-gray-400 text-xs">AGM Deep Cycle</text>
            <text x="80" y="63" textAnchor="middle" className="fill-gray-300 text-sm font-bold">12V 200Ah</text>
            <text x="80" y="78" textAnchor="middle" className="fill-gray-400 text-[10px]">2400Wh</text>
            
            {/* Warning symbols */}
            <path d="M 30 85 L 35 75 L 40 85 Z" fill="orange" stroke="orange" strokeWidth="1" />
            <text x="32" y="83" className="fill-black text-[8px] font-bold">!</text>
            
            {/* Terminal indicators */}
            <circle cx="10" cy="60" r="6" fill="hsl(var(--wire-negative))" stroke="hsl(var(--foreground))" strokeWidth="1" />
            <text x="10" y="63" textAnchor="middle" className="fill-white text-xs font-bold">−</text>
            
            <circle cx="150" cy="60" r="6" fill="hsl(var(--wire-positive))" stroke="hsl(var(--foreground))" strokeWidth="1" />
            <text x="150" y="63" textAnchor="middle" className="fill-white text-xs font-bold">+</text>
          </svg>
        );
      
      case "solar-panel":
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
            
            {/* Label */}
            <text x="70" y="13" textAnchor="middle" className="fill-foreground text-xs font-semibold">Solar Panel</text>
            <text x="70" y="107" textAnchor="middle" className="fill-foreground text-[10px]">300W Monocrystalline</text>
            
            {/* Junction box */}
            <rect x="60" y="95" width="20" height="10" fill="#2a2a2a" stroke="#3a3a3a" strokeWidth="1" />
            
            {/* Gradient definition */}
            <defs>
              <linearGradient id="solarGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: 'white', stopOpacity: 0.8 }} />
                <stop offset="100%" style={{ stopColor: 'white', stopOpacity: 0 }} />
              </linearGradient>
            </defs>
          </svg>
        );
      
      case "ac-load":
        return (
          <svg width="120" height="100" viewBox="0 0 120 100">
            {/* Generic AC appliance icon */}
            <rect x="20" y="25" width="80" height="55" fill="#3a3a3a" stroke="#4a4a4a" strokeWidth="2" rx="6" />
            
            {/* Power symbol */}
            <circle cx="60" cy="52" r="18" fill="none" stroke="white" strokeWidth="3" />
            <line x1="60" y1="40" x2="60" y2="60" stroke="white" strokeWidth="3" />
            
            {/* Connection */}
            <rect x="10" y="48" width="15" height="8" fill="hsl(var(--background))" stroke="hsl(var(--foreground))" strokeWidth="2" />
            
            <text x="60" y="17" textAnchor="middle" className="fill-foreground text-xs font-semibold">AC Load</text>
            <text x="60" y="93" textAnchor="middle" className="fill-foreground text-[10px]">230V AC Appliances</text>
          </svg>
        );
      
      case "dc-load":
        return (
          <svg width="120" height="100" viewBox="0 0 120 100">
            {/* Generic DC device */}
            <rect x="20" y="25" width="80" height="55" fill="#2a2a3a" stroke="#3a3a4a" strokeWidth="2" rx="6" />
            
            {/* DC symbol */}
            <line x1="45" y1="52" x2="75" y2="52" stroke="white" strokeWidth="3" />
            <line x1="45" y1="45" x2="45" y2="59" stroke="white" strokeWidth="2" />
            <line x1="75" y1="45" x2="75" y2="59" stroke="white" strokeWidth="2" />
            
            {/* Connection */}
            <rect x="10" y="48" width="15" height="8" fill="hsl(var(--background))" stroke="hsl(var(--foreground))" strokeWidth="2" />
            
            <text x="60" y="17" textAnchor="middle" className="fill-foreground text-xs font-semibold">DC Load</text>
            <text x="60" y="93" textAnchor="middle" className="fill-foreground text-[10px]">12V DC Devices</text>
          </svg>
        );
      
      default:
        return (
          <svg width="140" height="100" viewBox="0 0 140 100">
            <rect x="10" y="15" width="120" height="70" fill="hsl(var(--victron-blue))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" rx="8" />
            <text x="70" y="55" textAnchor="middle" className="fill-white text-sm font-semibold">Component</text>
          </svg>
        );
    }
  };

  return (
    <div
      className={`cursor-pointer transition-all ${
        selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
      }`}
      onClick={onClick}
    >
      <div className="hover-elevate active-elevate-2 rounded-md">
        {renderShape()}
        <div className="text-xs font-medium text-center mt-1 px-2 truncate">
          {name}
        </div>
      </div>
    </div>
  );
}
