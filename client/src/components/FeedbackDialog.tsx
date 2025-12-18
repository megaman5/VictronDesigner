import { useState } from "react";
import html2canvas from "html2canvas";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, MessageSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { SchematicComponent, Wire } from "@shared/schema";

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  components: SchematicComponent[];
  wires: Wire[];
  systemVoltage: number;
}

export function FeedbackDialog({ 
  open, 
  onOpenChange, 
  components, 
  wires, 
  systemVoltage 
}: FeedbackDialogProps) {
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const captureScreenshot = async (): Promise<string | undefined> => {
    try {
      const canvasElement = document.querySelector('[data-testid="canvas-drop-zone"]') as HTMLElement;
      if (!canvasElement) {
        console.warn("No canvas found for screenshot");
        return undefined;
      }

      const canvas = await html2canvas(canvasElement, {
        backgroundColor: "#1a1a2e",
        scale: 1,
        useCORS: true,
        logging: false,
      });

      return canvas.toDataURL('image/png');
    } catch (error) {
      console.error("Error capturing screenshot:", error);
      return undefined;
    }
  };

  const handleSubmit = async () => {
    if (!message.trim()) {
      toast({
        title: "Error",
        description: "Please enter your feedback",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);

    try {
      // Capture screenshot
      const screenshot = await captureScreenshot();

      // Submit feedback with state and screenshot
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          email: email || undefined,
          state: {
            components,
            wires,
            systemVoltage,
          },
          screenshot,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to submit feedback");
      }

      toast({
        title: "Thank you!",
        description: "Your feedback has been submitted successfully",
      });

      // Reset form
      setMessage("");
      setEmail("");
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error submitting feedback:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to submit feedback",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Send Feedback
          </DialogTitle>
          <DialogDescription>
            Help us improve! Your feedback will include your current design state and a screenshot.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="feedback-message">
              Feedback <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="feedback-message"
              placeholder="Tell us what you think, report bugs, or suggest features..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              disabled={submitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedback-email">Email (optional)</Label>
            <Input
              id="feedback-email"
              type="email"
              placeholder="your.email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">
              Provide your email if you'd like us to follow up with you
            </p>
          </div>

          <div className="rounded-lg bg-muted p-3 text-sm">
            <p className="font-medium mb-1">What we'll save:</p>
            <ul className="text-muted-foreground space-y-1">
              <li>• Your feedback message</li>
              <li>• Current design ({components.length} components, {wires.length} wires)</li>
              <li>• Screenshot of your canvas</li>
              <li>• Browser information (for debugging)</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              "Submit Feedback"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
