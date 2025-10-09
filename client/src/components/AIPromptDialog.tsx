import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
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

interface AIPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate?: (prompt: string) => void;
}

export function AIPromptDialog({ open, onOpenChange, onGenerate }: AIPromptDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    
    setIsGenerating(true);
    console.log("Generating system from prompt:", prompt);
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    setIsGenerating(false);
    onGenerate?.(prompt);
    onOpenChange(false);
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
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate System
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
