import { useState } from "react";
import { Grid3X3, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface CanvasComponent {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  icon: string;
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
    { id: "1", name: "MultiPlus 1200", type: "multiplus", x: 200, y: 150, icon: "⚡" },
    { id: "2", name: "Battery Bank", type: "battery", x: 200, y: 350, icon: "🔋" },
    { id: "3", name: "MPPT 100/30", type: "mppt", x: 500, y: 150, icon: "☀️" },
  ]);

  const [wires] = useState<Wire[]>([
    { id: "w1", from: "1", to: "2", gauge: "4 AWG", current: 100 },
    { id: "w2", from: "3", to: "2", gauge: "6 AWG", current: 30 },
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
    return comp ? { x: comp.x, y: comp.y } : { x: 0, y: 0 };
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
          className={`absolute inset-0 ${showGrid ? "bg-grid-pattern" : ""}`}
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
              return (
                <g key={wire.id}>
                  <path
                    d={`M ${from.x + 60} ${from.y + 30} L ${from.x + 60} ${(from.y + to.y) / 2} L ${to.x + 60} ${(from.y + to.y) / 2} L ${to.x + 60} ${to.y + 30}`}
                    stroke="hsl(var(--primary))"
                    strokeWidth="3"
                    fill="none"
                    className="hover:stroke-primary/80"
                  />
                  <circle
                    cx={(from.x + to.x) / 2 + 60}
                    cy={(from.y + to.y) / 2}
                    r="20"
                    fill="hsl(var(--card))"
                    stroke="hsl(var(--border))"
                  />
                  <text
                    x={(from.x + to.x) / 2 + 60}
                    y={(from.y + to.y) / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="text-xs font-mono fill-foreground"
                    fontSize="11"
                  >
                    {wire.gauge}
                  </text>
                </g>
              );
            })}
          </svg>

          {components.map((component) => (
            <div
              key={component.id}
              className={`absolute cursor-pointer transition-all ${
                selectedId === component.id ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
              }`}
              style={{
                left: component.x,
                top: component.y,
                transform: `scale(${zoom / 100})`,
                transformOrigin: "top left",
              }}
              onClick={() => handleComponentClick(component)}
              data-testid={`canvas-component-${component.id}`}
            >
              <div className="bg-card border border-card-border rounded-md p-4 w-32 hover-elevate active-elevate-2">
                <div className="text-3xl text-center mb-2">{component.icon}</div>
                <div className="text-xs font-medium text-center truncate">
                  {component.name}
                </div>
                <div className="flex gap-1 mt-2">
                  <div className="w-2 h-2 rounded-full bg-chart-2" />
                  <div className="w-2 h-2 rounded-full bg-destructive" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
