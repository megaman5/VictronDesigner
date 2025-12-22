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
        'breaker-panel': { width: 160, height: 200 },
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
      'breaker-panel': 200,
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
              'breaker-panel': { width: 160, height: 200 },
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

            // Track occupied nodes for wire separation
            const occupiedNodes = new Set<string>();

            return wires.map((wire, wireIndex) => {
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

              // Use preview position if component is being dragged
              const fromCompX = (draggedComponentId === fromComp.id && dragPreviewPos) ? dragPreviewPos.x : fromComp.x;
              const fromCompY = (draggedComponentId === fromComp.id && dragPreviewPos) ? dragPreviewPos.y : fromComp.y;
              const toCompX = (draggedComponentId === toComp.id && dragPreviewPos) ? dragPreviewPos.x : toComp.x;
              const toCompY = (draggedComponentId === toComp.id && dragPreviewPos) ? dragPreviewPos.y : toComp.y;

              // Try to get terminal positions, fall back to component centers
              let fromPos = getTerminalPosition(fromCompX, fromCompY, fromComp.type, wire.fromTerminal);
              let toPos = getTerminalPosition(toCompX, toCompY, toComp.type, wire.toTerminal);

              // If either terminal position is null, use component centers as fallback
              if (!fromPos) {
                if (draggedComponentId === fromComp.id && dragPreviewPos) {
                  // Use preview position for dragged component
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
                  // Use preview position for dragged component
                  const config = TERMINAL_CONFIGS[toComp.type];
                  const centerX = dragPreviewPos.x + (config?.width || 120) / 2;
                  const centerY = dragPreviewPos.y + (config?.height || 100) / 2;
                  toPos = { x: centerX, y: centerY };
                } else {
                  const to = getComponentPosition(wire.toComponentId);
                  toPos = { x: to.x, y: to.y };
                }
              }

              // Override endpoint position if this wire is being dragged
              if (draggedWireEndpoint?.wireId === wire.id && draggedEndpointPos) {
                if (draggedWireEndpoint.endpoint === 'from') {
                  fromPos = { ...draggedEndpointPos };
                } else {
                  toPos = { ...draggedEndpointPos };
                }
              }

              // Use A* router with obstacles
              // Get terminal orientations
              const fromOrientation = getTerminalOrientation(fromComp.type, wire.fromTerminal);
              const toOrientation = getTerminalOrientation(toComp.type, wire.toTerminal);

              // Apply dynamic offsets for multiple connections
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

              // Extend wire paths well into terminal positions to ensure proper connection
              // This prevents gaps when exporting to PNG (html2canvas can have sub-pixel rendering issues)
              // Terminals have white strokes (2-3px) and radius 7-10px, so we need to extend past the stroke
              // Orientation is the EXIT direction, so to extend INTO the terminal, we go OPPOSITE direction
              const extendDistance = 10; // pixels to extend into terminal (past the white stroke)
              let extendedFromPos = { ...fromPos };
              let extendedToPos = { ...toPos };
              
              if (fromOrientation) {
                // Extend OPPOSITE to orientation direction (into the terminal center, past the white stroke)
                if (fromOrientation === 'left') extendedFromPos.x += extendDistance; // Go right (into terminal)
                else if (fromOrientation === 'right') extendedFromPos.x -= extendDistance; // Go left (into terminal)
                else if (fromOrientation === 'top') extendedFromPos.y += extendDistance; // Go down (into terminal)
                else if (fromOrientation === 'bottom') extendedFromPos.y -= extendDistance; // Go up (into terminal)
              }
              
              if (toOrientation) {
                // Extend OPPOSITE to orientation direction (into the terminal center, past the white stroke)
                if (toOrientation === 'left') extendedToPos.x += extendDistance; // Go right (into terminal)
                else if (toOrientation === 'right') extendedToPos.x -= extendDistance; // Go left (into terminal)
                else if (toOrientation === 'top') extendedToPos.y += extendDistance; // Go down (into terminal)
                else if (toOrientation === 'bottom') extendedToPos.y -= extendDistance; // Go up (into terminal)
              }

              const result = calculateRoute(
                extendedFromPos.x, extendedFromPos.y,
                extendedToPos.x, extendedToPos.y,
                obstacles,
                2400, // canvas width
                1600, // canvas height
                occupiedNodes,
                fromOrientation || undefined,
                toOrientation || undefined
              );

              // Add this wire's path to occupied nodes for next wires
              result.pathNodes.forEach(node => occupiedNodes.add(node));

              const path = result.path;
              const labelX = result.labelX;
              const labelY = result.labelY;
              const labelRotation = result.labelRotation;

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
              'breaker-panel': { width: 160, height: 200 },
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

            return (
              <div
                key={component.id}
                draggable
                onDragStart={(e) => handleComponentDragStart(component, e)}
                className={`absolute cursor-move pointer-events-none ${wireStartComponent === component.id ? 'ring-4 ring-primary' : ''
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

          {/* Drag preview - shows component position while dragging */}
          {draggedComponentId && dragPreviewPos && (() => {
            const draggedComp = components.find(c => c.id === draggedComponentId);
            if (!draggedComp) return null;

            return (
              <div
                key={`preview-${draggedComponentId}`}
                className="absolute pointer-events-none opacity-50"
                style={{
                  left: dragPreviewPos.x,
                  top: dragPreviewPos.y,
                }}
              >
                <SchematicComponent
                  type={draggedComp.type}
                  name={draggedComp.name}
                  properties={draggedComp.properties}
                  selected={false}
                  onClick={() => {}}
                  onTerminalClick={() => {}}
                  highlightedTerminals={[]}
                />
              </div>
            );
          })()}
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
