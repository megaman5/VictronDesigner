import { useState } from "react";
import { Sparkles, Loader2, CheckCircle, AlertCircle } from "lucide-react";
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
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

interface IterationProgress {
  iteration: number;
  maxIterations: number;
  score?: number;
  errorCount?: number;
  warningCount?: number;
  isBest?: boolean;
}

interface AIPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate?: (prompt: string) => void;
  isGenerating?: boolean;
  iterationProgress?: IterationProgress | null;
}

export function AIPromptDialog({ open, onOpenChange, onGenerate, isGenerating = false, iterationProgress }: AIPromptDialogProps) {
  const [prompt, setPrompt] = useState("");

  const handleGenerate = () => {
    if (!prompt.trim()) return;
    console.log("Generating system from prompt:", prompt);
    onGenerate?.(prompt);
    setPrompt("");
  };

  const examplePrompts = [
    "Design a 3kW solar system for an RV with 400Ah battery bank",
    "Create an off-grid home system with 5kW inverter and MPPT controller",
    "Setup a marine power system for a 40ft boat with shore power",
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI System Designer
          </DialogTitle>
          <DialogDescription>
            Describe your power system requirements and let AI design the schematic for you
          </DialogDescription>
        </DialogHeader>

        {isGenerating ? (
          <div className="space-y-6 py-8" data-testid="ai-generating-state">
            <div className="flex justify-center">
              <div className="relative">
                <Sparkles className="h-16 w-16 text-primary animate-pulse" />
                <Loader2 className="h-16 w-16 text-primary animate-spin absolute inset-0" />
              </div>
            </div>

            <div className="text-center space-y-2">
              <p className="text-lg font-medium">Designing your electrical system...</p>
              {iterationProgress ? (
                <p className="text-sm text-muted-foreground">
                  Iteration {iterationProgress.iteration} of {iterationProgress.maxIterations}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  AI is calculating component placement, wire sizing, and safety requirements
                </p>
              )}
            </div>

            {/* Iteration Progress */}
            {iterationProgress && (
              <div className="space-y-4 px-6">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-medium">
                      {Math.round((iterationProgress.iteration / iterationProgress.maxIterations) * 100)}%
                    </span>
                  </div>
                  <Progress
                    value={(iterationProgress.iteration / iterationProgress.maxIterations) * 100}
                    className="h-2"
                  />
                </div>

                {/* Quality Score */}
                {iterationProgress.score !== undefined && (
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2">
                      {iterationProgress.isBest ? (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      ) : (
                        <Sparkles className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="text-sm font-medium">Quality Score</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold">{iterationProgress.score}</span>
                      {iterationProgress.isBest && (
                        <Badge variant="default" className="text-xs">Best</Badge>
                      )}
                    </div>
                  </div>
                )}

                {/* Error/Warning Count */}
                {(iterationProgress.errorCount !== undefined || iterationProgress.warningCount !== undefined) && (
                  <div className="flex gap-2 justify-center">
                    {iterationProgress.errorCount !== undefined && iterationProgress.errorCount > 0 && (
                      <Badge variant="destructive" className="gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {iterationProgress.errorCount} Errors
                      </Badge>
                    )}
                    {iterationProgress.warningCount !== undefined && iterationProgress.warningCount > 0 && (
                      <Badge variant="outline" className="gap-1 border-yellow-500 text-yellow-700">
                        <AlertCircle className="h-3 w-3" />
                        {iterationProgress.warningCount} Warnings
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-center gap-1">
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        ) : (
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="prompt">System Requirements</Label>
              <Textarea
                id="prompt"
                placeholder="Example: Design a 5kW solar system for an RV with 12V battery bank, MPPT controller, and shore power connection..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="min-h-32 resize-none"
                data-testid="input-ai-prompt"
              />
            </div>

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
                Generate System
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
