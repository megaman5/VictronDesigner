import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Save, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { GRID_SIZE, snapToGrid } from "@/lib/wire-routing";
import type { Terminal, TerminalOrientation } from "@/lib/terminal-config";
import type { CustomComponentDefinition, CustomComponentInput } from "@/lib/custom-components";

type TerminalType = Terminal["type"];

const TERMINAL_TYPES: TerminalType[] = [
  "positive",
  "negative",
  "ac-in",
  "ac-out",
  "hot",
  "neutral",
  "ground",
  "pv-positive",
  "pv-negative",
];

const ORIENTATIONS: TerminalOrientation[] = ["left", "right", "top", "bottom"];

// Short default label per type, in the style the built-in components use
// ("+", "PV+", "N"). The label is drawn next to the terminal on the canvas,
// so it has to stay short - an id-derived default like "TERMINAL-1" is
// unreadable once there are more than a couple of terminals.
const DEFAULT_LABELS: Record<TerminalType, string> = {
  positive: "+",
  negative: "-",
  "pv-positive": "PV+",
  "pv-negative": "PV-",
  hot: "L",
  neutral: "N",
  ground: "G",
  "ac-in": "AC IN",
  "ac-out": "AC OUT",
};

// Default dot color per terminal type, matching the wire color CSS vars used
// throughout terminal-config.ts / SchematicComponent.tsx.
const TYPE_COLORS: Record<TerminalType, string> = {
  positive: "hsl(var(--wire-positive))",
  "pv-positive": "hsl(var(--wire-positive))",
  negative: "hsl(var(--wire-negative))",
  "pv-negative": "hsl(var(--wire-negative))",
  hot: "hsl(var(--wire-ac-hot))",
  "ac-in": "hsl(var(--wire-ac-hot))",
  "ac-out": "hsl(var(--wire-ac-hot))",
  neutral: "hsl(var(--wire-neutral))",
  ground: "hsl(var(--wire-ac-ground))",
};

// Terminals sit ON the body edge, so half of each dot (and its label) falls
// outside the body box. The preview pads its viewBox by this much on every
// side so edge terminals render whole instead of being sliced off.
const PREVIEW_PAD = 18;

const EDGE_CLICK_THRESHOLD = 40; // px - "near an edge" tolerance for adding a terminal
const MIN_SIZE = 40;
const MAX_SIZE = 800;

// The system voltages this app reasons about elsewhere (see inferSystemVoltage
// in SchematicDesigner.tsx and battery-bank.ts) - a dual-voltage part like a
// 12/24V DC-DC charger can support more than one.
const DC_VOLTAGE_OPTIONS = [12, 24, 48] as const;

// Body colours for the component box. SchematicComponent already renders
// appearance.bodyColor; these give the author a way to actually set it, so
// several custom parts in one design stay tellable apart at a glance.
const BODY_COLORS: { value: string | null; label: string; swatch: string }[] = [
  { value: null, label: "Default", swatch: "hsl(var(--card))" },
  { value: "hsl(var(--victron-blue))", label: "Blue", swatch: "hsl(var(--victron-blue))" },
  { value: "hsl(215 16% 32%)", label: "Slate", swatch: "hsl(215 16% 32%)" },
  { value: "hsl(142 45% 30%)", label: "Green", swatch: "hsl(142 45% 30%)" },
  { value: "hsl(28 65% 40%)", label: "Amber", swatch: "hsl(28 65% 40%)" },
];

function snap(v: number): number {
  return snapToGrid(v);
}

interface CustomComponentEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the editor pre-fills from and PATCHes this definition. */
  definition?: CustomComponentDefinition | null;
  onSaved?: (definition: CustomComponentDefinition) => void;
}

