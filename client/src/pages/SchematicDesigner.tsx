import { useState } from "react";
import { TopBar } from "@/components/TopBar";
import { ComponentLibrary } from "@/components/ComponentLibrary";
import { SchematicCanvas } from "@/components/SchematicCanvas";
import { PropertiesPanel } from "@/components/PropertiesPanel";
import { AIPromptDialog } from "@/components/AIPromptDialog";
import { ExportDialog } from "@/components/ExportDialog";

export default function SchematicDesigner() {
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [selectedComponent, setSelectedComponent] = useState<any>(null);

  const mockWireCalculation = {
    current: 100,
    length: 15,
    voltage: 12,
    recommendedGauge: "4 AWG",
    voltageDrop: 2.1,
    status: "valid" as const,
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <TopBar
        onAIPrompt={() => setAiDialogOpen(true)}
        onExport={() => setExportDialogOpen(true)}
        onSave={() => console.log("Save project")}
        onOpen={() => console.log("Open project")}
      />

      <div className="flex-1 flex overflow-hidden">
        <ComponentLibrary
          onDragStart={(comp) => console.log("Dragging:", comp.name)}
          onAddCustom={() => console.log("Add custom")}
        />

        <SchematicCanvas
          onComponentSelect={(comp) => {
            console.log("Selected:", comp.name);
            setSelectedComponent({
              name: comp.name,
              voltage: 12,
              current: 100,
              power: 1200,
            });
          }}
          onDrop={(x, y) => console.log("Dropped at:", x, y)}
        />

        <PropertiesPanel
          selectedComponent={selectedComponent}
          wireCalculation={selectedComponent ? mockWireCalculation : undefined}
        />
      </div>

      <AIPromptDialog
        open={aiDialogOpen}
        onOpenChange={setAiDialogOpen}
        onGenerate={(prompt) => console.log("Generate from:", prompt)}
      />

      <ExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        onExport={(options) => console.log("Export:", options)}
      />
    </div>
  );
}
