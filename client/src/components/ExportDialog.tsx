import { Download, FileText, ShoppingCart, Tag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExport?: (options: ExportOptions) => void;
}

interface ExportOptions {
  wiringDiagram: boolean;
  shoppingList: boolean;
  wireLabels: boolean;
  format: "pdf" | "png";
}

export function ExportDialog({ open, onOpenChange, onExport }: ExportDialogProps) {
  const handleExport = () => {
    console.log("Exporting schematic...");
    onExport?.({
      wiringDiagram: true,
      shoppingList: true,
      wireLabels: true,
      format: "pdf",
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            Export Schematic
          </DialogTitle>
          <DialogDescription>
            Choose what to include in your export
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Checkbox id="diagram" defaultChecked data-testid="checkbox-export-diagram" />
              <div className="flex-1">
                <Label htmlFor="diagram" className="flex items-center gap-2 cursor-pointer">
                  <FileText className="h-4 w-4" />
                  Wiring Diagram
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Professional schematic with all components and connections
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Checkbox id="bom" defaultChecked data-testid="checkbox-export-bom" />
              <div className="flex-1">
                <Label htmlFor="bom" className="flex items-center gap-2 cursor-pointer">
                  <ShoppingCart className="h-4 w-4" />
                  Shopping List
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Bill of materials with part numbers and quantities
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Checkbox id="labels" defaultChecked data-testid="checkbox-export-labels" />
              <div className="flex-1">
                <Label htmlFor="labels" className="flex items-center gap-2 cursor-pointer">
                  <Tag className="h-4 w-4" />
                  Wire Labels
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Printable labels with wire gauge, current, and connection points
                </p>
              </div>
            </div>
          </div>

          <Separator />

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-export"
            >
              Cancel
            </Button>
            <Button
              onClick={handleExport}
              data-testid="button-confirm-export"
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
