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
import { TERMINAL_CONFIGS } from "@/lib/terminal-config";

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
      // Calculate content bounds from components
      const padding = 100; // Padding around content
      let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
      
      components.forEach(comp => {
        const config = TERMINAL_CONFIGS[comp.type];
        const width = config?.width || 140;
        const height = config?.height || 100;
        
        if (comp.x < minX) minX = comp.x;
        if (comp.y < minY) minY = comp.y;
        if (comp.x + width > maxX) maxX = comp.x + width;
        if (comp.y + height > maxY) maxY = comp.y + height;
      });
      
      // Add padding and ensure minimum size
      minX = Math.max(0, minX - padding);
      minY = Math.max(0, minY - padding);
      maxX = maxX + padding;
      maxY = maxY + padding + 100; // Extra bottom padding for labels and watermark
      
      const contentWidth = Math.max(400, maxX - minX);
      const contentHeight = Math.max(300, maxY - minY);

      // Find the SVG element which is the actual canvas content
      const svgElement = document.querySelector('[data-testid="canvas-drop-zone"] svg') as SVGElement;
      if (!svgElement) {
        throw new Error("Design canvas not found");
      }

      // Get the parent container to also capture the component overlays
      const canvasContainer = document.querySelector('[data-testid="canvas-drop-zone"]') as HTMLElement;
      
      // Find all scaled elements and temporarily reset their transform to 100%
      const scaledElements = canvasContainer.querySelectorAll('[style*="transform"]') as NodeListOf<HTMLElement>;
      const originalTransforms: string[] = [];
      
      scaledElements.forEach((el, i) => {
        originalTransforms[i] = el.style.transform;
        el.style.transform = 'scale(1)';
      });

      // Create a temporary container for export with content-based dimensions
      const exportContainer = document.createElement('div');
      exportContainer.style.cssText = `
        position: fixed;
        left: -9999px;
        top: 0;
        width: ${contentWidth}px;
        height: ${contentHeight}px;
        overflow: hidden;
        background-color: #f8f9fa;
      `;
      
      // Clone the canvas content
      const clone = canvasContainer.cloneNode(true) as HTMLElement;
      clone.style.cssText = `
        width: ${maxX}px;
        height: ${maxY}px;
        overflow: visible;
        position: relative;
        transform: translate(${-minX}px, ${-minY}px);
      `;
      
      // Reset transforms on cloned elements (except the main translate)
      const clonedScaled = clone.querySelectorAll('[style*="scale"]') as NodeListOf<HTMLElement>;
      clonedScaled.forEach((el) => {
        // Keep position but remove scaling
        const currentTransform = el.style.transform;
        if (currentTransform.includes('scale')) {
          el.style.transform = currentTransform.replace(/scale\([^)]+\)/g, 'scale(1)');
        }
      });
      
      exportContainer.appendChild(clone);
      document.body.appendChild(exportContainer);

      // Use html2canvas to capture the clean container
      const canvas = await html2canvas(exportContainer, {
        backgroundColor: "#f8f9fa",
        scale: 1,
        useCORS: true,
        logging: false,
        width: contentWidth,
        height: contentHeight,
      });

      // Clean up
      document.body.removeChild(exportContainer);
      
      // Restore original transforms
      scaledElements.forEach((el, i) => {
        el.style.transform = originalTransforms[i];
      });

      // Load the icon first
      const iconImg = await new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => {
          console.warn("Failed to load watermark icon");
          resolve(null);
        };
        // Set a timeout
        setTimeout(() => resolve(null), 3000);
        img.src = window.location.origin + "/icon-only.png";
      });
      
      // Create a new canvas to composite the result with watermark
      const finalCanvas = document.createElement("canvas");
      finalCanvas.width = canvas.width;
      finalCanvas.height = canvas.height;
      const ctx = finalCanvas.getContext("2d");
      
      if (ctx) {
        // Draw the captured content
        ctx.drawImage(canvas, 0, 0);
        
        console.log("Final canvas dimensions:", finalCanvas.width, finalCanvas.height);
        console.log("Icon loaded:", !!iconImg);
        
        // Watermark settings - position in bottom right corner
        const watermarkPadding = 15; // Distance from edge
        const textContent = "VictronDesigner.com";
        const bgHeight = 50;
        const iconHeight = 38;
        const iconPadding = 10;
        
        // Calculate icon dimensions
        let iconWidth = 0;
        if (iconImg) {
          const iconScale = iconHeight / iconImg.height;
          iconWidth = iconImg.width * iconScale;
        }
        
        // Calculate text width
        ctx.font = "bold 22px Arial, sans-serif";
        const textWidth = ctx.measureText(textContent).width;
        
        // Total width includes icon + gap + text + padding
        const gap = iconImg ? 10 : 0;
        const totalWidth = iconPadding + iconWidth + gap + textWidth + iconPadding + 10;
        
        // Position in bottom right corner
        const bgX = finalCanvas.width - totalWidth - watermarkPadding;
        const bgY = finalCanvas.height - bgHeight - watermarkPadding;
        const radius = 10;
        
        console.log("Watermark position:", bgX, bgY, "size:", totalWidth, bgHeight);
        
        // Draw white rounded rectangle background
        ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
        ctx.beginPath();
        ctx.moveTo(bgX + radius, bgY);
        ctx.lineTo(bgX + totalWidth - radius, bgY);
        ctx.arcTo(bgX + totalWidth, bgY, bgX + totalWidth, bgY + radius, radius);
        ctx.lineTo(bgX + totalWidth, bgY + bgHeight - radius);
        ctx.arcTo(bgX + totalWidth, bgY + bgHeight, bgX + totalWidth - radius, bgY + bgHeight, radius);
        ctx.lineTo(bgX + radius, bgY + bgHeight);
        ctx.arcTo(bgX, bgY + bgHeight, bgX, bgY + bgHeight - radius, radius);
        ctx.lineTo(bgX, bgY + radius);
        ctx.arcTo(bgX, bgY, bgX + radius, bgY, radius);
        ctx.closePath();
        ctx.fill();
        
        // Add subtle border
        ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
        ctx.lineWidth = 1;
        ctx.stroke();
        
        // Draw icon if loaded
        let textX = bgX + iconPadding;
        if (iconImg) {
          const iconY = bgY + (bgHeight - iconHeight) / 2;
          ctx.drawImage(iconImg, bgX + iconPadding, iconY, iconWidth, iconHeight);
          textX = bgX + iconPadding + iconWidth + gap;
        }
        
        // Draw text
        ctx.fillStyle = "#1e3a5f";
        ctx.font = "bold 22px Arial, sans-serif";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        ctx.fillText(textContent, textX, bgY + bgHeight / 2);
        
        console.log("Watermark drawn successfully with icon:", !!iconImg);
      }

      // Export as PNG from the final canvas with watermark
      const dataUrl = finalCanvas.toDataURL("image/png");
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
