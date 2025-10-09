import { useState } from "react";
import { Grid3X3, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SchematicComponent } from "./SchematicComponent";
import type { SchematicComponent as SchematicComponentType, Wire } from "@shared/schema";

interface SchematicCanvasProps {
  components?: SchematicComponentType[];
  wires?: Wire[];
  onComponentsChange?: (components: SchematicComponentType[]) => void;
  onWiresChange?: (wires: Wire[]) => void;
  onComponentSelect?: (component: SchematicComponentType) => void;
  onDrop?: (x: number, y: number) => void;
}

export function SchematicCanvas({ 
  components = [], 
  wires = [],
  onComponentsChange,
  onWiresChange,
  onComponentSelect, 
  onDrop 
}: SchematicCanvasProps) {
  const [showGrid, setShowGrid] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const handleComponentClick = (component: SchematicComponentType) => {
    setSelectedId(component.id);
    onComponentSelect?.(component);
    console.log("Component selected:", component.name);
  };

  const getComponentPosition = (id: string) => {
    const comp = components.find((c) => c.id === id);
    if (!comp) return { x: 0, y: 0 };
    
    const widths: Record<string, number> = {
      multiplus: 180,
      battery: 160,
      mppt: 160,
      'solar-panel': 140,
      cerbo: 180,
      bmv: 140,
      'ac-load': 120,
      'dc-load': 120,
    };
    
    const heights: Record<string, number> = {
      multiplus: 140,
      battery: 110,
      mppt: 130,
      'solar-panel': 120,
      cerbo: 120,
      bmv: 140,
      'ac-load': 100,
      'dc-load': 100,
    };
    
    return { 
      x: comp.x + (widths[comp.type] || 120) / 2, 
      y: comp.y + (heights[comp.type] || 100) / 2 
    };
  };

  const getWireColor = (polarity: string) => {
    switch (polarity) {
      case "positive":
        return "hsl(var(--wire-positive))";
      case "negative":
        return "hsl(var(--wire-negative))";
      case "neutral":
      case "ac":
        return "hsl(var(--wire-ac-hot))";
      case "ground":
        return "hsl(var(--wire-ac-ground))";
      default:
        return "hsl(var(--primary))";
    }
  };

  const getWireThickness = (gauge: string | undefined) => {
    if (!gauge) return 3;
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
      <div className="border-b p-2 flex items-center gap-2 bg-background">
        <Button
          variant={showGrid ? "default" : "outline"}
          size="sm"
          onClick={() => setShowGrid(!showGrid)}
          data-testid="button-toggle-grid"
        >
          <Grid3X3 className="h-4 w-4" />
        </Button>
        
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZoom(Math.max(25, zoom - 25))}
            disabled={zoom <= 25}
            data-testid="button-zoom-out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-16 text-center" data-testid="text-zoom-level">
            {zoom}%
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZoom(Math.min(200, zoom + 25))}
            disabled={zoom >= 200}
            data-testid="button-zoom-in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div 
        className="flex-1 relative overflow-auto bg-background"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        data-testid="canvas-drop-zone"
      >
        <svg
          className="absolute inset-0 w-full h-full"
          style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }}
        >
          {showGrid && (
            <defs>
              <pattern
                id="grid"
                width="20"
                height="20"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 20 0 L 0 0 0 20"
                  fill="none"
                  stroke="hsl(var(--border))"
                  strokeWidth="0.5"
                  opacity="0.3"
                />
              </pattern>
            </defs>
          )}
          
          {showGrid && <rect width="100%" height="100%" fill="url(#grid)" />}

          {wires.map((wire) => {
            const from = getComponentPosition(wire.fromComponentId);
            const to = getComponentPosition(wire.toComponentId);
            const midX = (from.x + to.x) / 2;
            const midY = (from.y + to.y) / 2;
            const polaritySymbol = wire.polarity === "positive" ? "+" : wire.polarity === "negative" ? "-" : "~";
            
            return (
              <g key={wire.id}>
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={getWireColor(wire.polarity)}
                  strokeWidth={getWireThickness(wire.gauge)}
                  strokeLinecap="round"
                />
                
                <g transform={`translate(${midX}, ${midY})`}>
                  <rect
                    x="-35"
                    y="-12"
                    width="70"
                    height="24"
                    fill="hsl(var(--background))"
                    stroke="hsl(var(--border))"
                    strokeWidth="1"
                    rx="4"
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-foreground text-xs font-semibold"
                  >
                    {polaritySymbol} {wire.gauge || "N/A"}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>

        <div className="absolute inset-0 p-4" style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }}>
          {components.map((component) => (
            <div
              key={component.id}
              className="absolute cursor-move"
              style={{ 
                left: component.x, 
                top: component.y,
              }}
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
