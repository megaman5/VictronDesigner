import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TopBar } from "@/components/TopBar";
import { ComponentLibrary } from "@/components/ComponentLibrary";
import { SchematicCanvas } from "@/components/SchematicCanvas";
import { PropertiesPanel } from "@/components/PropertiesPanel";
import { AIPromptDialog } from "@/components/AIPromptDialog";
import { ExportDialog } from "@/components/ExportDialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Schematic, SchematicComponent, Wire, WireCalculation } from "@shared/schema";

export default function SchematicDesigner() {
  const { toast } = useToast();
  const [currentSchematicId, setCurrentSchematicId] = useState<string | null>(null);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [selectedComponent, setSelectedComponent] = useState<SchematicComponent | null>(null);
  const [wireCalculation, setWireCalculation] = useState<WireCalculation | undefined>();
  
  // Local state for editing
  const [components, setComponents] = useState<SchematicComponent[]>([]);
  const [wires, setWires] = useState<Wire[]>([]);
  const [systemVoltage, setSystemVoltage] = useState(12);

  // Load schematic
  const { data: schematic } = useQuery<Schematic>({
    queryKey: ["/api/schematics", currentSchematicId],
    enabled: !!currentSchematicId,
  });

  // Update local state when schematic loads
  useEffect(() => {
    if (schematic) {
      setComponents(schematic.components as SchematicComponent[]);
      setWires(schematic.wires as Wire[]);
      setSystemVoltage(schematic.systemVoltage);
    }
  }, [schematic]);

  // Save schematic mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (currentSchematicId) {
        const res = await apiRequest("PATCH", `/api/schematics/${currentSchematicId}`, {
          components,
          wires,
          systemVoltage,
        });
        return res.json();
      } else {
        const res = await apiRequest("POST", "/api/schematics", {
          name: "Untitled Schematic",
          systemVoltage,
          components,
          wires,
        });
        const result = await res.json();
        setCurrentSchematicId(result.id);
        return result;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schematics"] });
      toast({
        title: "Saved",
        description: "Schematic saved successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save schematic",
        variant: "destructive",
      });
    },
  });

  // AI generation mutation
  const aiGenerateMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await apiRequest("POST", "/api/ai-generate-system", {
        prompt,
        systemVoltage,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setComponents(data.components || []);
      setWires(data.wires || []);
      toast({
        title: "System Generated",
        description: data.description || "AI has generated your electrical system",
      });
      setAiDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to generate system",
        variant: "destructive",
      });
    },
  });

  // Wire calculation
  const calculateWire = async (wire: Wire) => {
    try {
      const res = await apiRequest("POST", "/api/calculate-wire", {
        current: wire.current || 10,
        length: wire.length,
        voltage: systemVoltage,
      });
      const result = await res.json();
      setWireCalculation(result);
    } catch (error: any) {
      console.error("Wire calculation error:", error);
    }
  };

  const handleComponentSelect = (comp: SchematicComponent) => {
    setSelectedComponent(comp);
    
    // Find wires connected to this component
    const connectedWires = wires.filter(
      (w) => w.fromComponentId === comp.id || w.toComponentId === comp.id
    );
    
    if (connectedWires.length > 0) {
      calculateWire(connectedWires[0]);
    } else {
      setWireCalculation(undefined);
    }
  };

  const handleExport = async (options: { wiringDiagram: boolean; shoppingList: boolean; wireLabels: boolean; format: string }) => {
    if (!currentSchematicId) {
      toast({
        title: "Error",
        description: "Please save your schematic first",
        variant: "destructive",
      });
      return;
    }

    try {
      if (options.shoppingList) {
        window.open(`/api/export/shopping-list-csv/${currentSchematicId}`, "_blank");
      }
      if (options.wireLabels) {
        const res = await apiRequest("GET", `/api/export/wire-labels/${currentSchematicId}`);
        const labels = await res.json();
        console.log("Wire labels:", labels);
        toast({
          title: "Wire Labels",
          description: "Wire labels generated (check console)",
        });
      }
      if (options.wiringDiagram) {
        window.open(`/api/export/system-report/${currentSchematicId}`, "_blank");
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Export failed",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <TopBar
        onAIPrompt={() => setAiDialogOpen(true)}
        onExport={() => setExportDialogOpen(true)}
        onSave={() => saveMutation.mutate()}
        onOpen={() => console.log("Open project")}
      />

      <div className="flex-1 flex overflow-hidden">
        <ComponentLibrary
          onDragStart={(comp) => console.log("Dragging:", comp.name)}
          onAddCustom={() => console.log("Add custom")}
        />

        <SchematicCanvas
          components={components}
          wires={wires}
          onComponentsChange={setComponents}
          onWiresChange={setWires}
          onComponentSelect={handleComponentSelect}
          onDrop={(x, y) => console.log("Dropped at:", x, y)}
        />

        <PropertiesPanel
          selectedComponent={selectedComponent ? {
            name: selectedComponent.name,
            voltage: selectedComponent.properties?.voltage,
            current: selectedComponent.properties?.current,
            power: selectedComponent.properties?.power,
          } : undefined}
          wireCalculation={wireCalculation ? {
            current: wireCalculation.current,
            length: wireCalculation.length,
            voltage: wireCalculation.voltage,
            recommendedGauge: wireCalculation.recommendedGauge,
            voltageDrop: wireCalculation.actualVoltageDrop,
            status: wireCalculation.status === "invalid" ? "error" : wireCalculation.status,
          } : undefined}
        />
      </div>

      <AIPromptDialog
        open={aiDialogOpen}
        onOpenChange={setAiDialogOpen}
        onGenerate={(prompt) => aiGenerateMutation.mutate(prompt)}
      />

      <ExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        onExport={handleExport}
      />
    </div>
  );
}
