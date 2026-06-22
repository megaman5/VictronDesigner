import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface DisclaimerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: () => void;
  // When true, the dialog was opened manually (from the menu) and just needs a
  // Close button rather than an acceptance action.
  reviewOnly?: boolean;
}

export function DisclaimerDialog({ open, onOpenChange, onAccept, reviewOnly = false }: DisclaimerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-yellow-700 dark:text-yellow-500">
            <AlertTriangle className="h-5 w-5" />
            Important Disclaimer
          </DialogTitle>
          <DialogDescription className="sr-only">
            Please read this disclaimer about the tool's calculations.
          </DialogDescription>
        </DialogHeader>

        <div className="text-sm text-muted-foreground space-y-3">
          <p>
            <strong className="text-foreground">Do not trust calculations without verification.</strong>{" "}
            This tool is in active development and calculations may contain errors.
          </p>
          <p>
            Always double-check wire sizing, current ratings, and voltage drop calculations against
            ABYC/NEC standards and manufacturer specifications. Verify all component ratings and
            connections before installation.
          </p>
          <p>
            This tool is for planning purposes only and does not replace professional electrical
            engineering review.
          </p>
        </div>

        <DialogFooter>
          {reviewOnly ? (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          ) : (
            <Button onClick={onAccept} data-testid="button-accept-disclaimer">
              I Understand
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
