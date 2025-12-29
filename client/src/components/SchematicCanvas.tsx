import { useState, useRef, useMemo } from "react";
import { Grid3X3, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SchematicComponent } from "./SchematicComponent";
import type { SchematicComponent as SchematicComponentType, Wire } from "@shared/schema";
import { Terminal, getTerminalPosition, getTerminalOrientation, findClosestTerminal, TERMINAL_CONFIGS } from "@/lib/terminal-config";
import { snapPointToGrid, calculateRoute, type Obstacle } from "@/lib/wire-routing";
import { getDefaultWireLength } from "@/lib/wire-length-defaults";

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
  wireValidationStatus?: Map<string, "error" | "warning">;
  componentValidationStatus?: Map<string, "error" | "warning">;
  onComponentsChange?: (components: SchematicComponentType[]) => void;
  onWiresChange?: (wires: Wire[]) => void;
  onComponentSelect?: (component: SchematicComponentType) => void;
  onWireSelect?: (wire: Wire) => void;
  onDrop?: (x: number, y: number) => void;
  onComponentMove?: (componentId: string, deltaX: number, deltaY: number) => void;
  onComponentDelete?: (componentId: string) => void;
  onWireConnectionComplete?: (wireData: WireConnectionData) => void;
  onWireDelete?: (wireId: string) => void;
  onWireUpdate?: (wireId: string, updates: Partial<Wire>) => void;
  onWireEdit?: (wire: Wire) => void;
  wireConnectionMode?: boolean;
  wireStartComponent?: string | null;
  showWireLabels?: boolean;
  onCopy?: (componentIds: string[]) => void;
  onPaste?: () => void;
}

