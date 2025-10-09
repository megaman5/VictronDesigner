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
  onComponentMove?: (componentId: string, deltaX: number, deltaY: number) => void;
  onComponentDelete?: (componentId: string) => void;
  onWireConnectionClick?: (componentId: string) => void;
  onWireDelete?: (wireId: string) => void;
  wireConnectionMode?: boolean;
  wireStartComponent?: string | null;
}

export function SchematicCanvas({ 
  components = [], 
  wires = [],
  onComponentsChange,
  onWiresChange,
  onComponentSelect, 
  onDrop,
  onComponentMove,
  onComponentDelete,
  onWireConnectionClick,
  onWireDelete,
  wireConnectionMode = false,
  wireStartComponent = null,
}: SchematicCanvasProps) {
  const [showGrid, setShowGrid] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggedComponentId, setDraggedComponentId] = useState<string | null>(null);
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const dropX = (e.clientX - rect.left) / (zoom / 100);
    const dropY = (e.clientY - rect.top) / (zoom / 100);
    
    if (draggedComponentId) {
      // Component being repositioned - account for cursor offset
      const newX = dropX - dragOffset.x;
      const newY = dropY - dragOffset.y;
      const deltaX = newX - dragStartPos.x;
      const deltaY = newY - dragStartPos.y;
      onComponentMove?.(draggedComponentId, deltaX, deltaY);
      setDraggedComponentId(null);
    } else {
      // New component from library
      onDrop?.(dropX, dropY);
    }
  };

  const handleComponentClick = (component: SchematicComponentType, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedId(component.id);
    
    if (wireConnectionMode) {
      onWireConnectionClick?.(component.id);
    } else {
      onComponentSelect?.(component);
    }
  };

  const handleComponentDragStart = (component: SchematicComponentType, e: React.DragEvent) => {
    e.stopPropagation();
    setDraggedComponentId(component.id);
    setDragStartPos({ x: component.x, y: component.y });
    
    // Calculate where on the component the user grabbed it
    // rect is already in screen coordinates (scaled), so we need to convert back to canvas coordinates
    const rect = e.currentTarget.getBoundingClientRect();
    const canvasEl = (e.currentTarget.parentElement?.parentElement as HTMLElement);
    const canvasRect = canvasEl?.getBoundingClientRect();
    
    if (canvasRect) {
      // Get the grab point relative to canvas in screen coordinates
      const screenOffsetX = e.clientX - canvasRect.left;
      const screenOffsetY = e.clientY - canvasRect.top;
      
      // Convert to canvas coordinates (unscaled)
      const canvasOffsetX = screenOffsetX / (zoom / 100);
      const canvasOffsetY = screenOffsetY / (zoom / 100);
      
      // Calculate offset from component's top-left
      setDragOffset({ 
        x: canvasOffsetX - component.x, 
        y: canvasOffsetY - component.y 
      });
    }
  };

  const handleWireClick = (wireId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("Delete this wire?")) {
      onWireDelete?.(wireId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
      onComponentDelete?.(selectedId);
    }
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
        onKeyDown={handleKeyDown}
        tabIndex={0}
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
              <g 
                key={wire.id}
                className="cursor-pointer hover:opacity-80"
                onClick={(e) => handleWireClick(wire.id, e as any)}
                data-testid={`wire-${wire.id}`}
              >
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
              draggable
              onDragStart={(e) => handleComponentDragStart(component, e)}
              className={`absolute cursor-move ${
                wireStartComponent === component.id ? 'ring-4 ring-primary' : ''
              }`}
              style={{ 
                left: component.x, 
                top: component.y,
              }}
              data-testid={`canvas-component-${component.id}`}
            >
              <SchematicComponent
                type={component.type}
                name={component.name}
                selected={selectedId === component.id}
                onClick={(e) => handleComponentClick(component, e)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
