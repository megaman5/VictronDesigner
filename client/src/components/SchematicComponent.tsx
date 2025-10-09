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
          <svg width="140" height="80" viewBox="0 0 140 80">
            <rect x="10" y="10" width="120" height="60" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <rect x="5" y="25" width="10" height="8" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <rect x="5" y="47" width="10" height="8" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <rect x="125" y="25" width="10" height="8" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <rect x="125" y="47" width="10" height="8" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <text x="70" y="30" textAnchor="middle" className="fill-foreground text-xs font-medium">MultiPlus</text>
            <text x="70" y="45" textAnchor="middle" className="fill-foreground text-xs">Inverter/Charger</text>
            <text x="20" y="32" className="fill-foreground text-[10px]">AC</text>
            <text x="20" y="54" className="fill-foreground text-[10px]">DC</text>
            <circle cx="20" cy="65" r="3" fill="hsl(var(--chart-2))" />
            <circle cx="30" cy="65" r="3" fill="hsl(var(--destructive))" />
          </svg>
        );
      
      case "mppt":
        return (
          <svg width="140" height="100" viewBox="0 0 140 100">
            <rect x="20" y="10" width="100" height="70" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <path d="M 40 30 L 50 40 L 60 30 L 70 40 L 80 30 L 90 40 L 100 30" stroke="hsl(var(--primary))" strokeWidth="2" fill="none" />
            <rect x="115" y="25" width="10" height="8" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <rect x="15" y="45" width="10" height="8" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <text x="70" y="60" textAnchor="middle" className="fill-foreground text-xs font-medium">MPPT</text>
            <text x="70" y="73" textAnchor="middle" className="fill-foreground text-[10px]">Solar Controller</text>
            <text x="30" y="52" className="fill-foreground text-[10px]">PV</text>
            <text x="105" y="32" className="fill-foreground text-[10px]">Batt</text>
            <circle cx="35" cy="85" r="3" fill="hsl(var(--chart-2))" />
          </svg>
        );
      
      case "cerbo":
        return (
          <svg width="140" height="90" viewBox="0 0 140 90">
            <rect x="20" y="15" width="100" height="60" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <rect x="25" y="25" width="90" height="15" fill="hsl(var(--primary)/0.2)" stroke="hsl(var(--primary))" strokeWidth="1" />
            <rect x="115" y="30" width="10" height="6" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="1" />
            <rect x="115" y="45" width="10" height="6" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="1" />
            <rect x="115" y="60" width="10" height="6" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="1" />
            <text x="70" y="37" textAnchor="middle" className="fill-primary text-xs font-semibold">CERBO GX</text>
            <text x="70" y="58" textAnchor="middle" className="fill-foreground text-[10px]">System Monitor</text>
            <circle cx="30" cy="80" r="3" fill="hsl(var(--chart-2))" />
          </svg>
        );
      
      case "bmv":
        return (
          <svg width="100" height="100" viewBox="0 0 100 100">
            <rect x="10" y="20" width="80" height="60" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="2" rx="4" />
            <circle cx="50" cy="45" r="15" fill="none" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <path d="M 50 30 L 50 45 L 60 50" stroke="hsl(var(--foreground))" strokeWidth="2" fill="none" />
            <rect x="85" y="40" width="10" height="6" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="1" />
            <text x="50" y="72" textAnchor="middle" className="fill-foreground text-xs font-medium">BMV-712</text>
            <circle cx="25" cy="85" r="3" fill="hsl(var(--chart-2))" />
          </svg>
        );
      
      case "battery":
        return (
          <svg width="120" height="80" viewBox="0 0 120 80">
            <rect x="20" y="25" width="80" height="40" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <rect x="100" y="35" width="10" height="20" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <line x1="35" y1="45" x2="55" y2="45" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <line x1="45" y1="35" x2="45" y2="55" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <line x1="70" y1="45" x2="85" y2="45" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <text x="60" y="15" textAnchor="middle" className="fill-foreground text-xs font-medium">Battery Bank</text>
            <circle cx="15" cy="45" r="4" fill="hsl(var(--destructive))" />
            <circle cx="110" cy="45" r="4" fill="hsl(var(--chart-2))" />
            <text x="15" y="62" textAnchor="middle" className="fill-destructive text-[10px]">-</text>
            <text x="110" y="62" textAnchor="middle" className="fill-chart-2 text-[10px]">+</text>
          </svg>
        );
      
      case "solar-panel":
        return (
          <svg width="100" height="100" viewBox="0 0 100 100">
            <rect x="15" y="20" width="70" height="50" fill="hsl(var(--primary)/0.1)" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <line x1="15" y1="45" x2="85" y2="45" stroke="hsl(var(--foreground))" strokeWidth="1" />
            <line x1="50" y1="20" x2="50" y2="70" stroke="hsl(var(--foreground))" strokeWidth="1" />
            <path d="M 30 10 L 35 20 M 50 10 L 50 20 M 70 10 L 65 20" stroke="hsl(var(--primary))" strokeWidth="2" />
            <text x="50" y="85" textAnchor="middle" className="fill-foreground text-xs font-medium">Solar Panel</text>
            <circle cx="50" cy="75" r="3" fill="hsl(var(--primary))" />
          </svg>
        );
      
      case "ac-load":
        return (
          <svg width="100" height="80" viewBox="0 0 100 80">
            <circle cx="50" cy="35" r="20" fill="none" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <path d="M 40 35 L 45 25 L 50 35 L 55 25 L 60 35" stroke="hsl(var(--foreground))" strokeWidth="2" fill="none" />
            <rect x="5" y="32" width="10" height="6" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="1" />
            <text x="50" y="65" textAnchor="middle" className="fill-foreground text-xs font-medium">AC Load</text>
            <circle cx="50" cy="70" r="3" fill="hsl(var(--chart-3))" />
          </svg>
        );
      
      case "dc-load":
        return (
          <svg width="100" height="80" viewBox="0 0 100 80">
            <circle cx="50" cy="35" r="20" fill="none" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <line x1="40" y1="35" x2="60" y2="35" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <rect x="5" y="32" width="10" height="6" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="1" />
            <text x="50" y="65" textAnchor="middle" className="fill-foreground text-xs font-medium">DC Load</text>
            <circle cx="50" cy="70" r="3" fill="hsl(var(--chart-3))" />
          </svg>
        );
      
      default:
        return (
          <svg width="100" height="80" viewBox="0 0 100 80">
            <rect x="10" y="10" width="80" height="50" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <text x="50" y="40" textAnchor="middle" className="fill-foreground text-xs">Component</text>
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
