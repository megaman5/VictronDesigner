import { useState } from "react";
import { Sparkles } from "lucide-react";
import { AIGenerationProgress, type AIGenerationProgressState } from "@/components/AIGenerationProgress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { extractDesignRequirements, type DesignRequirements } from "@shared/design-requirements";

interface AIPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Cancels a running generation. Closing the dialog only hides it. */
  onStop?: () => void;
  onGenerate?: (prompt: string, requirements?: DesignRequirements) => void;
  systemVoltage?: number;
  existingComponents?: Array<{ id: string; name: string; type: string }>;
  isGenerating?: boolean;
  iterationProgress?: AIGenerationProgressState | null;
  isIterating?: boolean; // True when modifying existing design
  existingComponentsCount?: number; // Number of components in current design
}

export function AIPromptDialog({ open, onOpenChange, onStop, onGenerate, systemVoltage = 12, existingComponents = [], isGenerating = false, iterationProgress, isIterating = false, existingComponentsCount = 0 }: AIPromptDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [solarWatts, setSolarWatts] = useState('');
  const [batteryAh, setBatteryAh] = useState('');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [conductors, setConductors] = useState('1');
  const [polarity, setPolarity] = useState('positive');
  const handleGenerate = () => {
    if (!prompt.trim()) return;
    if (solarWatts || batteryAh || (fromId && toId)) {
      const requirements = extractDesignRequirements(prompt, systemVoltage);
      if (Number(solarWatts) > 0) requirements.aggregates = [...(requirements.aggregates ?? []).filter(a => a.type !== 'solar-panel'), { id: 'aggregate.solar-power', type: 'solar-panel', property: 'watts', minimum: Number(solarWatts) }];
      if (Number(batteryAh) > 0) requirements.aggregates = [...(requirements.aggregates ?? []).filter(a => a.type !== 'battery'), { id: 'aggregate.battery-capacity', type: 'battery', property: 'capacity', minimum: Number(batteryAh) }];
      if (fromId && toId && fromId !== toId) requirements.connections.push({ id: 'connection.reviewed', fromComponentId: fromId, toComponentId: toId, polarity, minimumWires: Math.min(20, Math.max(1, Number(conductors) || 1)), origin: 'explicit' });
      onGenerate?.(prompt, requirements);
      return;
    }
    onGenerate?.(prompt);
  };

  const examplePrompts = isIterating ? [
    "Add a SmartShunt for battery monitoring",
    "Replace the MPPT controller with a larger 100/50 model",
    "Add AC and DC load circuits with proper fusing",
  ] : [
    "Design a 3kW solar system for an RV with 400Ah battery bank",
    "Create an off-grid home system with 5kW inverter and MPPT controller",
    "Setup a marine power system for a 40ft boat with shore power",
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {isIterating ? "AI Design Iteration" : "AI System Designer"}
          </DialogTitle>
          <DialogDescription>
            {isIterating
              ? `Modify your existing design (${existingComponentsCount} components). Describe what you'd like to add, remove, or change.`
              : "Describe your power system requirements and let AI design the schematic for you"
            }
          </DialogDescription>
        </DialogHeader>

        {isGenerating ? (
          <>
            <AIGenerationProgress
              progress={iterationProgress ?? { iteration: 1, maxIterations: 6, phase: 'waiting', startedAt: Date.now() }}
              onStop={onStop ?? (() => onOpenChange(false))}
            />
            <p className="text-xs text-muted-foreground">You can close this window. The AI keeps working and the design appears on your canvas when it's done.</p>
          </>
        ) : (
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="prompt">Describe your system</Label>
              <Textarea
                id="prompt"
                placeholder="Example: Design a 5kW solar system for an RV with 12V battery bank, MPPT controller, and shore power connection..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="min-h-32 resize-none"
                data-testid="input-ai-prompt"
              />
              <p className="text-sm text-muted-foreground">Include the equipment, quantities, power needs, and connections you want in your design.</p>
            </div>

            <details className="rounded border p-3 text-sm">
              <summary className="cursor-pointer font-medium">Capacity and connection requirements (optional)</summary>
              <p className="my-2 text-muted-foreground">These are checked separately from the score. Other instructions in your prompt remain visible for review.</p>
              <div className="grid grid-cols-2 gap-3">
                <Label>Minimum solar watts<Input type="number" min="0" value={solarWatts} onChange={e => setSolarWatts(e.target.value)} aria-label="Minimum solar watts" /></Label>
                <Label>Battery bank Ah at system voltage<Input type="number" min="0" value={batteryAh} onChange={e => setBatteryAh(e.target.value)} aria-label="Battery bank Ah at system voltage" /></Label>
              </div>
              {existingComponents.length > 1 && <div className="mt-3 space-y-2">
                <Label>Required direct connection</Label>
                <div className="flex flex-wrap gap-2">
                  <select aria-label="Required connection source" className="border rounded bg-background p-2" value={fromId} onChange={e => setFromId(e.target.value)}><option value="">From equipment</option>{existingComponents.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                  <select aria-label="Required connection destination" className="border rounded bg-background p-2" value={toId} onChange={e => setToId(e.target.value)}><option value="">To equipment</option>{existingComponents.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                  <select aria-label="Required connection polarity" className="border rounded bg-background p-2" value={polarity} onChange={e => setPolarity(e.target.value)}>{['positive', 'negative', 'hot', 'neutral', 'ground'].map(p => <option key={p}>{p}</option>)}</select>
                  <Label>Conductor count<Input aria-label="Required conductor count" type="number" min="1" max="20" value={conductors} onChange={e => setConductors(e.target.value)} /></Label>
                </div>
              </div>}
            </details>

            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Example Prompts</Label>
              <div className="space-y-2">
                {examplePrompts.map((example, i) => (
                  <button
                    key={i}
                    onClick={() => setPrompt(example)}
                    className="w-full text-left text-sm p-2 rounded-md border bg-background hover-elevate active-elevate-2 transition-colors"
                    data-testid={`example-prompt-${i}`}
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isGenerating}
                data-testid="button-cancel-ai"
              >
                Cancel
              </Button>
              <Button
                onClick={handleGenerate}
                disabled={!prompt.trim() || isGenerating}
                data-testid="button-generate-ai"
                className="gap-2"
              >
                <Sparkles className="h-4 w-4" />
                {isIterating ? "Iterate Design" : "Generate System"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
