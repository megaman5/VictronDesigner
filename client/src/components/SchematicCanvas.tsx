import { useState, useRef, useEffect } from "react";
import { Grid3X3, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SchematicComponent } from "./SchematicComponent";
import type { SchematicComponent as SchematicComponentType, Wire } from "@shared/schema";
import { Terminal, getTerminalPosition, getTerminalOrientation } from "@/lib/terminal-config";
import { snapPointToGrid, calculateOrthogonalPath, calculateOrthogonalPathWithOrientation, calculateWireLength } from "@/lib/wire-routing";

export interface WireConnectionData {
  fromComponentId: string;
  fromTerminal: Terminal;
  toComponentId: string;
  toTerminal: Terminal;
  length: number;
}

interface SchematicCanvasProps {
  components?: SchematicComponentType[];
  wires?: Wire[];
  onComponentsChange?: (components: SchematicComponentType[]) => void;
  onWiresChange?: (wires: Wire[]) => void;
  onComponentSelect?: (component: SchematicComponentType) => void;
  onWireSelect?: (wire: Wire) => void;
  onDrop?: (x: number, y: number) => void;
  onComponentMove?: (componentId: string, deltaX: number, deltaY: number) => void;
  onComponentDelete?: (componentId: string) => void;
  onWireConnectionComplete?: (wireData: WireConnectionData) => void;
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
  onWireSelect,
  onDrop,
  onComponentMove,
  onComponentDelete,
  onWireConnectionComplete,
  onWireDelete,
  wireConnectionMode = false,
  wireStartComponent = null,
}: SchematicCanvasProps) {
  const [showGrid, setShowGrid] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedWireId, setSelectedWireId] = useState<string | null>(null);
  const [draggedComponentId, setDraggedComponentId] = useState<string | null>(null);
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  
  // Selection box state
  const [selectionBox, setSelectionBox] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
  // Wire connection state with terminal tracking
  const [wireStart, setWireStart] = useState<{
    componentId: string;
    terminal: Terminal;
    position: { x: number; y: number };
  } | null>(null);
  const [wirePreviewEnd, setWirePreviewEnd] = useState<{ x: number; y: number } | null>(null);
  
  const canvasRef = useRef<HTMLDivElement>(null);

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
    setSelectedIds([component.id]); // Clear multi-selection when clicking single component
    setSelectedWireId(null); // Clear wire selection
    
    if (!wireConnectionMode) {
      onComponentSelect?.(component);
    }
  };
  
  const handleTerminalClick = (component: SchematicComponentType, terminal: Terminal, e: React.MouseEvent) => {
    if (!wireConnectionMode) return;
    
    const terminalPos = getTerminalPosition(component.x, component.y, component.type, terminal.id);
    if (!terminalPos) return;
    
    if (!wireStart) {
      // First click - start wire connection
      setWireStart({
        componentId: component.id,
        terminal,
        position: terminalPos,
      });
      setWirePreviewEnd(terminalPos); // Initialize preview at same position
    } else {
      // Second click - complete wire connection
      if (wireStart.componentId !== component.id) {
        // Calculate wire length based on distance
        const wireLength = calculateWireLength(
          wireStart.position.x,
          wireStart.position.y,
          terminalPos.x,
          terminalPos.y
        );
        
        // Pass terminal information back to parent for wire creation
        onWireConnectionComplete?.({
          fromComponentId: wireStart.componentId,
          fromTerminal: wireStart.terminal,
          toComponentId: component.id,
          toTerminal: terminal,
          length: wireLength,
        });
      }
      
      // Reset wire connection state
      setWireStart(null);
      setWirePreviewEnd(null);
    }
  };
  
  // Handle mouse move to show wire preview or update selection box
  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (wireStart && wireConnectionMode && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / (zoom / 100);
      const y = (e.clientY - rect.top) / (zoom / 100);
      
      // Snap to grid for cleaner routing
      const snapped = snapPointToGrid(x, y);
      setWirePreviewEnd(snapped);
    }
    
    // Update selection box if dragging
    if (selectionBox && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / (zoom / 100);
      const y = (e.clientY - rect.top) / (zoom / 100);
      
      setSelectionBox({
        ...selectionBox,
        endX: x,
        endY: y,
      });
    }
  };
  
  // Start selection box on mouse down
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // Don't start selection if clicking on a component or terminal
    const target = e.target as HTMLElement;
    const isComponent = target.closest('[data-testid^="canvas-component-"]');
    const isTerminal = target.closest('.terminal-indicator');
    
    if (!isComponent && !isTerminal && !wireConnectionMode && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / (zoom / 100);
      const y = (e.clientY - rect.top) / (zoom / 100);
      
      setSelectionBox({
        startX: x,
        startY: y,
        endX: x,
        endY: y,
      });
    }
  };
  
  // Complete selection box on mouse up
  const handleCanvasMouseUp = (e: React.MouseEvent) => {
    if (selectionBox) {
      // Check which components intersect with the selection box
      const box = {
        left: Math.min(selectionBox.startX, selectionBox.endX),
        right: Math.max(selectionBox.startX, selectionBox.endX),
        top: Math.min(selectionBox.startY, selectionBox.endY),
        bottom: Math.max(selectionBox.startY, selectionBox.endY),
      };
      
      // Component dimensions for intersection detection
      const componentDimensions: Record<string, { width: number; height: number }> = {
        multiplus: { width: 180, height: 140 },
        battery: { width: 160, height: 110 },
        mppt: { width: 160, height: 130 },
        'solar-panel': { width: 140, height: 120 },
        cerbo: { width: 180, height: 120 },
        bmv: { width: 140, height: 140 },
        smartshunt: { width: 140, height: 140 },
        'ac-load': { width: 120, height: 100 },
        'dc-load': { width: 120, height: 100 },
        'busbar-positive': { width: 140, height: 60 },
        'busbar-negative': { width: 140, height: 60 },
      };
      
      const selected = components.filter(comp => {
        const dims = componentDimensions[comp.type] || { width: 120, height: 100 };
        const compLeft = comp.x;
        const compRight = comp.x + dims.width;
        const compTop = comp.y;
        const compBottom = comp.y + dims.height;
        
        return !(compRight < box.left || 
                 compLeft > box.right || 
                 compBottom < box.top || 
                 compTop > box.bottom);
      });
      
      setSelectedIds(selected.map(c => c.id));
      
      // Also set the first selected component as the primary selection for properties panel
      if (selected.length > 0) {
        setSelectedId(selected[0].id);
        onComponentSelect?.(selected[0]);
      } else {
        setSelectedId(null);
      }
      
      setSelectionBox(null);
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
    const wire = wires.find(w => w.id === wireId);
    if (wire) {
      setSelectedWireId(wireId);
      setSelectedId(null); // Clear component selection
      setSelectedIds([]); // Clear multi-selection
      onWireSelect?.(wire);
      
      // Focus the canvas to enable keyboard events
      canvasRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      // Delete selected wire
      if (selectedWireId) {
        onWireDelete?.(selectedWireId);
        setSelectedWireId(null);
      }
      // Delete all selected components
      else if (selectedIds.length > 0) {
        selectedIds.forEach(id => onComponentDelete?.(id));
        setSelectedIds([]);
        setSelectedId(null);
      }
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
        ref={canvasRef}
        className="flex-1 relative overflow-auto bg-background"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onKeyDown={handleKeyDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseDown={handleCanvasMouseDown}
        onMouseUp={handleCanvasMouseUp}
        tabIndex={0}
        data-testid="canvas-drop-zone"
      >
        <svg
          className="absolute inset-0"
          width="2400"
          height="1600"
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

          {wires.map((wire, wireIndex) => {
            // Get terminal positions instead of component centers
            const fromComp = components.find(c => c.id === wire.fromComponentId);
            const toComp = components.find(c => c.id === wire.toComponentId);
            
            if (!fromComp || !toComp) {
              console.warn('Wire skipped - missing component:', { 
                wireId: wire.id, 
                fromId: wire.fromComponentId, 
                toId: wire.toComponentId,
                foundFrom: !!fromComp,
                foundTo: !!toComp,
                availableComponentIds: components.map(c => c.id)
              });
              return null;
            }
            
            // Try to get terminal positions, fall back to component centers
            let fromPos = getTerminalPosition(fromComp.x, fromComp.y, fromComp.type, wire.fromTerminal);
            let toPos = getTerminalPosition(toComp.x, toComp.y, toComp.type, wire.toTerminal);
            
            // Get terminal orientations
            const fromOrientation = getTerminalOrientation(fromComp.type, wire.fromTerminal);
            const toOrientation = getTerminalOrientation(toComp.type, wire.toTerminal);
            
            // If either terminal position is null, use component centers as fallback
            if (!fromPos) {
              const from = getComponentPosition(wire.fromComponentId);
              fromPos = { x: from.x, y: from.y };
            }
            if (!toPos) {
              const to = getComponentPosition(wire.toComponentId);
              toPos = { x: to.x, y: to.y };
            }
            
            // Calculate wire offset to prevent overlaps
            // Alternate between positive and negative offsets: +1, -1, +2, -2, +3, -3...
            // This spreads wires in both directions for better visual distribution
            const offsetMagnitude = Math.floor(wireIndex / 2) + 1;
            const wireOffset = (wireIndex % 2 === 0) ? offsetMagnitude : -offsetMagnitude;
            
            // Calculate orthogonal path with terminal orientations
            let path: string;
            let labelX: number;
            let labelY: number;
            
            if (fromOrientation && toOrientation) {
              const result = calculateOrthogonalPathWithOrientation(
                fromPos.x, fromPos.y, 
                toPos.x, toPos.y,
                fromOrientation, toOrientation,
                wireOffset, 15
              );
              path = result.path;
              labelX = result.labelX;
              labelY = result.labelY;
            } else {
              // Fallback to old routing if orientations not available
              path = calculateOrthogonalPath(fromPos.x, fromPos.y, toPos.x, toPos.y, 15, wireOffset);
              labelX = (fromPos.x + toPos.x) / 2;
              labelY = (fromPos.y + toPos.y) / 2;
            }
            
            const polaritySymbol = wire.polarity === "positive" ? "+" : wire.polarity === "negative" ? "-" : "~";
            const isSelected = selectedWireId === wire.id;
            
            return (
              <g 
                key={wire.id}
                className="cursor-pointer hover:opacity-80"
                onClick={(e) => handleWireClick(wire.id, e as any)}
                data-testid={`wire-${wire.id}`}
              >
                <path
                  d={path}
                  stroke={isSelected ? "hsl(var(--primary))" : getWireColor(wire.polarity)}
                  strokeWidth={isSelected ? getWireThickness(wire.gauge) + 2 : getWireThickness(wire.gauge)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  opacity={isSelected ? 1 : 0.9}
                  style={{ pointerEvents: 'stroke' }}
                />
                
                <g transform={`translate(${labelX}, ${labelY})`} className="pointer-events-none">
                  <rect
                    x="-35"
                    y="-12"
                    width="70"
                    height="24"
                    fill="hsl(var(--background))"
                    stroke={isSelected ? "hsl(var(--primary))" : "hsl(var(--border))"}
                    strokeWidth={isSelected ? 2 : 1}
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
          
          {/* Selection box when dragging */}
          {selectionBox && (
            <rect
              x={Math.min(selectionBox.startX, selectionBox.endX)}
              y={Math.min(selectionBox.startY, selectionBox.endY)}
              width={Math.abs(selectionBox.endX - selectionBox.startX)}
              height={Math.abs(selectionBox.endY - selectionBox.startY)}
              fill="hsl(var(--primary))"
              fillOpacity={0.1}
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              strokeDasharray="5 5"
              className="pointer-events-none"
              data-testid="selection-box"
            />
          )}
          
          {/* Wire preview when dragging */}
          {wireStart && wirePreviewEnd && (
            <path
              d={calculateOrthogonalPath(
                wireStart.position.x,
                wireStart.position.y,
                wirePreviewEnd.x,
                wirePreviewEnd.y,
                15
              )}
              stroke={wireStart.terminal.color}
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="8 4"
              opacity={0.6}
              fill="none"
              className="pointer-events-none"
              data-testid="wire-preview"
            />
          )}
        </svg>

        <div className="absolute inset-0 p-4 pointer-events-none" style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }}>
          {components.map((component) => {
            // Determine which terminals to highlight
            const highlightedTerminals: string[] = [];
            if (wireStart && wireStart.componentId === component.id) {
              highlightedTerminals.push(wireStart.terminal.id);
            }
            
            return (
              <div
                key={component.id}
                draggable
                onDragStart={(e) => handleComponentDragStart(component, e)}
                className={`absolute cursor-move pointer-events-none ${
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
                  selected={selectedIds.includes(component.id)}
                  onClick={(e) => handleComponentClick(component, e)}
                  onTerminalClick={(terminal, e) => handleTerminalClick(component, terminal, e)}
                  highlightedTerminals={highlightedTerminals}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
