import { useState } from "react";
import { Grid3X3, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SchematicComponent } from "./SchematicComponent";

interface CanvasComponent {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
}

interface Wire {
  id: string;
  from: string;
  to: string;
  gauge: string;
  current: number;
  polarity: "positive" | "negative" | "ac";
}

interface SchematicCanvasProps {
  onComponentSelect?: (component: CanvasComponent) => void;
  onDrop?: (x: number, y: number) => void;
}

export function SchematicCanvas({ onComponentSelect, onDrop }: SchematicCanvasProps) {
  const [showGrid, setShowGrid] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [components, setComponents] = useState<CanvasComponent[]>([
    { id: "1", name: "MultiPlus 1200VA", type: "multiplus", x: 150, y: 100 },
    { id: "2", name: "Battery Bank 400Ah", type: "battery", x: 150, y: 300 },
    { id: "3", name: "MPPT 100/30", type: "mppt", x: 450, y: 100 },
    { id: "4", name: "Solar Array", type: "solar-panel", x: 480, y: 250 },
    { id: "5", name: "Cerbo GX", type: "cerbo", x: 700, y: 100 },
    { id: "6", name: "BMV-712", type: "bmv", x: 350, y: 300 },
  ]);

  const [wires] = useState<Wire[]>([
    { id: "w1", from: "1", to: "2", gauge: "4/0 AWG", current: 100, polarity: "positive" },
    { id: "w2", from: "2", to: "1", gauge: "4/0 AWG", current: 100, polarity: "negative" },
    { id: "w3", from: "3", to: "2", gauge: "6 AWG", current: 30, polarity: "positive" },
    { id: "w4", from: "2", to: "3", gauge: "6 AWG", current: 30, polarity: "negative" },
    { id: "w5", from: "4", to: "3", gauge: "10 AWG", current: 30, polarity: "positive" },
  ]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    console.log("Component dropped at:", x, y);
    onDrop?.(x, y);
  };

  const handleComponentClick = (component: CanvasComponent) => {
    setSelectedId(component.id);
    onComponentSelect?.(component);
    console.log("Component selected:", component.name);
  };

  const getComponentPosition = (id: string) => {
    const comp = components.find((c) => c.id === id);
    if (!comp) return { x: 0, y: 0 };
    
    const widths: Record<string, number> = {
      multiplus: 160,
      battery: 140,
      mppt: 160,
      'solar-panel': 110,
      cerbo: 160,
      bmv: 120,
    };
    
    const heights: Record<string, number> = {
      multiplus: 100,
      battery: 90,
      mppt: 110,
      'solar-panel': 110,
      cerbo: 100,
      bmv: 110,
    };
    
    return { 
      x: comp.x + (widths[comp.type] || 100) / 2, 
      y: comp.y + (heights[comp.type] || 80) / 2 
    };
  };

  const getWireColor = (polarity: string) => {
    switch (polarity) {
      case "positive":
        return "hsl(var(--wire-positive))";
      case "negative":
        return "hsl(var(--wire-negative))";
      case "ac":
        return "hsl(var(--wire-ac-hot))";
      default:
        return "hsl(var(--primary))";
    }
  };

  const getWireThickness = (gauge: string) => {
    const awgMatch = gauge.match(/(\d+(?:\/\d+)?)\s*AWG/);
    if (!awgMatch) return 3;
    
    const awgValue = awgMatch[1];
    if (awgValue.includes("/")) {
      return 12;
    }
    
    const awgNum = parseInt(awgValue);
    if (awgNum <= 4) return 10;
    if (awgNum <= 6) return 8;
    if (awgNum <= 8) return 6;
    if (awgNum <= 10) return 5;
    if (awgNum <= 12) return 4;
    return 3;
  };

  return (
    <div className="flex-1 flex flex-col bg-background">
      <div className="border-b bg-card px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowGrid(!showGrid)}
            data-testid="button-toggle-grid"
            className="gap-2"
          >
            <Grid3X3 className="h-4 w-4" />
            {showGrid ? "Hide" : "Show"} Grid
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setZoom(Math.max(50, zoom - 10))}
            data-testid="button-zoom-out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-sm font-mono w-16 text-center">{zoom}%</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setZoom(Math.min(200, zoom + 10))}
            data-testid="button-zoom-in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div
        className="flex-1 relative overflow-auto"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        data-testid="canvas-area"
      >
        <div
          className={`absolute inset-0 min-w-[1200px] min-h-[800px]`}
          style={{
            backgroundImage: showGrid
              ? "linear-gradient(hsl(var(--border)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border)) 1px, transparent 1px)"
              : "none",
            backgroundSize: "20px 20px",
          }}
        >
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            {wires.map((wire) => {
              const from = getComponentPosition(wire.from);
              const to = getComponentPosition(wire.to);
              const midY = (from.y + to.y) / 2;
              const wireColor = getWireColor(wire.polarity);
              const wireThickness = getWireThickness(wire.gauge);
              const offsetX = wire.polarity === "negative" ? 8 : -8;
              
              return (
                <g key={wire.id}>
                  <path
                    d={`M ${from.x + offsetX} ${from.y} L ${from.x + offsetX} ${midY} L ${to.x + offsetX} ${midY} L ${to.x + offsetX} ${to.y}`}
                    stroke={wireColor}
                    strokeWidth={wireThickness}
                    fill="none"
                    className="hover:opacity-80"
                  />
                  <rect
                    x={(from.x + to.x) / 2 - 35 + offsetX}
                    y={midY - 14}
                    width="70"
                    height="28"
                    fill="hsl(var(--card))"
                    stroke="hsl(var(--border))"
                    rx="4"
                  />
                  <text
                    x={(from.x + to.x) / 2 + offsetX}
                    y={midY - 3}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="text-xs font-mono fill-foreground font-medium"
                    fontSize="11"
                  >
                    {wire.gauge}
                  </text>
                  <text
                    x={(from.x + to.x) / 2 + offsetX}
                    y={midY + 8}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="text-[9px] font-mono fill-muted-foreground"
                    fontSize="9"
                  >
                    {wire.current}A {wire.polarity === "positive" ? "+" : "-"}
                  </text>
                </g>
              );
            })}
          </svg>

          {components.map((component) => (
            <div
              key={component.id}
              className="absolute"
              style={{
                left: component.x,
                top: component.y,
                transform: `scale(${zoom / 100})`,
                transformOrigin: "top left",
              }}
              data-testid={`canvas-component-${component.id}`}
            >
              <SchematicComponent
                type={component.type}
                name={component.name}
                selected={selectedId === component.id}
                onClick={() => handleComponentClick(component)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