export function SchematicCanvas({
  components = [],
  wires = [],
  wireValidationStatus,
  componentValidationStatus,
  onComponentsChange,
  onWiresChange,
  onComponentSelect,
  onWireSelect,
  onDrop,
  onComponentMove,
  onComponentDelete,
  onWireConnectionComplete,
  onWireDelete,
  onWireUpdate,
  onWireEdit,
  wireConnectionMode = false,
  wireStartComponent = null,
  showWireLabels = true,
  onCopy,
  onPaste,
}: SchematicCanvasProps) {
  const [showGrid, setShowGrid] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedWireId, setSelectedWireId] = useState<string | null>(null);
  const [draggedComponentId, setDraggedComponentId] = useState<string | null>(null);
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragPreviewPos, setDragPreviewPos] = useState<{ x: number; y: number } | null>(null);
  
  // Multi-drag state - stores initial positions of all selected components during drag
  const [draggedComponentPositions, setDraggedComponentPositions] = useState<Map<string, { x: number; y: number }>>(new Map());

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

  // Wire endpoint dragging state
  const [draggedWireEndpoint, setDraggedWireEndpoint] = useState<{
    wireId: string;
    endpoint: 'from' | 'to';
    wire: Wire;
  } | null>(null);
  const [draggedEndpointPos, setDraggedEndpointPos] = useState<{ x: number; y: number } | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);

  // Calculate minimum canvas size based on component positions
  // This creates a canvas that's always at least as big as the content
  const canvasBounds = useMemo(() => {
    let maxX = 0;
    let maxY = 0;

    components.forEach(comp => {
      const config = TERMINAL_CONFIGS[comp.type];
      if (config) {
        const compRight = comp.x + config.width + 100;
        const compBottom = comp.y + config.height + 100;
        if (compRight > maxX) maxX = compRight;
        if (compBottom > maxY) maxY = compBottom;
      }
    });

    return { maxX, maxY };
  }, [components]);

  // Calculate terminal usage for distributing wires
  const terminalUsage = useMemo(() => {
    const usage = new Map<string, string[]>(); // Key: "compId-termId", Value: [wireId, wireId...]

    wires.forEach(wire => {
      const fromKey = `${wire.fromComponentId}-${wire.fromTerminal}`;
      const toKey = `${wire.toComponentId}-${wire.toTerminal}`;

      if (!usage.has(fromKey)) usage.set(fromKey, []);
      if (!usage.has(toKey)) usage.set(toKey, []);

      usage.get(fromKey)!.push(wire.id);
      usage.get(toKey)!.push(wire.id);
    });

    return usage;
  }, [wires]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();

    // Update preview position during drag
    if (draggedComponentId) {
      const scrollContainer = document.querySelector('[data-testid="canvas-drop-zone"]');
      if (!scrollContainer) return;

      const rect = scrollContainer.getBoundingClientRect();
      const scrollLeft = scrollContainer.scrollLeft;
      const scrollTop = scrollContainer.scrollTop;

      const x = (e.clientX - rect.left + scrollLeft) / (zoom / 100);
      const y = (e.clientY - rect.top + scrollTop) / (zoom / 100);

      setDragPreviewPos({ x: x - dragOffset.x, y: y - dragOffset.y });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();

    // Robustly get the scroll container
    const scrollContainer = document.querySelector('[data-testid="canvas-drop-zone"]');
    if (!scrollContainer) return;

    const rect = scrollContainer.getBoundingClientRect();
    const scrollLeft = scrollContainer.scrollLeft;
    const scrollTop = scrollContainer.scrollTop;

    const dropX = (e.clientX - rect.left + scrollLeft) / (zoom / 100);
    const dropY = (e.clientY - rect.top + scrollTop) / (zoom / 100);

    if (draggedComponentId) {
      // Component being repositioned - account for cursor offset
      const newX = dropX - dragOffset.x;
      const newY = dropY - dragOffset.y;
      const deltaX = newX - dragStartPos.x;
      const deltaY = newY - dragStartPos.y;

      // If the dragged component is part of a selection, move all selected components
      if (selectedIds.includes(draggedComponentId)) {
        selectedIds.forEach(id => {
          onComponentMove?.(id, deltaX, deltaY);
        });
      } else {
        // Just move the single component
        onComponentMove?.(draggedComponentId, deltaX, deltaY);
      }

      setDraggedComponentId(null);
      setDragPreviewPos(null);
      setDraggedComponentPositions(new Map());
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
        // Get default wire length based on component types
        const fromComp = components.find(c => c.id === wireStart.componentId);
        const toComp = components.find(c => c.id === component.id);
        const wireLength = getDefaultWireLength(
          fromComp,
          toComp,
          wireStart.terminal.id,
          terminal.id
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
    if (!canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const scrollLeft = canvasRef.current.scrollLeft;
    const scrollTop = canvasRef.current.scrollTop;
    const x = (e.clientX - rect.left + scrollLeft) / (zoom / 100);
    const y = (e.clientY - rect.top + scrollTop) / (zoom / 100);

    // Handle wire endpoint dragging
    if (draggedWireEndpoint) {
      const snapped = snapPointToGrid(x, y);
      setDraggedEndpointPos(snapped);
      return;
    }

    // Handle wire connection preview
    if (wireStart && wireConnectionMode) {
      const snapped = snapPointToGrid(x, y);
      setWirePreviewEnd(snapped);
    }

    // Update selection box if dragging
    if (selectionBox) {
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
      const scrollLeft = canvasRef.current.scrollLeft;
      const scrollTop = canvasRef.current.scrollTop;
      const x = (e.clientX - rect.left + scrollLeft) / (zoom / 100);
      const y = (e.clientY - rect.top + scrollTop) / (zoom / 100);

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
    // Handle wire endpoint drop
    if (draggedWireEndpoint && draggedEndpointPos && canvasRef.current) {
      const { wireId, endpoint, wire } = draggedWireEndpoint;

      // Find closest terminal to drop position
      let closestTerminal: Terminal | null = null;
      let closestComponent: SchematicComponentType | null = null;
      let closestDistance = 50; // Maximum snap distance in pixels

      components.forEach(comp => {
        const terminal = findClosestTerminal(
          comp.x,
          comp.y,
          comp.type,
          draggedEndpointPos.x,
          draggedEndpointPos.y,
          closestDistance
        );

        if (terminal) {
          const termX = comp.x + terminal.x;
          const termY = comp.y + terminal.y;
          const distance = Math.sqrt(
            (draggedEndpointPos.x - termX) ** 2 + (draggedEndpointPos.y - termY) ** 2
          );

          if (distance < closestDistance) {
            closestDistance = distance;
            closestTerminal = terminal;
            closestComponent = comp;
          }
        }
      });

      // Update wire if we found a valid terminal
      if (closestTerminal && closestComponent) {
        const updates: Partial<Wire> = {};

        if (endpoint === 'from') {
          updates.fromComponentId = closestComponent.id;
          updates.fromTerminal = closestTerminal.id;
        } else {
          updates.toComponentId = closestComponent.id;
          updates.toTerminal = closestTerminal.id;
        }

        // Recalculate wire length based on new positions
        const fromComp = endpoint === 'from' ? closestComponent : components.find(c => c.id === wire.fromComponentId);
        const toComp = endpoint === 'to' ? closestComponent : components.find(c => c.id === wire.toComponentId);

        if (fromComp && toComp) {
          const fromTerm = endpoint === 'from' ? closestTerminal : TERMINAL_CONFIGS[fromComp.type]?.terminals.find(t => t.id === wire.fromTerminal);
          const toTerm = endpoint === 'to' ? closestTerminal : TERMINAL_CONFIGS[toComp.type]?.terminals.find(t => t.id === wire.toTerminal);

          if (fromTerm && toTerm) {
            // Use default wire length based on component types
            const newLength = getDefaultWireLength(
              fromComp,
              toComp,
              fromTerm.id,
              toTerm.id
            );
            updates.length = newLength;
          }
        }

        onWireUpdate?.(wireId, updates);
      }

      // Clear dragging state
      setDraggedWireEndpoint(null);
      setDraggedEndpointPos(null);
      return;
    }

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
        fuse: { width: 80, height: 60 },
        switch: { width: 80, height: 80 },
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
    // Don't allow component dragging if we're dragging a wire endpoint
    if (draggedWireEndpoint) {
      e.preventDefault();
      return;
    }

    e.stopPropagation();
    setDraggedComponentId(component.id);
    setDragStartPos({ x: component.x, y: component.y });

    // Store initial positions of all selected components for multi-drag
    // If the dragged component is in selection, drag all selected; otherwise just drag this one
    const componentsToDrag = selectedIds.includes(component.id) ? selectedIds : [component.id];
    const positionsMap = new Map<string, { x: number; y: number }>();
    componentsToDrag.forEach(id => {
      const comp = components.find(c => c.id === id);
      if (comp) {
        positionsMap.set(id, { x: comp.x, y: comp.y });
      }
    });
    setDraggedComponentPositions(positionsMap);

    // Calculate where on the component the user grabbed it
    // rect is already in screen coordinates (scaled), so we need to convert back to canvas coordinates
    const rect = e.currentTarget.getBoundingClientRect();
    const canvasEl = (e.currentTarget.parentElement?.parentElement as HTMLElement);
    const canvasRect = canvasEl?.getBoundingClientRect();

    if (canvasRect) {
      // Get the grab point relative to canvas in screen coordinates, accounting for scroll
      const screenOffsetX = e.clientX - canvasRect.left + canvasEl.scrollLeft;
      const screenOffsetY = e.clientY - canvasRect.top + canvasEl.scrollTop;

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

  const handleWireEndpointMouseDown = (wireId: string, endpoint: 'from' | 'to', e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault(); // Prevent component drag from being triggered
    const wire = wires.find(w => w.id === wireId);
    if (!wire) return;

    setDraggedWireEndpoint({ wireId, endpoint, wire });

    // Get current endpoint position
    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const scrollLeft = canvasRef.current.scrollLeft;
      const scrollTop = canvasRef.current.scrollTop;
      const x = (e.clientX - rect.left + scrollLeft) / (zoom / 100);
      const y = (e.clientY - rect.top + scrollTop) / (zoom / 100);
      setDraggedEndpointPos({ x, y });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Copy (Ctrl+C or Cmd+C)
    if ((e.ctrlKey || e.metaKey) && e.key === "c") {
      if (selectedIds.length > 0) {
        e.preventDefault();
        onCopy?.(selectedIds);
      }
      return;
    }
    
    // Paste (Ctrl+V or Cmd+V)
    if ((e.ctrlKey || e.metaKey) && e.key === "v") {
      e.preventDefault();
      onPaste?.();
      return;
    }
    
    // Delete
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
      fuse: 80,
      switch: 80,
      'breaker-panel': 160,
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
      fuse: 60,
      switch: 80,
    };

    return {
      x: comp.x + (widths[comp.type] || 120) / 2,
      y: comp.y + (heights[comp.type] || 100) / 2
    };
  };

  const getWireColor = (polarity: string) => {
    switch (polarity) {
      case "positive":
        return "hsl(var(--wire-positive))"; // Red
      case "negative":
        return "hsl(var(--wire-negative))"; // Black
      case "neutral":
        return "hsl(var(--wire-neutral))"; // White/Grey
      case "ac":
      case "ac-hot":
        return "hsl(var(--wire-ac-hot))"; // Black/Orange (distinct from DC negative)
      case "ground":
        return "hsl(var(--wire-ac-ground))"; // Green
      default:
        return "hsl(var(--primary))";
    }
  };

  const getWireGlowColor = (wireId: string): string | null => {
    // Check validation status and return glow color
    const validationStatus = wireValidationStatus?.get(wireId);

    if (validationStatus === "error") {
      return "hsl(0 84% 60%)"; // Bright red glow for errors
    } else if (validationStatus === "warning") {
      return "hsl(38 92% 50%)"; // Orange glow for warnings
    }

    return null; // No glow for valid wires
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
        className="flex-1 relative bg-background overflow-auto"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onKeyDown={handleKeyDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseDown={handleCanvasMouseDown}
        onMouseUp={handleCanvasMouseUp}
        tabIndex={0}
        data-testid="canvas-drop-zone"
      >
        {/* Inner div to handle scrolling - size based on content */}
        <div 
          style={{ 
            width: canvasBounds.maxX > 0 ? Math.max(canvasBounds.maxX, 100) : '100%',
            height: canvasBounds.maxY > 0 ? Math.max(canvasBounds.maxY, 100) : '100%',
            minWidth: '100%',
            minHeight: '100%',
            position: 'relative'
          }}
        >
          <svg
            width="100%"
            height="100%"
            style={{ 
              position: 'absolute',
              top: 0,
              left: 0,
              transform: `scale(${zoom / 100})`, 
              transformOrigin: 'top left'
            }}
          >
          <defs>
            {showGrid && (
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
            )}
            {/* Glow filter for validation warnings/errors */}
            <filter id="wire-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {showGrid && <rect width="100%" height="100%" fill="url(#grid)" />}

          {(() => {
            // Build obstacles from all components
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
              fuse: { width: 80, height: 60 },
              switch: { width: 80, height: 80 },
              'ac-panel': { width: 180, height: 220 },
              'dc-panel': { width: 160, height: 240 },
              'shore-power': { width: 140, height: 100 },
              'transfer-switch': { width: 180, height: 140 },
            };

            const obstacles: Obstacle[] = components.map(comp => {
              const dims = componentDimensions[comp.type] || { width: 120, height: 100 };
              return {
                x: comp.x,
                y: comp.y,
                width: dims.width,
                height: dims.height
              };
            });

            // Track occupied nodes for wire separation
            const occupiedNodes = new Set<string>();

            // First pass: calculate all wire routes and store label positions
            interface WireRouteData {
              wire: Wire;
              path: string;
              labelX: number;
              labelY: number;
              labelRotation: number;
              pathPoints: Array<{ x: number; y: number }>;
            }

            const wireRoutes: WireRouteData[] = [];

            wires.forEach((wire) => {
              const fromComp = components.find(c => c.id === wire.fromComponentId);
              const toComp = components.find(c => c.id === wire.toComponentId);

              if (!fromComp || !toComp) return;

              const fromCompX = (draggedComponentId === fromComp.id && dragPreviewPos) ? dragPreviewPos.x : fromComp.x;
              const fromCompY = (draggedComponentId === fromComp.id && dragPreviewPos) ? dragPreviewPos.y : fromComp.y;
              const toCompX = (draggedComponentId === toComp.id && dragPreviewPos) ? dragPreviewPos.x : toComp.x;
              const toCompY = (draggedComponentId === toComp.id && dragPreviewPos) ? dragPreviewPos.y : toComp.y;

              let fromPos = getTerminalPosition(fromCompX, fromCompY, fromComp.type, wire.fromTerminal);
              let toPos = getTerminalPosition(toCompX, toCompY, toComp.type, wire.toTerminal);

              if (!fromPos) {
                if (draggedComponentId === fromComp.id && dragPreviewPos) {
                  const config = TERMINAL_CONFIGS[fromComp.type];
                  const centerX = dragPreviewPos.x + (config?.width || 120) / 2;
                  const centerY = dragPreviewPos.y + (config?.height || 100) / 2;
                  fromPos = { x: centerX, y: centerY };
                } else {
                  const from = getComponentPosition(wire.fromComponentId);
                  fromPos = { x: from.x, y: from.y };
                }
              }
              if (!toPos) {
                if (draggedComponentId === toComp.id && dragPreviewPos) {
                  const config = TERMINAL_CONFIGS[toComp.type];
                  const centerX = dragPreviewPos.x + (config?.width || 120) / 2;
                  const centerY = dragPreviewPos.y + (config?.height || 100) / 2;
                  toPos = { x: centerX, y: centerY };
                } else {
                  const to = getComponentPosition(wire.toComponentId);
                  toPos = { x: to.x, y: to.y };
                }
              }

              if (draggedWireEndpoint?.wireId === wire.id && draggedEndpointPos) {
                if (draggedWireEndpoint.endpoint === 'from') {
                  fromPos = { ...draggedEndpointPos };
                } else {
                  toPos = { ...draggedEndpointPos };
                }
              }

              const fromOrientation = getTerminalOrientation(fromComp.type, wire.fromTerminal);
              const toOrientation = getTerminalOrientation(toComp.type, wire.toTerminal);

              const fromKey = `${wire.fromComponentId}-${wire.fromTerminal}`;
              const toKey = `${wire.toComponentId}-${wire.toTerminal}`;
              const fromWires = terminalUsage.get(fromKey) || [];
              const toWires = terminalUsage.get(toKey) || [];
              const fromIndex = fromWires.indexOf(wire.id);
              const toIndex = toWires.indexOf(wire.id);

              const getOffset = (index: number, count: number) => {
                if (count <= 1) return 0;
                return (index - (count - 1) / 2) * 10;
              };

              if (fromPos && fromOrientation) {
                const offset = getOffset(fromIndex, fromWires.length);
                if (fromOrientation === 'left' || fromOrientation === 'right') {
                  fromPos.y += offset;
                } else {
                  fromPos.x += offset;
                }
              }

              if (toPos && toOrientation) {
                const offset = getOffset(toIndex, toWires.length);
                if (toOrientation === 'left' || toOrientation === 'right') {
                  toPos.y += offset;
                } else {
                  toPos.x += offset;
                }
              }

              const extendDistance = 10;
              let extendedFromPos = { ...fromPos };
              let extendedToPos = { ...toPos };
              
              if (fromOrientation) {
                if (fromOrientation === 'left') extendedFromPos.x += extendDistance;
                else if (fromOrientation === 'right') extendedFromPos.x -= extendDistance;
                else if (fromOrientation === 'top') extendedFromPos.y += extendDistance;
                else if (fromOrientation === 'bottom') extendedFromPos.y -= extendDistance;
              }
              
              if (toOrientation) {
                if (toOrientation === 'left') extendedToPos.x += extendDistance;
                else if (toOrientation === 'right') extendedToPos.x -= extendDistance;
                else if (toOrientation === 'top') extendedToPos.y += extendDistance;
                else if (toOrientation === 'bottom') extendedToPos.y -= extendDistance;
              }

              const result = calculateRoute(
                extendedFromPos.x, extendedFromPos.y,
                extendedToPos.x, extendedToPos.y,
                obstacles,
                2400,
                1600,
                occupiedNodes,
                fromOrientation || undefined,
                toOrientation || undefined
              );

              result.pathNodes.forEach(node => occupiedNodes.add(node));

              wireRoutes.push({
                wire,
                path: result.path,
                labelX: result.labelX,
                labelY: result.labelY,
                labelRotation: result.labelRotation,
                pathPoints: result.pathPoints || [],
              });
            });

            // Detect and resolve label overlaps
            const LABEL_WIDTH = 90; // Max label width
            const LABEL_HEIGHT = 24;
            const SEGMENT_PADDING = 6;
            const LABEL_EDGE_PADDING = 10;
            const LABEL_ALONG_OFFSETS = [0, 40, -40, 80, -80, 120, -120];
            const LABEL_PERPENDICULAR_OFFSETS = [0, 18, -18, 30, -30, 42, -42];

            type LabelBounds = { minX: number; maxX: number; minY: number; maxY: number };

            const getLabelBounds = (x: number, y: number, rotation: number): LabelBounds => {
              const w = LABEL_WIDTH / 2;
              const h = LABEL_HEIGHT / 2;
              const rad = (rotation * Math.PI) / 180;
              const cos = Math.cos(rad);
              const sin = Math.sin(rad);
              
              // Rotate corners around center
              const corners = [
                { x: -w, y: -h },
                { x: w, y: -h },
                { x: w, y: h },
                { x: -w, y: h },
              ].map(c => ({
                x: x + c.x * cos - c.y * sin,
                y: y + c.x * sin + c.y * cos,
              }));

              const xs = corners.map(c => c.x);
              const ys = corners.map(c => c.y);
              return {
                minX: Math.min(...xs),
                maxX: Math.max(...xs),
                minY: Math.min(...ys),
                maxY: Math.max(...ys),
              };
            };

            const boundsOverlap = (a: LabelBounds, b: LabelBounds): boolean => {
              return !(
                a.maxX < b.minX ||
                a.minX > b.maxX ||
                a.maxY < b.minY ||
                a.minY > b.maxY
              );
            };

            function labelsOverlap(
              x1: number, y1: number, rot1: number,
              x2: number, y2: number, rot2: number
            ): boolean {
              const bounds1 = getLabelBounds(x1, y1, rot1);
              const bounds2 = getLabelBounds(x2, y2, rot2);
              return boundsOverlap(bounds1, bounds2);
            }

            type SegmentBounds = {
              minX: number;
              maxX: number;
              minY: number;
              maxY: number;
              routeIndex: number;
              segmentIndex: number;
            };

            const segmentBounds: SegmentBounds[] = [];

            wireRoutes.forEach((route, routeIndex) => {
              const { pathPoints } = route;
              for (let i = 1; i < pathPoints.length; i++) {
                const p1 = pathPoints[i - 1];
                const p2 = pathPoints[i];
                const minX = Math.min(p1.x, p2.x) - SEGMENT_PADDING;
                const maxX = Math.max(p1.x, p2.x) + SEGMENT_PADDING;
                const minY = Math.min(p1.y, p2.y) - SEGMENT_PADDING;
                const maxY = Math.max(p1.y, p2.y) + SEGMENT_PADDING;
                segmentBounds.push({
                  minX,
                  maxX,
                  minY,
                  maxY,
                  routeIndex,
                  segmentIndex: i - 1,
                });
              }
            });

            const labelCollidesWithSegments = (
              x: number,
              y: number,
              rotation: number,
              routeIndex: number
            ): boolean => {
              const bounds = getLabelBounds(x, y, rotation);
              return segmentBounds.some(segment => {
                if (segment.routeIndex === routeIndex) {
                  return false;
                }
                return boundsOverlap(bounds, segment);
              });
            };

            // Check if a label position overlaps with any other label
            function overlapsWithAny(
              x: number, y: number, rot: number,
              excludeIndex: number,
              routes: WireRouteData[]
            ): boolean {
              for (let i = 0; i < routes.length; i++) {
                if (i === excludeIndex) continue;
                if (labelsOverlap(x, y, rot, routes[i].labelX, routes[i].labelY, routes[i].labelRotation)) {
                  return true;
                }
              }
              return false;
            }

            const labelPositionIsClear = (
              x: number,
              y: number,
              rotation: number,
              routeIndex: number,
              routes: WireRouteData[]
            ): boolean => {
              if (overlapsWithAny(x, y, rotation, routeIndex, routes)) {
                return false;
              }
              return !labelCollidesWithSegments(x, y, rotation, routeIndex);
            };

            const placeLabelForRoute = (
              routeIndex: number,
              route: WireRouteData,
              routes: WireRouteData[]
            ): { x: number; y: number; rotation: number } | null => {
              const { pathPoints } = route;
              if (pathPoints.length < 2) return null;

              const segments = pathPoints.slice(1).map((point, index) => {
                const start = pathPoints[index];
                const end = point;
                const dx = end.x - start.x;
                const dy = end.y - start.y;
                const length = Math.hypot(dx, dy);
                const isHorizontal = Math.abs(dx) >= Math.abs(dy);
                return {
                  start,
                  end,
                  dx,
                  dy,
                  length,
                  isHorizontal,
                  segmentIndex: index,
                };
              }).sort((a, b) => b.length - a.length);

              for (const segment of segments) {
                if (segment.length < 20) continue;

                const rotation = segment.isHorizontal ? 0 : 90;
                // Labels are aligned with the segment (0° for horizontal, 90° for vertical),
                // so the span *along* the segment direction is always LABEL_WIDTH.
                // (On vertical segments, 90° rotation makes the label's vertical extent = LABEL_WIDTH.)
                const labelSpan = LABEL_WIDTH;
                const available = Math.max(0, (segment.length - labelSpan - LABEL_EDGE_PADDING) / 2);

                for (const alongOffset of LABEL_ALONG_OFFSETS) {
                  if (Math.abs(alongOffset) > available) continue;

                  const midX = (segment.start.x + segment.end.x) / 2;
                  const midY = (segment.start.y + segment.end.y) / 2;
                  const alongRatio = segment.length === 0 ? 0 : alongOffset / segment.length;
                  const baseX = midX + segment.dx * alongRatio;
                  const baseY = midY + segment.dy * alongRatio;

                  for (const perpOffset of LABEL_PERPENDICULAR_OFFSETS) {
                    const x = segment.isHorizontal ? baseX : baseX + perpOffset;
                    const y = segment.isHorizontal ? baseY + perpOffset : baseY;

                    if (labelPositionIsClear(x, y, rotation, routeIndex, routes)) {
                      return { x, y, rotation };
                    }
                  }
                }
              }

              return null;
            };

            wireRoutes.forEach((route, index) => {
              const placement = placeLabelForRoute(index, route, wireRoutes);
              if (placement) {
                route.labelX = placement.x;
                route.labelY = placement.y;
                route.labelRotation = placement.rotation;
              }
            });

            // Adjust overlapping labels by sliding them along their paths
            // Use multiple passes to handle cascading overlaps
            const MAX_PASSES = 5;
            for (let pass = 0; pass < MAX_PASSES; pass++) {
              let anyOverlaps = false;
              
              for (let i = 0; i < wireRoutes.length; i++) {
                // Check if this label overlaps with any other label
                if (overlapsWithAny(
                  wireRoutes[i].labelX,
                  wireRoutes[i].labelY,
                  wireRoutes[i].labelRotation,
                  i,
                  wireRoutes
                )) {
                  anyOverlaps = true;
                  
                  // Try to adjust this label's position along its path
                  if (wireRoutes[i].pathPoints.length >= 2) {
                    const adjusted = adjustLabelPosition(
                      wireRoutes[i].pathPoints,
                      wireRoutes[i].labelRotation,
                      i,
                      wireRoutes
                    );
                    if (adjusted) {
                      wireRoutes[i].labelX = adjusted.x;
                      wireRoutes[i].labelY = adjusted.y;
                      wireRoutes[i].labelRotation = adjusted.rotation;
                    }
                  }
                }
              }
              
              // If no overlaps found, we're done
              if (!anyOverlaps) break;
            }

            // Helper function to find a non-overlapping position along a path
            function adjustLabelPosition(
              pathPoints: Array<{ x: number; y: number }>,
              currentRotation: number,
              routeIndex: number,
              allRoutes: WireRouteData[]
            ): { x: number; y: number; rotation: number } | null {
              if (pathPoints.length < 2) return null;

              // Calculate path midpoint distance
              let totalPathLength = 0;
              for (let i = 1; i < pathPoints.length; i++) {
                totalPathLength += Math.hypot(
                  pathPoints[i].x - pathPoints[i - 1].x,
                  pathPoints[i].y - pathPoints[i - 1].y
                );
              }
              
              const midpointIndex = Math.floor(pathPoints.length / 2);
              let midpointDistance = 0;
              for (let k = 1; k <= midpointIndex; k++) {
                if (k < pathPoints.length) {
                  midpointDistance += Math.hypot(
                    pathPoints[k].x - pathPoints[k - 1].x,
                    pathPoints[k].y - pathPoints[k - 1].y
                  );
                }
              }

              // Try positions at different distances along the path
              const stepSize = 30; // Try every 30px along the path
              const maxOffset = Math.min(150, totalPathLength * 0.3); // Max 30% of path length or 150px

              for (let offset = stepSize; offset <= maxOffset; offset += stepSize) {
                // Try both directions
                for (const direction of [-1, 1]) {
                  const targetDistance = midpointDistance + (offset * direction);
                  
                  // Find position along path at targetDistance
                  let accumulatedDistance = 0;
                  
                  for (let i = 1; i < pathPoints.length; i++) {
                    const p1 = pathPoints[i - 1];
                    const p2 = pathPoints[i];
                    const segLength = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                    const segStart = accumulatedDistance;
                    const segEnd = accumulatedDistance + segLength;

                    if (targetDistance >= segStart && targetDistance <= segEnd) {
                      const t = (targetDistance - segStart) / segLength;
                      const x = p1.x + (p2.x - p1.x) * t;
                      const y = p1.y + (p2.y - p1.y) * t;
                      
                      // Determine rotation based on segment direction
                      let rotation = 0;
                      if (Math.abs(p2.x - p1.x) > Math.abs(p2.y - p1.y)) {
                        rotation = 0; // Horizontal
                      } else {
                        rotation = 90; // Vertical
                      }

                      // Check if this position doesn't overlap with any other label
                      if (labelPositionIsClear(x, y, rotation, routeIndex, allRoutes)) {
                        return { x, y, rotation };
                      }
                    }

                    accumulatedDistance = segEnd;
                  }
                }
              }

              // If we can't find a non-overlapping position, try staggering labels vertically/horizontally
              // This is a fallback to ensure labels remain visible even when paths are very close
              // Get the current label position from allRoutes
              const currentRoute = allRoutes[routeIndex];
              const originalX = currentRoute.labelX;
              const originalY = currentRoute.labelY;
              const originalRot = currentRoute.labelRotation;
              if (pathPoints.length >= 2) {
                // Try offsetting perpendicular to the wire direction
                const p1 = pathPoints[0];
                const p2 = pathPoints[1];
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const isHorizontal = Math.abs(dx) > Math.abs(dy);
                
                // Offset perpendicular to wire direction
                const offset = 35; // Offset by label height + spacing
                if (isHorizontal) {
                  // Wire is horizontal, offset vertically
                  const newY = originalY + offset;
                  if (labelPositionIsClear(originalX, newY, originalRot, routeIndex, allRoutes)) {
                    return { x: originalX, y: newY, rotation: originalRot };
                  }
                  const newY2 = originalY - offset;
                  if (labelPositionIsClear(originalX, newY2, originalRot, routeIndex, allRoutes)) {
                    return { x: originalX, y: newY2, rotation: originalRot };
                  }
                } else {
                  // Wire is vertical, offset horizontally
                  const newX = originalX + offset;
                  if (labelPositionIsClear(newX, originalY, originalRot, routeIndex, allRoutes)) {
                    return { x: newX, y: originalY, rotation: originalRot };
                  }
                  const newX2 = originalX - offset;
                  if (labelPositionIsClear(newX2, originalY, originalRot, routeIndex, allRoutes)) {
                    return { x: newX2, y: originalY, rotation: originalRot };
                  }
                }
              }
              
              // Last resort: keep original position (label will be visible even if overlapping)
              return null;
            }

            return wireRoutes.map((routeData) => {
              const wire = routeData.wire;
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

              const path = routeData.path;
              const labelX = routeData.labelX;
              const labelY = routeData.labelY;
              const labelRotation = routeData.labelRotation;

              const polaritySymbol = wire.polarity === "positive" ? "+" : wire.polarity === "negative" ? "-" : "~";
              const isSelected = selectedWireId === wire.id;
              const glowColor = getWireGlowColor(wire.id);

              return (
                <g
                  key={wire.id}
                  className="cursor-pointer hover:opacity-80"
                  onClick={(e) => handleWireClick(wire.id, e)}
                  data-testid={`wire-${wire.id}`}
                >
                  <path
                    d={path}
                    stroke="transparent"
                    strokeWidth={20}
                    fill="none"
                    style={{ pointerEvents: 'stroke' }}
                  />
                  {/* Glow layer for validation warnings/errors */}
                  {glowColor && (
                    <path
                      d={path}
                      stroke={glowColor}
                      strokeWidth={getWireThickness(wire.gauge) + 8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                      opacity={0.6}
                      filter="url(#wire-glow)"
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                  {/* Main wire path with correct polarity color */}
                  <path
                    d={path}
                    stroke={isSelected ? "hsl(var(--primary))" : getWireColor(wire.polarity)}
                    strokeWidth={isSelected ? getWireThickness(wire.gauge) + 2 : getWireThickness(wire.gauge)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                    opacity={isSelected ? 1 : 0.9}
                    style={{ pointerEvents: 'none', paintOrder: 'stroke fill' }}
                  />

                  {showWireLabels && (
                    <g transform={`translate(${labelX}, ${labelY}) rotate(${labelRotation})`} className="pointer-events-none">
                      <rect
                        x={wire.length ? "-45" : "-35"}
                        y="-12"
                        width={wire.length ? "90" : "70"}
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
                        {wire.length && wire.length > 0 && (
                          <tspan className="text-[10px] font-normal opacity-75"> • {wire.length.toFixed(1)}ft</tspan>
                        )}
                      </text>
                    </g>
                  )}

                  {/* Preview of dragged endpoint */}
                  {draggedWireEndpoint?.wireId === wire.id && draggedEndpointPos && (
                    <circle
                      cx={draggedEndpointPos.x}
                      cy={draggedEndpointPos.y}
                      r={10}
                      fill="hsl(var(--primary))"
                      stroke="white"
                      strokeWidth={3}
                      opacity={0.7}
                      className="pointer-events-none"
                    />
                  )}
                </g>
              );
            });
          })()}

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
          {wireStart && wirePreviewEnd && (() => {
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
              fuse: { width: 80, height: 60 },
              switch: { width: 80, height: 80 },
              'ac-panel': { width: 180, height: 220 },
              'dc-panel': { width: 160, height: 240 },
            };

            const obstacles: Obstacle[] = components.map(comp => {
              const dims = componentDimensions[comp.type] || { width: 120, height: 100 };
              return {
                x: comp.x,
                y: comp.y,
                width: dims.width,
                height: dims.height
              };
            });

            const previewRoute = calculateRoute(
              wireStart.position.x, wireStart.position.y,
              wirePreviewEnd.x, wirePreviewEnd.y,
              obstacles,
              2400, // canvas width
              1600, // canvas height
              new Set<string>(), // No occupied nodes for preview
              wireStart.terminal.orientation
            );

            return (
              <path
                d={previewRoute.path}
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
            );
          })()}
        </svg>

        <div className="absolute inset-0 p-4 pointer-events-none" style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }}>
          {components.map((component) => {
            // Determine which terminals to highlight
            const highlightedTerminals: string[] = [];
            if (wireStart && wireStart.componentId === component.id) {
              highlightedTerminals.push(wireStart.terminal.id);
            }

            // Calculate position - use preview position if this component is being dragged
            const isBeingDragged = draggedComponentPositions.has(component.id);
            let posX = component.x;
            let posY = component.y;
            
            if (isBeingDragged && dragPreviewPos && draggedComponentId) {
              // Calculate delta from the primary dragged component's movement
              const primaryOrigPos = draggedComponentPositions.get(draggedComponentId);
              const thisOrigPos = draggedComponentPositions.get(component.id);
              if (primaryOrigPos && thisOrigPos) {
                const deltaX = dragPreviewPos.x - primaryOrigPos.x;
                const deltaY = dragPreviewPos.y - primaryOrigPos.y;
                posX = thisOrigPos.x + deltaX;
                posY = thisOrigPos.y + deltaY;
              }
            }

            return (
              <div
                key={component.id}
                draggable
                onDragStart={(e) => handleComponentDragStart(component, e)}
                className={`absolute cursor-move pointer-events-none ${wireStartComponent === component.id ? 'ring-4 ring-primary' : ''
                  } ${isBeingDragged ? 'opacity-70' : ''}`}
                style={{
                  left: posX,
                  top: posY,
                  transition: isBeingDragged ? 'none' : undefined,
                }}
                data-testid={`canvas-component-${component.id}`}
              >
                <SchematicComponent
                  type={component.type}
                  name={component.name}
                  properties={component.properties}
                  selected={selectedIds.includes(component.id)}
                  validationStatus={componentValidationStatus?.get(component.id)}
                  onClick={(e) => handleComponentClick(component, e)}
                  onTerminalClick={(terminal, e) => handleTerminalClick(component, terminal, e)}
                  highlightedTerminals={highlightedTerminals}
                />
              </div>
            );
          })}

          {/* Drag preview removed - components now show their preview positions directly during drag */}
        </div>

        {/* Wire drag handles overlay - rendered on top of everything */}
        <svg
          className="absolute inset-0 pointer-events-none"
          width="100%"
          height="100%"
          style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }}
        >
          {wires.map((wire) => {
            const isSelected = selectedWireId === wire.id;
            if (!isSelected || draggedWireEndpoint) return null;

            const fromComp = components.find(c => c.id === wire.fromComponentId);
            const toComp = components.find(c => c.id === wire.toComponentId);
            if (!fromComp || !toComp) return null;

            let fromPos = getTerminalPosition(fromComp.x, fromComp.y, fromComp.type, wire.fromTerminal);
            let toPos = getTerminalPosition(toComp.x, toComp.y, toComp.type, wire.toTerminal);

            if (!fromPos) {
              const from = getComponentPosition(wire.fromComponentId);
              fromPos = { x: from.x, y: from.y };
            }
            if (!toPos) {
              const to = getComponentPosition(wire.toComponentId);
              toPos = { x: to.x, y: to.y };
            }

            return (
              <g key={`handles-${wire.id}`}>
                {/* From endpoint handle */}
                <circle
                  cx={fromPos.x}
                  cy={fromPos.y}
                  r={8}
                  fill="hsl(var(--primary))"
                  stroke="white"
                  strokeWidth={2}
                  className="cursor-move"
                  onMouseDown={(e) => handleWireEndpointMouseDown(wire.id, 'from', e)}
                  style={{ pointerEvents: 'all' }}
                />
                {/* To endpoint handle */}
                <circle
                  cx={toPos.x}
                  cy={toPos.y}
                  r={8}
                  fill="hsl(var(--primary))"
                  stroke="white"
                  strokeWidth={2}
                  className="cursor-move"
                  onMouseDown={(e) => handleWireEndpointMouseDown(wire.id, 'to', e)}
                  style={{ pointerEvents: 'all' }}
                />
              </g>
            );
          })}
        </svg>
        </div>
      </div>
    </div>
  );
}
