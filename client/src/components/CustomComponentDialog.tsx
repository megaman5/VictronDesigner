import { useState, useEffect } from "react";
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
import { Plus } from "lucide-react";

interface CustomComponentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (name: string, subtitle: string) => void;
}

export function CustomComponentDialog({ open, onOpenChange, onAdd }: CustomComponentDialogProps) {
  const [name, setName] = useState("");
  const [subtitle, setSubtitle] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setSubtitle("");
    }
  }, [open]);

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed, subtitle.trim());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Quick-add a plain box
          </DialogTitle>
          <DialogDescription>
            Drops a one-off placeholder with fixed DC +/- terminals on both sides, so you
            can wire it inline right away. It is not saved to your library. To place your
            own terminals and reuse the part across designs, use "Build a Component" instead.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="custom-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="custom-name"
              placeholder="e.g. Water maker"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
              autoFocus
              data-testid="input-custom-name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="custom-subtitle">Subtitle (optional)</Label>
            <Input
              id="custom-subtitle"
              placeholder="e.g. 12V, 8A"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
              data-testid="input-custom-subtitle"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!name.trim()} data-testid="button-add-custom-confirm">
            <Plus className="mr-2 h-4 w-4" />
            Add to Canvas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
