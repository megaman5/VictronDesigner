import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TopBar } from "@/components/TopBar";
import { ComponentLibrary } from "@/components/ComponentLibrary";
import { SchematicCanvas } from "@/components/SchematicCanvas";
import { PropertiesPanel } from "@/components/PropertiesPanel";
import { DesignReviewPanel } from "@/components/DesignReviewPanel";
import { AIPromptDialog } from "@/components/AIPromptDialog";
import { ExportDialog } from "@/components/ExportDialog";
import { FeedbackDialog } from "@/components/FeedbackDialog";
import { SaveDesignDialog } from "@/components/SaveDesignDialog";
import { OpenDesignDialog } from "@/components/OpenDesignDialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { trackAction } from "@/lib/tracking";
import { AlertTriangle } from "lucide-react";
import type { Schematic, SchematicComponent, Wire, WireCalculation, ValidationResult } from "@shared/schema";

interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
}

export default function SchematicDesigner() {
  const { toast } = useToast();
  const [currentSchematicId, setCurrentSchematicId] = useState<string | null>(null);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [designQualitySheetOpen, setDesignQualitySheetOpen] = useState(false);
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [openDialogOpen, setOpenDialogOpen] = useState(false);

  // User auth state
  const [user, setUser] = useState<AuthUser | null>(null);
  const [currentDesignId, setCurrentDesignId] = useState<string | null>(null);
  const [currentDesignName, setCurrentDesignName] = useState<string | null>(null);
  const [selectedComponent, setSelectedComponent] = useState<SchematicComponent | null>(null);
  const [selectedWire, setSelectedWire] = useState<Wire | null>(null);
  const [wireCalculation, setWireCalculation] = useState<WireCalculation | undefined>();
  const [draggedComponentType, setDraggedComponentType] = useState<string | null>(null);
  const [wireConnectionMode, setWireConnectionMode] = useState(false);
  const [wireStartComponent, setWireStartComponent] = useState<string | null>(null);

  // Initialize state from localStorage if available (lazy initialization)
  const initializeState = () => {
    // Only restore if no other design is being loaded
    const hasFeedbackState = localStorage.getItem("loadedFeedbackState");
    const hasPendingAuth = localStorage.getItem("pendingAuthDiagramState");
    
    if (hasFeedbackState || hasPendingAuth) {
      return { components: [], wires: [], systemVoltage: 12 };
    }
    
    const autoSavedState = localStorage.getItem("autoSavedDiagramState");
    if (autoSavedState) {
      try {
        const state = JSON.parse(autoSavedState);
        // Only restore if it was saved within the last 24 hours
        const savedAt = new Date(state.savedAt);
        const now = new Date();
        const oneDay = 24 * 60 * 60 * 1000;
        
        if (now.getTime() - savedAt.getTime() < oneDay) {
          console.log("Restoring auto-saved diagram state on mount:", {
            components: state.components?.length || 0,
            wires: state.wires?.length || 0,
          });
          return {
            components: state.components || [],
            wires: state.wires || [],
            systemVoltage: state.systemVoltage || 12,
          };
        } else {
          console.log("Auto-saved state is too old, clearing");
          localStorage.removeItem("autoSavedDiagramState");
        }
      } catch (error) {
        console.error("Error parsing auto-saved state:", error);
        localStorage.removeItem("autoSavedDiagramState");
      }
    }
    
    return { components: [], wires: [], systemVoltage: 12 };
  };

  // Local state for editing - initialized from localStorage if available
  const initialState = initializeState();
  const [components, setComponents] = useState<SchematicComponent[]>(initialState.components);
  const [wires, setWires] = useState<Wire[]>(initialState.wires);
  const [systemVoltage, setSystemVoltage] = useState(initialState.systemVoltage);

  // Validation state
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  // Iteration progress for AI generation
  const [iterationProgress, setIterationProgress] = useState<{
    iteration: number;
    maxIterations: number;
    score?: number;
    errorCount?: number;
    warningCount?: number;
    isBest?: boolean;
  } | null>(null);

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

  // Check auth status on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch("/auth/user");
        if (response.ok) {
          const userData = await response.json();
          setUser(userData);
        }
      } catch (error) {
        console.error("Auth check failed:", error);
      }
    };
    checkAuth();
  }, []);

  // Load feedback state from localStorage if available
  useEffect(() => {
    const loadedState = localStorage.getItem("loadedFeedbackState");
    if (loadedState) {
      try {
        const state = JSON.parse(loadedState);
        setComponents(state.components || []);
        setWires(state.wires || []);
        setSystemVoltage(state.systemVoltage || 12);
        
        // Clear the loaded state
        localStorage.removeItem("loadedFeedbackState");
        
        toast({
          title: "Feedback state loaded",
          description: `Loaded design with ${state.components?.length || 0} components and ${state.wires?.length || 0} wires`,
        });
      } catch (error) {
        console.error("Error loading feedback state:", error);
      }
    }
  }, []);

  // Restore diagram state after returning from OAuth login
  useEffect(() => {
    const pendingState = localStorage.getItem("pendingAuthDiagramState");
    if (pendingState) {
      try {
        const state = JSON.parse(pendingState);
        // Only restore if it was saved recently (within 5 minutes)
        const savedAt = new Date(state.savedAt);
        const now = new Date();
        const fiveMinutes = 5 * 60 * 1000;
        
        if (now.getTime() - savedAt.getTime() < fiveMinutes) {
          setComponents(state.components || []);
          setWires(state.wires || []);
          setSystemVoltage(state.systemVoltage || 12);
          
          toast({
            title: "Diagram restored",
            description: `Your design with ${state.components?.length || 0} components has been restored`,
          });
        }
        
        // Clear the pending state
        localStorage.removeItem("pendingAuthDiagramState");
      } catch (error) {
        console.error("Error restoring diagram state:", error);
        localStorage.removeItem("pendingAuthDiagramState");
      }
    }
  }, []);

  // Auto-save diagram state to localStorage periodically
  useEffect(() => {
    // Only auto-save if there's actual content
    if (components.length === 0 && wires.length === 0) {
      // Clear auto-save if diagram is empty
      localStorage.removeItem("autoSavedDiagramState");
      return;
    }

    // Debounce the save to avoid too many writes
    const timeoutId = setTimeout(() => {
      const diagramState = {
        components,
        wires,
        systemVoltage,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem("autoSavedDiagramState", JSON.stringify(diagramState));
      console.log("Auto-saved diagram state:", { 
        components: components.length, 
        wires: wires.length,
        systemVoltage 
      });
    }, 2000); // Save 2 seconds after last change

    return () => clearTimeout(timeoutId);
  }, [components, wires, systemVoltage]);

  // Force immediate save before page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (components.length > 0 || wires.length > 0) {
        const diagramState = {
          components,
          wires,
          systemVoltage,
          savedAt: new Date().toISOString(),
        };
        // Use synchronous storage API for beforeunload
        try {
          localStorage.setItem("autoSavedDiagramState", JSON.stringify(diagramState));
          console.log("Force-saved diagram state before unload");
        } catch (e) {
          console.error("Failed to save before unload:", e);
        }
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [components, wires, systemVoltage]);

  // Show toast notification if state was restored from localStorage
  useEffect(() => {
    // Only show toast if we have components/wires on initial mount and no schematic is being loaded
    if (components.length > 0 && !currentSchematicId) {
      // Check if there's a matching auto-save (likely what we just restored)
      const autoSavedState = localStorage.getItem("autoSavedDiagramState");
      if (autoSavedState) {
        try {
          const state = JSON.parse(autoSavedState);
          // If the counts match, we likely restored this
          if (state.components?.length === components.length && state.wires?.length === wires.length) {
            // Use a small delay to ensure toast system is ready
            setTimeout(() => {
              toast({
                title: "Auto-saved design restored",
                description: `Restored your previous work with ${components.length} components`,
              });
            }, 100);
          }
        } catch (e) {
          // Ignore errors
        }
      }
    }
  }, []); // Only run once on mount

  // Login/logout handlers
  const handleLogin = () => {
    // Save current diagram state to localStorage before redirecting to OAuth
    if (components.length > 0 || wires.length > 0) {
      const diagramState = {
        components,
        wires,
        systemVoltage,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem("pendingAuthDiagramState", JSON.stringify(diagramState));
    }
    window.location.href = `/auth/google?returnTo=${encodeURIComponent(window.location.pathname)}`;
  };

  const handleLogout = async () => {
    try {
      await fetch("/auth/logout", { method: "POST" });
      setUser(null);
      toast({
        title: "Signed out",
        description: "You have been signed out",
      });
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  // Handle loading a saved design
  const handleLoadDesign = (design: {
    id: string;
    name: string;
    components: any[];
    wires: any[];
    systemVoltage: number;
  }) => {
    // Track load action
    trackAction("load_design", "load", {
      designId: design.id,
      componentCount: design.components.length,
      wireCount: design.wires.length,
      systemVoltage: design.systemVoltage,
    });
    
    // Clear auto-save when explicitly loading a saved design
    localStorage.removeItem("autoSavedDiagramState");
    
    setComponents(design.components);
    setWires(design.wires);
    setSystemVoltage(design.systemVoltage);
    setCurrentDesignId(design.id);
    setCurrentDesignName(design.name);
    setSelectedComponent(null);
    setSelectedWire(null);
  };

  // Handle design saved
  const handleDesignSaved = (designId: string, name: string) => {
    // Track save action
    trackAction("save_design", "save", {
      designId,
      componentCount: components.length,
      wireCount: wires.length,
      systemVoltage,
    });
    
    setCurrentDesignId(designId);
    setCurrentDesignName(name);
  };

  // Auto-validate design when components or wires change
  useEffect(() => {
    const timer = setTimeout(() => {
      validateDesign();
    }, 500); // Debounce validation

    return () => clearTimeout(timer);
  }, [components, wires, systemVoltage]);

  // Validation function
  const validateDesign = async () => {
    if (components.length === 0 && wires.length === 0) {
      setValidationResult(null);
      return;
    }

    try {
      const response = await fetch("/api/validate-design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ components, wires, systemVoltage }),
      });

      if (!response.ok) {
        throw new Error("Validation failed");
      }

      const result: ValidationResult = await response.json();
      setValidationResult(result);
    } catch (error) {
      console.error("Validation error:", error);
    }
  };

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

  // AI generation with SSE streaming
  const [isAiGenerating, setIsAiGenerating] = useState(false);

  const handleAIGenerateWithStreaming = async (prompt: string) => {
    setIsAiGenerating(true);
    setIterationProgress(null);

    // Track AI generation action
    const isIterating = components.length > 0;
    
    // Clear auto-save when starting a completely new design (not iterating)
    if (!isIterating) {
      localStorage.removeItem("autoSavedDiagramState");
    }
    
    trackAction(isIterating ? "ai_iterate_design" : "ai_generate_system", "action", {
      promptLength: prompt.length,
      systemVoltage,
      existingComponents: components.length,
    });

    try {
      const response = await fetch("/api/ai-generate-system-stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          systemVoltage,
          minQualityScore: 70,
          maxIterations: 5,
          // Include existing design context when iterating
          existingDesign: isIterating ? {
            components,
            wires,
          } : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate system");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEventType = ""; // Move outside while loop to persist across chunks

      if (!reader) {
        throw new Error("No response body");
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEventType = line.substring(6).trim();
            continue;
          }

          if (line.startsWith("data:")) {
            const data = JSON.parse(line.substring(5).trim());

            if (currentEventType === "iteration-start") {
              setIterationProgress({
                iteration: data.iteration,
                maxIterations: data.maxIterations,
              });
            } else if (currentEventType === "iteration-complete") {
              setIterationProgress({
                iteration: data.iteration,
                maxIterations: data.maxIterations,
                score: data.score,
                errorCount: data.errorCount,
                warningCount: data.warningCount,
                isBest: data.isBest,
              });
            } else if (currentEventType === "complete") {
              console.log("AI Generated System - Full Data:", data);
              console.log("Components count:", data.components?.length || 0);
              console.log("Wires count:", data.wires?.length || 0);
              console.log("Components:", data.components);
              console.log("Wires:", data.wires);

              setComponents(data.components || []);

              const wiresWithIds = (data.wires || []).map((wire: any, index: number) => ({
                ...wire,
                id: `wire-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
              }));

              setWires(wiresWithIds);
              toast({
                title: "System Generated",
                description: `Design complete! ${data.components?.length || 0} components, ${data.wires?.length || 0} wires. Quality score: ${data.validation?.score || 'N/A'}`,
              });
              setAiDialogOpen(false);
              setIterationProgress(null);
            } else if (currentEventType === "error") {
              console.error("AI generation error:", data.error);
              toast({
                title: "AI Generation Failed",
                description: data.error || "Failed to generate a valid design. Please try again with a simpler prompt.",
                variant: "destructive",
              });
              setAiDialogOpen(false);
              setIterationProgress(null);
            }

            currentEventType = "";
          }
        }
      }
    } catch (error: any) {
      console.error("AI generation error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to generate system",
        variant: "destructive",
      });
      setIterationProgress(null);
    } finally {
      setIsAiGenerating(false);
    }
  };

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
    // Validate connection
    const fromComp = components.find(c => c.id === wireData.fromComponentId);
    const toComp = components.find(c => c.id === wireData.toComponentId);

    if (fromComp && toComp) {
      const { validateConnection } = await import("@shared/rules");
      const validation = validateConnection(
        fromComp,
        wireData.fromTerminal.id,
        toComp,
        wireData.toTerminal.id
      );

      if (!validation.valid) {
        toast({
          title: "Invalid Connection",
          description: validation.message,
          variant: "destructive",
        });
        setWireStartComponent(null);
        setWireConnectionMode(false);
        return;
      }
    }

    // Determine polarity based on terminal types
    let polarity: "positive" | "negative" | "neutral" | "ground" = "positive";
    const t1 = wireData.fromTerminal.type;
    const t2 = wireData.toTerminal.type;

    if (t1 === "negative" || t2 === "negative" || t1 === "pv-negative" || t2 === "pv-negative") {
      polarity = "negative";
    } else if (t1 === "ground" || t2 === "ground") {
      polarity = "ground";
    } else if (t1 === "ac-in" || t2 === "ac-in" || t1 === "ac-out" || t2 === "ac-out") {
      // Check for specific AC types if available (hot/neutral)
      // This is a simplification, ideally we track hot/neutral explicitly
      if (wireData.fromTerminal.id.includes("neutral") || wireData.toTerminal.id.includes("neutral")) {
        polarity = "neutral";
      } else {
        // Default to positive color for Hot lines if not explicitly neutral/ground
        polarity = "positive";
      }
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

  const handleWireUpdate = (wireId: string, updates: Partial<Wire>) => {
    setWires(prev => prev.map(w => w.id === wireId ? { ...w, ...updates } : w));
    if (selectedWire?.id === wireId) {
      setSelectedWire(prev => prev ? { ...prev, ...updates } : null);
    }
  };


  const handleExport = async (options: { wiringDiagram: boolean; shoppingList: boolean; wireLabels: boolean; format: string }) => {
    // Track export action
    trackAction("export", "export", {
      wiringDiagram: options.wiringDiagram,
      shoppingList: options.shoppingList,
      wireLabels: options.wireLabels,
      format: options.format,
      componentCount: components.length,
      wireCount: wires.length,
    });

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

  // Create wire validation status mapping for canvas rendering
  const wireValidationStatus = new Map<string, "error" | "warning">();
  validationResult?.issues.forEach(issue => {
    if (issue.wireIds && issue.category === "wire-sizing") {
      // Only show error/warning for wire sizing issues
      issue.wireIds.forEach(wireId => {
        if (issue.severity === "error") {
          wireValidationStatus.set(wireId, "error");
        } else if (issue.severity === "warning" && !wireValidationStatus.has(wireId)) {
          // Only set warning if not already marked as error
          wireValidationStatus.set(wireId, "warning");
        }
      });
    }
    // Also check wireId (singular) for compatibility
    if (issue.wireId) {
      if (issue.severity === "error") {
        wireValidationStatus.set(issue.wireId, "error");
      } else if (issue.severity === "warning" && !wireValidationStatus.has(issue.wireId)) {
        wireValidationStatus.set(issue.wireId, "warning");
      }
    }
  });

  // Create component validation status mapping for canvas rendering
  const componentValidationStatus = new Map<string, "error" | "warning">();
  validationResult?.issues.forEach(issue => {
    if (issue.componentIds) {
      issue.componentIds.forEach(componentId => {
        if (issue.severity === "error") {
          componentValidationStatus.set(componentId, "error");
        } else if (issue.severity === "warning" && !componentValidationStatus.has(componentId)) {
          // Only set warning if not already marked as error
          componentValidationStatus.set(componentId, "warning");
        }
      });
    }
  });

  return (
    <div className="h-screen flex flex-col bg-background">
      <TopBar
        onAIPrompt={() => setAiDialogOpen(true)}
        onAIWire={() => aiWireMutation.mutate()}
        onExport={() => setExportDialogOpen(true)}
        onSave={() => setSaveDialogOpen(true)}
        onOpen={() => setOpenDialogOpen(true)}
        onWireMode={() => setWireConnectionMode(!wireConnectionMode)}
        onDesignQuality={() => setDesignQualitySheetOpen(true)}
        onFeedback={() => setFeedbackDialogOpen(true)}
        onLogin={handleLogin}
        onLogout={handleLogout}
        wireMode={wireConnectionMode}
        hasComponents={components.length > 0}
        designQualityScore={validationResult?.score}
        user={user}
        currentDesignName={currentDesignName || undefined}
        isAIWiring={aiWireMutation.isPending}
      />

      {/* Alpha Warning Banner */}
      <div className="px-4 pt-3 pb-0">
        <Alert variant="default" className="border-yellow-500/50 bg-yellow-500/10">
          <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-500" />
          <AlertTitle className="text-yellow-800 dark:text-yellow-400">Alpha Version</AlertTitle>
          <AlertDescription className="text-yellow-700 dark:text-yellow-500">
            This tool is in active development. Sign in to save your designs. Please report any bugs using the Feedback button!
          </AlertDescription>
        </Alert>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <ComponentLibrary
          onDragStart={(comp) => setDraggedComponentType(comp.id)}
          onAddCustom={() => console.log("Add custom")}
        />

        <SchematicCanvas
          components={components}
          wires={wires}
          wireValidationStatus={wireValidationStatus}
          componentValidationStatus={componentValidationStatus}
          onComponentsChange={setComponents}
          onWiresChange={setWires}
          onComponentSelect={handleComponentSelect}
          onWireSelect={handleWireSelect}
          onDrop={handleComponentDrop}
          onComponentMove={handleComponentMove}
          onComponentDelete={handleComponentDelete}
          onWireConnectionComplete={handleWireConnectionComplete}
          onWireDelete={handleWireDelete}
          onWireUpdate={handleWireUpdate}
          wireConnectionMode={wireConnectionMode}
          wireStartComponent={wireStartComponent}
        />

        <PropertiesPanel
          selectedComponent={selectedComponent ? {
            id: selectedComponent.id,
            type: selectedComponent.type,
            name: selectedComponent.name,
            properties: selectedComponent.properties,
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
          validationResult={validationResult}
          onUpdateWire={handleWireUpdate}
          onUpdateComponent={(id, updates) => {
            setComponents(prev => prev.map(comp => {
              if (comp.id === id) {
                const updatedComp = { ...comp, ...updates };
                // Also update selected component state to reflect changes immediately
                if (selectedComponent?.id === id) {
                  setSelectedComponent(updatedComp);
                }
                return updatedComp;
              }
              return comp;
            }));

            // Trigger wire recalculation if properties changed
            if (updates.properties) {
              // Find connected wires and recalculate
              const connectedWires = wires.filter(
                (w) => w.fromComponentId === id || w.toComponentId === id
              );
              if (connectedWires.length > 0) {
                calculateWire(connectedWires[0]);
              }
            }
          }}
        />
      </div>

      <AIPromptDialog
        open={aiDialogOpen}
        onOpenChange={setAiDialogOpen}
        onGenerate={(prompt) => handleAIGenerateWithStreaming(prompt)}
        isGenerating={isAiGenerating}
        iterationProgress={iterationProgress}
        isIterating={components.length > 0}
        existingComponentsCount={components.length}
      />

      <ExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        components={components}
        wires={wires}
        systemVoltage={systemVoltage}
        designName={currentDesignName || "Design"}
      />

      <FeedbackDialog
        open={feedbackDialogOpen}
        onOpenChange={setFeedbackDialogOpen}
        components={components}
        wires={wires}
        systemVoltage={systemVoltage}
      />

      <SaveDesignDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        components={components}
        wires={wires}
        systemVoltage={systemVoltage}
        existingDesignId={currentDesignId || undefined}
        existingName={currentDesignName || undefined}
        onSaved={handleDesignSaved}
      />

      <OpenDesignDialog
        open={openDialogOpen}
        onOpenChange={setOpenDialogOpen}
        onLoad={handleLoadDesign}
      />


      <Sheet open={designQualitySheetOpen} onOpenChange={setDesignQualitySheetOpen}>
        <SheetContent side="right" className="w-full sm:w-[700px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Design Quality Review</SheetTitle>
          </SheetHeader>
          <div className="mt-6">
            <DesignReviewPanel
              components={components}
              wires={wires}
              systemVoltage={systemVoltage}
              validationResult={validationResult}
              onValidate={validateDesign}
              onIssueClick={(issue) => {
                console.log("Issue clicked:", issue);
                // TODO: Highlight affected components/wires
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
