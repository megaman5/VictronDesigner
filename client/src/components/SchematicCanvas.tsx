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
    { id: "w1", from: "1", to: "2", gauge: "4 AWG", current: 100 },
    { id: "w2", from: "3", to: "2", gauge: "6 AWG", current: 30 },
    { id: "w3", from: "4", to: "3", gauge: "10 AWG", current: 30 },
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
      multiplus: 140,
      battery: 120,
      mppt: 140,
      'solar-panel': 100,
      cerbo: 140,
      bmv: 100,
    };
    
    const heights: Record<string, number> = {
      multiplus: 80,
      battery: 80,
      mppt: 100,
      'solar-panel': 100,
      cerbo: 90,
      bmv: 100,
    };
    
    return { 
      x: comp.x + (widths[comp.type] || 100) / 2, 
      y: comp.y + (heights[comp.type] || 80) / 2 
    };
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
              return (
                <g key={wire.id}>
                  <path
                    d={`M ${from.x} ${from.y} L ${from.x} ${midY} L ${to.x} ${midY} L ${to.x} ${to.y}`}
                    stroke="hsl(var(--primary))"
                    strokeWidth="2"
                    fill="none"
                    className="hover:stroke-primary/80"
                  />
                  <rect
                    x={(from.x + to.x) / 2 - 30}
                    y={midY - 12}
                    width="60"
                    height="24"
                    fill="hsl(var(--card))"
                    stroke="hsl(var(--border))"
                    rx="4"
                  />
                  <text
                    x={(from.x + to.x) / 2}
                    y={midY}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="text-xs font-mono fill-foreground font-medium"
                    fontSize="11"
                  >
                    {wire.gauge}
                  </text>
                  <text
                    x={(from.x + to.x) / 2}
                    y={midY + 10}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="text-[9px] font-mono fill-muted-foreground"
                    fontSize="9"
                  >
                    {wire.current}A
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
