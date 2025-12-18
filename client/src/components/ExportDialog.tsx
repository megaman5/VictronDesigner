import { useState } from "react";
import { Download, FileText, ShoppingCart, Tag, FileImage, Loader2 } from "lucide-react";
import html2canvas from "html2canvas";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import type { SchematicComponent, Wire } from "@shared/schema";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  components: SchematicComponent[];
  wires: Wire[];
  systemVoltage: number;
  designName?: string;
}

export function ExportDialog({ 
  open, 
  onOpenChange, 
  components, 
  wires, 
  systemVoltage,
  designName = "Design"
}: ExportDialogProps) {
  const { toast } = useToast();
  const [exporting, setExporting] = useState<string | null>(null);

  const exportShoppingList = async () => {
    setExporting("shopping");
    try {
      const response = await fetch("/api/export/shopping-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ components, wires, systemVoltage, name: designName }),
      });

      if (!response.ok) throw new Error("Export failed");

      const items = await response.json();
      
      // Convert to CSV
      const csv = [
        "Category,Item,Quantity,Notes",
        ...items.map((item: any) => 
          `"${item.category}","${item.name}",${item.quantity},"${item.notes || ''}"`
        )
      ].join("\n");

      // Download
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${designName}-shopping-list.csv`;
      a.click();
      URL.revokeObjectURL(url);

      toast({
        title: "Exported!",
        description: "Shopping list downloaded as CSV",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to export shopping list",
        variant: "destructive",
      });
    } finally {
      setExporting(null);
    }
  };

  const exportWireLabels = async () => {
    setExporting("labels");
    try {
      const response = await fetch("/api/export/wire-labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ components, wires, systemVoltage, name: designName }),
      });

      if (!response.ok) throw new Error("Export failed");

      const labels = await response.json();
      
      // Convert to printable format
      const text = labels.map((label: any) => 
        `Wire: ${label.from} → ${label.to}\nGauge: ${label.gauge}\nLength: ${label.length}m\nPolarity: ${label.polarity}\n${"─".repeat(30)}`
      ).join("\n\n");

      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${designName}-wire-labels.txt`;
      a.click();
      URL.revokeObjectURL(url);

      toast({
        title: "Exported!",
        description: "Wire labels downloaded",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to export wire labels",
        variant: "destructive",
      });
    } finally {
      setExporting(null);
    }
  };

  const exportDiagram = async () => {
    setExporting("diagram");
    try {
      // Find the schematic canvas container
      const canvasElement = document.querySelector('[data-testid="canvas-drop-zone"]') as HTMLElement;
      if (!canvasElement) {
        throw new Error("Design canvas not found");
      }

      // Use html2canvas to capture the design
      const canvas = await html2canvas(canvasElement, {
        backgroundColor: "#1a1a2e", // Dark background
        scale: 2, // Higher resolution
        useCORS: true,
        logging: false,
      });

      // Add logo watermark to bottom-right corner
      const ctx = canvas.getContext("2d");
      if (ctx) {
        try {
          // Load both the icon and create text watermark
          const icon = new Image();
          icon.crossOrigin = "anonymous";
          
          await new Promise<void>((resolve) => {
            icon.onload = () => {
              // Calculate icon size
              const iconHeight = 60;
              const iconScale = iconHeight / icon.height;
              const iconWidth = icon.width * iconScale;
              
              // Position in bottom-right corner with padding
              const padding = 30;
              const textWidth = 280; // Approximate width for "VictronDesigner.com"
              const totalWidth = iconWidth + textWidth + 10;
              const x = canvas.width - totalWidth - padding;
              const y = canvas.height - iconHeight - padding;
              
              // Draw semi-transparent rounded background
              const bgPadding = 15;
              ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
              ctx.beginPath();
              const bgX = x - bgPadding;
              const bgY = y - bgPadding;
              const bgWidth = totalWidth + bgPadding * 2;
              const bgHeight = iconHeight + bgPadding * 2;
              const radius = 10;
              ctx.moveTo(bgX + radius, bgY);
              ctx.lineTo(bgX + bgWidth - radius, bgY);
              ctx.quadraticCurveTo(bgX + bgWidth, bgY, bgX + bgWidth, bgY + radius);
              ctx.lineTo(bgX + bgWidth, bgY + bgHeight - radius);
              ctx.quadraticCurveTo(bgX + bgWidth, bgY + bgHeight, bgX + bgWidth - radius, bgY + bgHeight);
              ctx.lineTo(bgX + radius, bgY + bgHeight);
              ctx.quadraticCurveTo(bgX, bgY + bgHeight, bgX, bgY + bgHeight - radius);
              ctx.lineTo(bgX, bgY + radius);
              ctx.quadraticCurveTo(bgX, bgY, bgX + radius, bgY);
              ctx.closePath();
              ctx.fill();
              
              // Draw icon
              ctx.drawImage(icon, x, y, iconWidth, iconHeight);
              
              // Draw text
              ctx.fillStyle = "#1e3a5f";
              ctx.font = "bold 28px Inter, system-ui, sans-serif";
              ctx.textBaseline = "middle";
              ctx.fillText("VictronDesigner.com", x + iconWidth + 10, y + iconHeight / 2);
              
              resolve();
            };
            icon.onerror = () => {
              console.warn("Failed to load icon for watermark, using text only");
              // Fallback: just add text watermark
              const padding = 30;
              ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
              ctx.fillRect(canvas.width - 320, canvas.height - 60, 300, 40);
              ctx.fillStyle = "#1e3a5f";
              ctx.font = "bold 24px Inter, system-ui, sans-serif";
              ctx.fillText("VictronDesigner.com", canvas.width - 300, canvas.height - 35);
              resolve();
            };
            // Use full URL to ensure it loads correctly
            icon.src = window.location.origin + "/icon-only.png";
          });
        } catch (err) {
          console.warn("Watermark error:", err);
        }
      }

      // Export as PNG
      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${designName}-diagram.png`;
      a.click();

      toast({
        title: "Exported!",
        description: "Wiring diagram downloaded as PNG",
      });
    } catch (error) {
      console.error("Export error:", error);
      toast({
        title: "Error",
        description: "Failed to export diagram",
        variant: "destructive",
      });
    } finally {
      setExporting(null);
    }
  };

  const exportSystemReport = async () => {
    setExporting("report");
    try {
      const response = await fetch("/api/export/system-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ components, wires, systemVoltage, name: designName }),
      });

      if (!response.ok) throw new Error("Export failed");

      const report = await response.text();
      
      const blob = new Blob([report], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${designName}-system-report.txt`;
      a.click();
      URL.revokeObjectURL(url);

      toast({
        title: "Exported!",
        description: "System report downloaded",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to export system report",
        variant: "destructive",
      });
    } finally {
      setExporting(null);
    }
  };

  const hasContent = components.length > 0 || wires.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            Export Design
          </DialogTitle>
          <DialogDescription>
            Download your design in various formats
          </DialogDescription>
        </DialogHeader>

        {!hasContent ? (
          <div className="py-8 text-center text-muted-foreground">
            <p>No components to export.</p>
            <p className="text-sm mt-1">Add components to your design first.</p>
          </div>
        ) : (
          <div className="space-y-3 pt-4">
            <Button
              variant="outline"
              className="w-full justify-start gap-3 h-auto py-3"
              onClick={exportDiagram}
              disabled={!!exporting}
            >
              {exporting === "diagram" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <FileImage className="h-5 w-5" />
              )}
              <div className="text-left">
                <div className="font-medium">Wiring Diagram</div>
                <div className="text-xs text-muted-foreground">PNG image of your schematic</div>
              </div>
            </Button>

            <Button
              variant="outline"
              className="w-full justify-start gap-3 h-auto py-3"
              onClick={exportShoppingList}
              disabled={!!exporting}
            >
              {exporting === "shopping" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <ShoppingCart className="h-5 w-5" />
              )}
              <div className="text-left">
                <div className="font-medium">Shopping List</div>
                <div className="text-xs text-muted-foreground">CSV with all components and parts</div>
              </div>
            </Button>

            <Button
              variant="outline"
              className="w-full justify-start gap-3 h-auto py-3"
              onClick={exportWireLabels}
              disabled={!!exporting || wires.length === 0}
            >
              {exporting === "labels" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Tag className="h-5 w-5" />
              )}
              <div className="text-left">
                <div className="font-medium">Wire Labels</div>
                <div className="text-xs text-muted-foreground">
                  {wires.length === 0 ? "No wires to label" : "Printable labels for each wire"}
                </div>
              </div>
            </Button>

            <Button
              variant="outline"
              className="w-full justify-start gap-3 h-auto py-3"
              onClick={exportSystemReport}
              disabled={!!exporting}
            >
              {exporting === "report" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <FileText className="h-5 w-5" />
              )}
              <div className="text-left">
                <div className="font-medium">System Report</div>
                <div className="text-xs text-muted-foreground">Full technical summary</div>
              </div>
            </Button>

            <Separator />

            <div className="flex justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