export function CustomComponentEditor({ open, onOpenChange, definition, onSaved }: CustomComponentEditorProps) {
  const { toast } = useToast();
  const isEditing = !!definition;

  const [name, setName] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [width, setWidth] = useState(160);
  const [height, setHeight] = useState(120);
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [supportedVoltages, setSupportedVoltages] = useState<number[]>([]);
  const [bodyColor, setBodyColor] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const svgRef = useRef<SVGSVGElement>(null);
  const draggingIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (definition) {
      setName(definition.name);
      setSubtitle(definition.subtitle || "");
      setWidth(definition.width);
      setHeight(definition.height);
      setTerminals(definition.terminals.map(t => ({ ...t })));
      setSupportedVoltages(definition.supportedVoltages ? [...definition.supportedVoltages] : []);
      setBodyColor(definition.appearance?.bodyColor ?? null);
    } else {
      setName("");
      setSubtitle("");
      setWidth(160);
      setHeight(120);
      setTerminals([]);
      setSupportedVoltages([]);
      setBodyColor(null);
    }
    setErrors([]);
  }, [open, definition]);

  const saveMutation = useMutation({
    mutationFn: async (input: CustomComponentInput) => {
      const res = isEditing
        ? await apiRequest("PATCH", `/api/custom-components/${definition!.id}`, input)
        : await apiRequest("POST", "/api/custom-components", input);
      return (await res.json()) as CustomComponentDefinition;
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-components"] });
      toast({
        title: isEditing ? "Custom component updated" : "Custom component created",
        description: `"${saved.name}" is ready to drag on from Custom Components.`,
      });
      onSaved?.(saved);
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Save failed",
        description: error?.message || "Could not save the custom component",
        variant: "destructive",
      });
    },
  });

  const svgPointFromEvent = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    // The viewBox is padded by PREVIEW_PAD on each side, so the visible box is
    // (width + 2*PAD) x (height + 2*PAD) and its origin is at -PAD,-PAD.
    const scaleX = (width + PREVIEW_PAD * 2) / rect.width;
    const scaleY = (height + PREVIEW_PAD * 2) / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX - PREVIEW_PAD,
      y: (e.clientY - rect.top) * scaleY - PREVIEW_PAD,
    };
  };

  const nearestEdge = (x: number, y: number): { edge: TerminalOrientation; distance: number } => {
    const distances: Array<{ edge: TerminalOrientation; distance: number }> = [
      { edge: "left", distance: x },
      { edge: "right", distance: width - x },
      { edge: "top", distance: y },
      { edge: "bottom", distance: height - y },
    ];
    return distances.reduce((a, b) => (b.distance < a.distance ? b : a));
  };

  const nextTerminalId = () => {
    let n = terminals.length + 1;
    let id = `terminal-${n}`;
    const used = new Set(terminals.map(t => t.id));
    while (used.has(id)) {
      n++;
      id = `terminal-${n}`;
    }
    return id;
  };

  const handlePreviewClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (draggingIdRef.current) return; // suppress the click that ends a drag
    const pt = svgPointFromEvent(e);
    if (!pt) return;

    const { edge, distance } = nearestEdge(pt.x, pt.y);
    if (distance > EDGE_CLICK_THRESHOLD) {
      toast({
        title: "Click near an edge",
        description: "Terminals attach to the body edge - click closer to the border to add one.",
      });
      return;
    }

    let x = pt.x;
    let y = pt.y;
    if (edge === "left") x = 0;
    else if (edge === "right") x = width;
    else if (edge === "top") y = 0;
    else if (edge === "bottom") y = height;
    x = Math.min(width, Math.max(0, snap(x)));
    y = Math.min(height, Math.max(0, snap(y)));

    const id = nextTerminalId();
    const newTerminal: Terminal = {
      id,
      type: "positive",
      label: DEFAULT_LABELS.positive,
      x,
      y,
      color: TYPE_COLORS.positive,
      orientation: edge,
    };
    setTerminals(prev => [...prev, newTerminal]);
  };

  const updateTerminal = (id: string, patch: Partial<Terminal>) => {
    setTerminals(prev => prev.map(t => {
      if (t.id !== id) return t;
      const next = { ...t, ...patch };
      if (patch.type) {
        next.color = TYPE_COLORS[patch.type];
        // Only retarget the label if the author never customised it.
        if (t.label === DEFAULT_LABELS[t.type]) next.label = DEFAULT_LABELS[patch.type];
      }
      return next;
    }));
  };

  const renameTerminalId = (oldId: string, newId: string) => {
    setTerminals(prev => prev.map(t => (t.id === oldId ? { ...t, id: newId } : t)));
  };

  const removeTerminal = (id: string) => {
    setTerminals(prev => prev.filter(t => t.id !== id));
  };

  const handleTerminalMouseDown = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    draggingIdRef.current = id;

    const handleMove = (moveEvent: MouseEvent) => {
      const pt = svgPointFromEvent(moveEvent);
      if (!pt) return;
      const x = Math.min(width, Math.max(0, snap(pt.x)));
      const y = Math.min(height, Math.max(0, snap(pt.y)));
      updateTerminal(id, { x, y });
    };
    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      // Delay clearing so the subsequent synthetic click on the svg (if any)
      // is suppressed and doesn't add a stray terminal.
      setTimeout(() => { draggingIdRef.current = null; }, 0);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  const validate = (): string[] => {
    const problems: string[] = [];
    if (!name.trim()) problems.push("Name is required.");
    if (!Number.isFinite(width) || width < MIN_SIZE || width > MAX_SIZE) {
      problems.push(`Width must be between ${MIN_SIZE} and ${MAX_SIZE}px.`);
    }
    if (!Number.isFinite(height) || height < MIN_SIZE || height > MAX_SIZE) {
      problems.push(`Height must be between ${MIN_SIZE} and ${MAX_SIZE}px.`);
    }
    if (terminals.length === 0) {
      problems.push("Add at least one terminal.");
    }

    const seenIds = new Set<string>();
    terminals.forEach((t, i) => {
      const label = `Terminal ${i + 1}`;
      if (!t.id.trim()) problems.push(`${label}: id is required.`);
      else if (seenIds.has(t.id)) problems.push(`${label}: duplicate id "${t.id}".`);
      seenIds.add(t.id);

      if (!t.label.trim()) problems.push(`${label}: label is required.`);

      if (t.x < 0 || t.x > width || t.y < 0 || t.y > height) {
        problems.push(`${label} ("${t.id || "?"}"): position is outside the component body.`);
      }
    });

    return problems;
  };

  const handleSave = () => {
    const problems = validate();
    setErrors(problems);
    if (problems.length > 0) return;

    saveMutation.mutate({
      name: name.trim(),
      subtitle: subtitle.trim() || null,
      width,
      height,
      terminals,
      supportedVoltages: supportedVoltages.length > 0 ? supportedVoltages : null,
      appearance: bodyColor ? { bodyColor } : null,
    });
  };

  const toggleSupportedVoltage = (v: number) => {
    setSupportedVoltages(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v].sort((a, b) => a - b));
  };

  // Fit the padded body into the available preview area without distorting it.
  // A long thin busbar (e.g. 400x40) would otherwise render only 40px tall,
  // which is too small to click terminals onto accurately.
  const boxW = width + PREVIEW_PAD * 2;
  const boxH = height + PREVIEW_PAD * 2;
  const previewScale = Math.min(560 / boxW, 260 / boxH, 2);
  const previewW = Math.round(boxW * previewScale);
  const previewH = Math.round(boxH * previewScale);

  const handleWidthChange = (v: string) => {
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) setWidth(snap(n));
  };
  const handleHeightChange = (v: string) => {
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) setHeight(snap(n));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saveMutation.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 p-6 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            {isEditing ? "Edit Custom Component" : "Create Custom Component"}
          </DialogTitle>
          <DialogDescription>
            Define your own part with its own terminals (e.g. a Lynx module, a device
            without a built-in symbol). Click near the body's edge to add a terminal, drag
            a terminal to reposition it, and set its id/label/type/orientation below.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-4">
        {errors.length > 0 && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive space-y-1" data-testid="custom-component-errors">
            <div className="flex items-center gap-2 font-medium">
              <AlertCircle className="h-4 w-4" />
              Fix the following before saving
            </div>
            <ul className="list-disc pl-6">
              {errors.map((err, i) => <li key={i}>{err}</li>)}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="cc-name">Name <span className="text-destructive">*</span></Label>
            <Input id="cc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lynx Distributor" data-testid="input-cc-name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cc-subtitle">Subtitle</Label>
            <Input id="cc-subtitle" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="e.g. 1000A busbar" data-testid="input-cc-subtitle" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label htmlFor="cc-width">Width (px)</Label>
              <Input id="cc-width" type="number" step={GRID_SIZE} min={MIN_SIZE} max={MAX_SIZE} value={width} onChange={(e) => handleWidthChange(e.target.value)} data-testid="input-cc-width" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cc-height">Height (px)</Label>
              <Input id="cc-height" type="number" step={GRID_SIZE} min={MIN_SIZE} max={MAX_SIZE} value={height} onChange={(e) => handleHeightChange(e.target.value)} data-testid="input-cc-height" />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label>DC voltage support</Label>
          <p className="text-xs text-muted-foreground">
            Select every DC voltage this part actually works at (e.g. a 12/24V charger supports both).
            Leave all unselected if it's AC-only, passive, or has no fixed operating voltage - the design
            checks will then leave it alone rather than guessing.
          </p>
          <div className="flex gap-2">
            {DC_VOLTAGE_OPTIONS.map((v) => (
              <Button
                key={v}
                type="button"
                size="sm"
                variant={supportedVoltages.includes(v) ? "default" : "outline"}
                onClick={() => toggleSupportedVoltage(v)}
                data-testid={`button-cc-voltage-${v}`}
              >
                {v}V
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Body colour</Label>
          <div className="flex gap-2">
            {BODY_COLORS.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => setBodyColor(c.value)}
                title={c.label}
                aria-label={c.label}
                aria-pressed={bodyColor === c.value}
                className={`h-7 w-7 rounded-md border-2 ${bodyColor === c.value ? "border-primary" : "border-border"}`}
                style={{ background: c.swatch }}
                data-testid={`button-cc-color-${c.label.toLowerCase()}`}
              />
            ))}
          </div>
        </div>

        <Separator />

        <div>
          <Label className="mb-2 block">Body preview - click near an edge to add a terminal</Label>
          <div className="flex justify-center rounded-md border bg-muted/30 p-4 overflow-auto">
            <svg
              ref={svgRef}
              width={previewW}
              height={previewH}
              viewBox={`${-PREVIEW_PAD} ${-PREVIEW_PAD} ${width + PREVIEW_PAD * 2} ${height + PREVIEW_PAD * 2}`}
              className="cursor-crosshair"
              style={{ background: "hsl(var(--background))" }}
              onClick={handlePreviewClick}
              data-testid="custom-component-preview"
            >
              <rect
                x={4} y={4}
                width={Math.max(0, width - 8)} height={Math.max(0, height - 8)}
                fill={bodyColor || "hsl(var(--card))"}
                stroke="hsl(var(--victron-blue-light))"
                strokeWidth={2}
                strokeDasharray="6 3"
                rx={8}
              />
              <text x={width / 2} y={height / 2 - 6} textAnchor="middle" className={`${bodyColor ? "fill-white" : "fill-foreground"} text-sm font-semibold`} style={{ pointerEvents: "none" }}>
                {name || "Custom"}
              </text>
              {subtitle && (
                <text x={width / 2} y={height / 2 + 10} textAnchor="middle" className={`${bodyColor ? "fill-white/70" : "fill-muted-foreground"} text-[10px]`} style={{ pointerEvents: "none" }}>
                  {subtitle}
                </text>
              )}
              {terminals.map((t, i) => (
                <g key={i}>
                  <circle
                    cx={t.x} cy={t.y} r={8}
                    fill={t.color}
                    stroke="white"
                    strokeWidth={2}
                    className="cursor-move"
                    onMouseDown={handleTerminalMouseDown(t.id)}
                    data-testid={`preview-terminal-${t.id}`}
                  />
                  <text x={t.x} y={t.y - 12} textAnchor="middle" className="fill-foreground text-[9px]" style={{ pointerEvents: "none" }}>
                    {t.label}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>Terminals ({terminals.length})</Label>
          </div>
          {terminals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No terminals yet - click the preview above near an edge to add one.</p>
          ) : (
            <div className="space-y-2">
                <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 px-2 text-[11px] text-muted-foreground">
                  <span>ID</span>
                  <span>Label</span>
                  <span>Type</span>
                  <span>Exits</span>
                  <span className="w-8" />
                </div>
                {terminals.map((t, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 items-center rounded-md border p-2" data-testid={`terminal-row-${t.id}`}>
                    <Input
                      value={t.id}
                      onChange={(e) => renameTerminalId(t.id, e.target.value)}
                      placeholder="id"
                      className="h-8 text-xs"
                      data-testid={`input-terminal-id-${t.id}`}
                    />
                    <Input
                      value={t.label}
                      onChange={(e) => updateTerminal(t.id, { label: e.target.value })}
                      placeholder="label"
                      className="h-8 text-xs"
                      data-testid={`input-terminal-label-${t.id}`}
                    />
                    <Select value={t.type} onValueChange={(v) => updateTerminal(t.id, { type: v as TerminalType })}>
                      <SelectTrigger className="h-8 text-xs" data-testid={`select-terminal-type-${t.id}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TERMINAL_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>{type}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={t.orientation} onValueChange={(v) => updateTerminal(t.id, { orientation: v as TerminalOrientation })}>
                      <SelectTrigger className="h-8 text-xs" data-testid={`select-terminal-orientation-${t.id}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ORIENTATIONS.map((o) => (
                          <SelectItem key={o} value={o}>{o}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => removeTerminal(t.id)}
                      data-testid={`button-delete-terminal-${t.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
            </div>
          )}
        </div>

        </div>

        <DialogFooter className="shrink-0 border-t p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saveMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-custom-component">
            <Save className="mr-2 h-4 w-4" />
            {saveMutation.isPending ? "Saving..." : isEditing ? "Save Changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
