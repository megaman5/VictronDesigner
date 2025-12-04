import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TopBar } from "@/components/TopBar";
import { ComponentLibrary } from "@/components/ComponentLibrary";
import { SchematicCanvas } from "@/components/SchematicCanvas";
import { PropertiesPanel } from "@/components/PropertiesPanel";
import { AIPromptDialog } from "@/components/AIPromptDialog";
import { ExportDialog } from "@/components/ExportDialog";
import { DesignReviewPanel } from "@/components/DesignReviewPanel";
import { IterationProgress } from "@/components/IterationProgress";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Schematic, SchematicComponent, Wire, WireCalculation, ValidationIssue } from "@shared/schema";

export default function SchematicDesigner() {
  const { toast } = useToast();
  const [currentSchematicId, setCurrentSchematicId] = useState<string | null>(null);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [designReviewOpen, setDesignReviewOpen] = useState(false);
  const [selectedComponent, setSelectedComponent] = useState<SchematicComponent | null>(null);
  const [selectedWire, setSelectedWire] = useState<Wire | null>(null);
  const [wireCalculation, setWireCalculation] = useState<WireCalculation | undefined>();
  const [draggedComponentType, setDraggedComponentType] = useState<string | null>(null);
  const [wireConnectionMode, setWireConnectionMode] = useState(false);
  const [wireStartComponent, setWireStartComponent] = useState<string | null>(null);
  
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

  // AI generation mutation with iterative quality improvement
  const [iterationStatus, setIterationStatus] = useState<{
    currentIteration: number;
    maxIterations: number;
    currentScore: number;
    status: string;
  } | null>(null);

  const aiGenerateMutation = useMutation({
    mutationFn: async (prompt: string) => {
      // Show initial status
      setIterationStatus({
        currentIteration: 0,
        maxIterations: 3,
        currentScore: 0,
        status: "🎨 Generating initial design...",
      });

      const res = await apiRequest("POST", "/api/ai-generate-system-iterative", {
        prompt,
        systemVoltage,
        minQualityScore: 70,
        maxIterations: 3,
      });
      return res.json();
    },
    onSuccess: (data) => {
      console.log("AI Generated System:", data);
      console.log("Components:", data.components);
      console.log("Wires:", data.wires);
      console.log("Iteration History:", data.iterationHistory);

      setComponents(data.components || []);

      // Generate unique IDs for the wires
      const wiresWithIds = (data.wires || []).map((wire: any, index: number) => ({
        ...wire,
        id: `wire-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
      }));

      setWires(wiresWithIds);

      // Show final iteration status
      const finalScore = data.validation?.score || 0;
      const iterations = data.finalIteration || 1;

      setIterationStatus({
        currentIteration: iterations,
        maxIterations: 3,
        currentScore: finalScore,
        status: data.achievedQualityThreshold
          ? `✅ Design optimized!`
          : `⚠️ Best effort design`,
      });

      // Show detailed success message
      const iterationSummary = data.iterationHistory
        ?.map((h: any, i: number) => `Iteration ${i + 1}: ${h.score}/100 (${h.errorCount} errors, ${h.warningCount} warnings)`)
        .join('\n') || '';

      toast({
        title: data.achievedQualityThreshold ? "✅ High-Quality Design Generated" : "⚠️ Design Generated",
        description: `Quality Score: ${finalScore}/100\nIterations: ${iterations}\n\n${data.description || ''}`,
        duration: 10000,
      });

      // Clear status after a delay
      setTimeout(() => setIterationStatus(null), 8000);
      setAiDialogOpen(false);
    },
    onError: (error: any) => {
      setIterationStatus(null);
      toast({
        title: "Error",
        description: error.message || "Failed to generate system",
        variant: "destructive",
      });
    },
  });

  // AI wire generation mutation
  const aiWireMutation = useMutation({
    mutationFn: async () => {
      if (components.length === 0) {
        throw new Error("Please add components to the canvas first");
      }
      
      const res = await apiRequest("POST", "/api/ai-wire-components", {
        components,
        systemVoltage,
      });
      return res.json();
    },
    onSuccess: (data) => {
      console.log("AI Generated Wires:", data);
      
      // Generate unique IDs for the new wires
      const newWires = (data.wires || []).map((wire: any, index: number) => ({
        ...wire,
        id: `wire-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
      }));
      
      console.log("Setting wires with IDs:", newWires.map((w: Wire) => ({ id: w.id, from: w.fromComponentId, to: w.toComponentId })));
      
      setWires(newWires);
      toast({
        title: "Wiring Generated",
        description: data.description || "AI has wired your components",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to generate wiring",
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
    setSelectedWire(null); // Clear wire selection
    
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

  const handleWireSelect = (wire: Wire) => {
    setSelectedWire(wire);
    setSelectedComponent(null); // Clear component selection
    calculateWire(wire);
  };

  const handleComponentDrop = (x: number, y: number) => {
    if (!draggedComponentType) return;
    
    const newComponent: SchematicComponent = {
      id: `comp-${Date.now()}`,
      type: draggedComponentType,
      name: draggedComponentType.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      x,
      y,
      properties: {},
    };
    
    setComponents(prev => [...prev, newComponent]);
    setDraggedComponentType(null);
  };

  const handleComponentMove = (componentId: string, deltaX: number, deltaY: number) => {
    setComponents(prev => prev.map(comp => 
      comp.id === componentId 
        ? { ...comp, x: comp.x + deltaX, y: comp.y + deltaY }
        : comp
    ));
  };

  const handleComponentDelete = (componentId: string) => {
    setComponents(prev => prev.filter(c => c.id !== componentId));
    setWires(prev => prev.filter(w => w.fromComponentId !== componentId && w.toComponentId !== componentId));
    if (selectedComponent?.id === componentId) {
      setSelectedComponent(null);
    }
  };

  const handleWireConnectionComplete = async (wireData: import("@/components/SchematicCanvas").WireConnectionData) => {
    // Determine polarity based on terminal types
    let polarity: "positive" | "negative" | "neutral" | "ground" = "positive";
    if (wireData.toTerminal.type === "negative" || wireData.fromTerminal.type === "negative") {
      polarity = "negative";
    } else if (wireData.toTerminal.type === "ground" || wireData.fromTerminal.type === "ground") {
      polarity = "ground";
    } else if (wireData.toTerminal.type === "ac-in" || wireData.toTerminal.type === "ac-out") {
      polarity = "neutral";
    }
    
    // Try to calculate optimal wire gauge based on components
    let calculatedGauge = "10 AWG"; // Default fallback
    
    try {
      // Get component properties to calculate current requirements
      const fromComp = components.find(c => c.id === wireData.fromComponentId);
      const toComp = components.find(c => c.id === wireData.toComponentId);
      
      // Estimate current based on component type and properties
      let estimatedCurrent = 10; // Default 10A
      if (fromComp?.properties.current) {
        estimatedCurrent = fromComp.properties.current;
      } else if (toComp?.properties.current) {
        estimatedCurrent = toComp.properties.current;
      } else if (fromComp?.properties.power && fromComp?.properties.voltage) {
        estimatedCurrent = fromComp.properties.power / fromComp.properties.voltage;
      }
      
      // Call wire calculation API
      const response = await apiRequest("POST", "/api/calculate-wire", {
        current: estimatedCurrent,
        length: wireData.length,
        voltage: 12, // Default to 12V, could be from schematic settings
        temperatureC: 30,
        conductorMaterial: "copper",
        insulationType: "75C",
        bundlingFactor: 0.8,
        maxVoltageDrop: 3,
      });
      
      const calculation = await response.json();
      if (calculation.recommendedGauge) {
        calculatedGauge = calculation.recommendedGauge;
      }
    } catch (error) {
      console.error("Wire calculation failed, using default gauge:", error);
    }
    
    const newWire: Wire = {
      id: `wire-${Date.now()}`,
      fromComponentId: wireData.fromComponentId,
      toComponentId: wireData.toComponentId,
      fromTerminal: wireData.fromTerminal.id,
      toTerminal: wireData.toTerminal.id,
      polarity,
      length: wireData.length,
      gauge: calculatedGauge,
    };
    
    setWires(prev => [...prev, newWire]);
    setWireStartComponent(null);
    setWireConnectionMode(false);
  };

  const handleWireDelete = (wireId: string) => {
    setWires(prev => prev.filter(w => w.id !== wireId));
  };

  const handleValidationIssueClick = (issue: ValidationIssue) => {
    // Highlight affected components
    if (issue.componentIds && issue.componentIds.length > 0) {
      const comp = components.find(c => c.id === issue.componentIds![0]);
      if (comp) {
        setSelectedComponent(comp);
      }
    }
    // Show issue details in toast
    toast({
      title: `${issue.severity.toUpperCase()}: ${issue.category}`,
      description: issue.message + (issue.suggestion ? `\n\n💡 ${issue.suggestion}` : ''),
      variant: issue.severity === 'error' ? 'destructive' : 'default',
      duration: 8000,
    });
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
      {/* Iteration Progress Overlay */}
      {iterationStatus && (
        <IterationProgress
          currentIteration={iterationStatus.currentIteration}
          maxIterations={iterationStatus.maxIterations}
          currentScore={iterationStatus.currentScore}
          status={iterationStatus.status}
        />
      )}

      <TopBar
        onAIPrompt={() => setAiDialogOpen(true)}
        onAIWire={() => aiWireMutation.mutate()}
        onExport={() => setExportDialogOpen(true)}
        onSave={() => saveMutation.mutate()}
        onOpen={() => console.log("Open project")}
        onWireMode={() => setWireConnectionMode(!wireConnectionMode)}
        wireMode={wireConnectionMode}
        onDesignReview={() => setDesignReviewOpen(!designReviewOpen)}
        designReviewOpen={designReviewOpen}
      />

      <div className="flex-1 flex overflow-hidden">
        <ComponentLibrary
          onDragStart={(comp) => setDraggedComponentType(comp.id)}
          onAddCustom={() => console.log("Add custom")}
        />

        <SchematicCanvas
          components={components}
          wires={wires}
          onComponentsChange={setComponents}
          onWiresChange={setWires}
          onComponentSelect={handleComponentSelect}
          onWireSelect={handleWireSelect}
          onDrop={handleComponentDrop}
          onComponentMove={handleComponentMove}
          onComponentDelete={handleComponentDelete}
          onWireConnectionComplete={handleWireConnectionComplete}
          onWireDelete={handleWireDelete}
          wireConnectionMode={wireConnectionMode}
          wireStartComponent={wireStartComponent}
        />

        {designReviewOpen ? (
          <div className="w-96 border-l bg-card p-4 overflow-auto">
            <DesignReviewPanel
              components={components}
              wires={wires}
              systemVoltage={systemVoltage}
              onIssueClick={handleValidationIssueClick}
            />
          </div>
        ) : (
          <PropertiesPanel
            selectedComponent={selectedComponent ? {
              id: selectedComponent.id,
              name: selectedComponent.name,
              voltage: selectedComponent.properties?.voltage,
              current: selectedComponent.properties?.current,
              power: selectedComponent.properties?.power,
            } : undefined}
            selectedWire={selectedWire ? {
              id: selectedWire.id,
              fromComponentId: selectedWire.fromComponentId,
              toComponentId: selectedWire.toComponentId,
              fromTerminal: selectedWire.fromTerminal,
              toTerminal: selectedWire.toTerminal,
              polarity: selectedWire.polarity,
              gauge: selectedWire.gauge,
              length: selectedWire.length,
            } : undefined}
            wireCalculation={wireCalculation ? {
              current: wireCalculation.current,
              length: wireCalculation.length,
              voltage: wireCalculation.voltage,
              recommendedGauge: wireCalculation.recommendedGauge,
              voltageDrop: wireCalculation.actualVoltageDrop,
              status: wireCalculation.status,
            } : undefined}
          />
        )}
      </div>

      <AIPromptDialog
        open={aiDialogOpen}
        onOpenChange={setAiDialogOpen}
        onGenerate={(prompt) => aiGenerateMutation.mutate(prompt)}
        isGenerating={aiGenerateMutation.isPending}
      />

      <ExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        onExport={handleExport}
      />
    </div>
  );
}
