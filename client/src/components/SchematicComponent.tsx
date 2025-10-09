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
          <svg width="160" height="100" viewBox="0 0 160 100">
            <rect x="10" y="15" width="140" height="70" fill="hsl(var(--victron-blue))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" rx="6" />
            <rect x="2" y="30" width="12" height="10" fill="hsl(var(--background))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" />
            <rect x="2" y="60" width="12" height="10" fill="hsl(var(--background))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" />
            <rect x="146" y="30" width="12" height="10" fill="hsl(var(--background))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" />
            <rect x="146" y="60" width="12" height="10" fill="hsl(var(--background))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" />
            <text x="80" y="35" textAnchor="middle" className="fill-white text-sm font-semibold">MultiPlus</text>
            <text x="80" y="52" textAnchor="middle" className="fill-white text-xs">Inverter/Charger</text>
            <text x="80" y="72" textAnchor="middle" className="fill-white text-[10px] opacity-80">victron energy</text>
            <text x="20" y="38" className="fill-white text-[9px]">AC</text>
            <text x="20" y="68" className="fill-white text-[9px]">DC</text>
          </svg>
        );
      
      case "mppt":
        return (
          <svg width="160" height="110" viewBox="0 0 160 110">
            <rect x="20" y="15" width="120" height="80" fill="hsl(var(--victron-blue))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" rx="6" />
            <path d="M 40 35 L 50 45 L 60 35 L 70 45 L 80 35 L 90 45 L 100 35 L 110 45 L 120 35" stroke="white" strokeWidth="2" fill="none" opacity="0.8" />
            <rect x="135" y="30" width="12" height="10" fill="hsl(var(--background))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" />
            <rect x="13" y="50" width="12" height="10" fill="hsl(var(--background))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" />
            <text x="80" y="65" textAnchor="middle" className="fill-white text-sm font-semibold">SmartSolar</text>
            <text x="80" y="80" textAnchor="middle" className="fill-white text-xs">MPPT</text>
            <text x="80" y="92" textAnchor="middle" className="fill-white text-[10px] opacity-80">victron energy</text>
            <text x="30" y="58" className="fill-white text-[9px]">PV</text>
            <text x="125" y="38" className="fill-white text-[9px]">Batt</text>
          </svg>
        );
      
      case "cerbo":
        return (
          <svg width="160" height="100" viewBox="0 0 160 100">
            <rect x="20" y="15" width="120" height="70" fill="hsl(var(--victron-blue))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" rx="6" />
            <rect x="30" y="28" width="100" height="20" fill="hsl(var(--victron-blue-light)/0.3)" stroke="white" strokeWidth="1" rx="3" />
            <rect x="135" y="35" width="12" height="8" fill="hsl(var(--background))" stroke="hsl(var(--victron-blue-light))" strokeWidth="1" />
            <rect x="135" y="50" width="12" height="8" fill="hsl(var(--background))" stroke="hsl(var(--victron-blue-light))" strokeWidth="1" />
            <rect x="135" y="65" width="12" height="8" fill="hsl(var(--background))" stroke="hsl(var(--victron-blue-light))" strokeWidth="1" />
            <text x="80" y="42" textAnchor="middle" className="fill-white text-sm font-bold">CERBO GX</text>
            <text x="80" y="65" textAnchor="middle" className="fill-white text-xs opacity-90">System Monitor</text>
            <text x="80" y="78" textAnchor="middle" className="fill-white text-[10px] opacity-80">victron energy</text>
          </svg>
        );
      
      case "bmv":
        return (
          <svg width="120" height="110" viewBox="0 0 120 110">
            <rect x="15" y="20" width="90" height="70" fill="hsl(var(--victron-blue))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" rx="6" />
            <circle cx="60" cy="50" r="18" fill="none" stroke="white" strokeWidth="2" />
            <path d="M 60 35 L 60 50 L 70 55" stroke="white" strokeWidth="2" fill="none" />
            <rect x="100" y="45" width="12" height="8" fill="hsl(var(--background))" stroke="hsl(var(--victron-blue-light))" strokeWidth="1" />
            <text x="60" y="78" textAnchor="middle" className="fill-white text-sm font-semibold">BMV-712</text>
            <text x="60" y="95" textAnchor="middle" className="fill-white text-[10px] opacity-80">victron energy</text>
          </svg>
        );
      
      case "battery":
        return (
          <svg width="140" height="90" viewBox="0 0 140 90">
            <rect x="25" y="30" width="90" height="45" fill="hsl(var(--victron-blue))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" rx="4" />
            <rect x="115" y="42" width="12" height="21" fill="hsl(var(--victron-blue))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" />
            <line x1="45" y1="52" x2="65" y2="52" stroke="white" strokeWidth="3" />
            <line x1="55" y1="42" x2="55" y2="62" stroke="white" strokeWidth="3" />
            <line x1="80" y1="52" x2="95" y2="52" stroke="white" strokeWidth="3" />
            <text x="70" y="20" textAnchor="middle" className="fill-foreground text-sm font-semibold">Battery Bank</text>
            <circle cx="18" cy="52" r="5" fill="hsl(var(--wire-negative))" stroke="hsl(var(--foreground))" strokeWidth="1" />
            <circle cx="127" cy="52" r="5" fill="hsl(var(--wire-positive))" stroke="hsl(var(--foreground))" strokeWidth="1" />
            <text x="18" y="72" textAnchor="middle" className="fill-foreground text-[10px] font-semibold">NEG</text>
            <text x="127" y="72" textAnchor="middle" className="fill-foreground text-[10px] font-semibold">POS</text>
          </svg>
        );
      
      case "solar-panel":
        return (
          <svg width="110" height="110" viewBox="0 0 110 110">
            <rect x="15" y="25" width="80" height="55" fill="hsl(var(--victron-blue)/0.2)" stroke="hsl(var(--victron-blue))" strokeWidth="2" />
            <line x1="15" y1="52" x2="95" y2="52" stroke="hsl(var(--victron-blue))" strokeWidth="1" />
            <line x1="55" y1="25" x2="55" y2="80" stroke="hsl(var(--victron-blue))" strokeWidth="1" />
            <path d="M 30 15 L 35 25 M 55 12 L 55 25 M 80 15 L 75 25" stroke="hsl(var(--primary))" strokeWidth="2" />
            <text x="55" y="98" textAnchor="middle" className="fill-foreground text-sm font-semibold">Solar Panel</text>
            <circle cx="55" y="85" r="4" fill="hsl(var(--victron-blue))" />
          </svg>
        );
      
      case "ac-load":
        return (
          <svg width="110" height="90" viewBox="0 0 110 90">
            <circle cx="55" cy="40" r="22" fill="hsl(var(--background))" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <path d="M 42 40 L 48 28 L 52 40 L 58 28 L 62 40 L 68 28" stroke="hsl(var(--foreground))" strokeWidth="2" fill="none" />
            <rect x="2" y="36" width="12" height="8" fill="hsl(var(--background))" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <text x="55" y="72" textAnchor="middle" className="fill-foreground text-sm font-semibold">AC Load</text>
            <circle cx="55" y="80" r="4" fill="hsl(var(--wire-ac-hot))" />
          </svg>
        );
      
      case "dc-load":
        return (
          <svg width="110" height="90" viewBox="0 0 110 90">
            <circle cx="55" cy="40" r="22" fill="hsl(var(--background))" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <line x1="42" y1="40" x2="68" y2="40" stroke="hsl(var(--foreground))" strokeWidth="3" />
            <rect x="2" y="36" width="12" height="8" fill="hsl(var(--background))" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <text x="55" y="72" textAnchor="middle" className="fill-foreground text-sm font-semibold">DC Load</text>
            <circle cx="55" cy="80" r="4" fill="hsl(var(--foreground))" />
          </svg>
        );
      
      default:
        return (
          <svg width="120" height="90" viewBox="0 0 120 90">
            <rect x="10" y="15" width="100" height="60" fill="hsl(var(--victron-blue))" stroke="hsl(var(--victron-blue-light))" strokeWidth="2" rx="6" />
            <text x="60" y="50" textAnchor="middle" className="fill-white text-sm font-semibold">Component</text>
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
