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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { trackAction } from "@/lib/tracking";
import { getDefaultWireLength } from "@/lib/wire-length-defaults";
import { calculateWireSize } from "@/lib/wire-calculator";
import { AlertTriangle } from "lucide-react";
import { IterationProgress } from "@/components/IterationProgress";
import type { Schematic, SchematicComponent, Wire, WireCalculation, ValidationResult } from "@shared/schema";

// Infer system voltage from components
// Priority: battery > other DC components > default 12V
function inferSystemVoltage(components: SchematicComponent[]): number {
  if (components.length === 0) return 12; // Default
  
  // First, check batteries (most reliable indicator)
  const batteries = components.filter(c => c.type === 'battery');
  if (batteries.length > 0) {
    const batteryVoltages = batteries
      .map(b => b.properties?.voltage as number | undefined)
      .filter((v): v is number => v !== undefined && (v === 12 || v === 24 || v === 48));
    
    if (batteryVoltages.length > 0) {
      // Use most common battery voltage, or first if all same
      const voltageCounts = new Map<number, number>();
      batteryVoltages.forEach(v => {
        voltageCounts.set(v, (voltageCounts.get(v) || 0) + 1);
      });
      const mostCommon = Array.from(voltageCounts.entries())
        .sort((a, b) => b[1] - a[1])[0]?.[0];
      if (mostCommon) return mostCommon;
    }
  }
  
  // Then check other DC components (MPPT, DC loads, inverters, etc.)
  // Exclude AC components (ac-load, ac-panel) as they use AC voltage
  const dcComponents = components.filter(c => 
    c.type !== 'ac-load' && 
    c.type !== 'ac-panel' &&
    c.properties?.voltage !== undefined
  );
  
  if (dcComponents.length > 0) {
    const dcVoltages = dcComponents
      .map(c => c.properties?.voltage as number)
      .filter(v => v === 12 || v === 24 || v === 48); // Only valid DC system voltages
    
    if (dcVoltages.length > 0) {
      // Use most common voltage
      const voltageCounts = new Map<number, number>();
      dcVoltages.forEach(v => {
        voltageCounts.set(v, (voltageCounts.get(v) || 0) + 1);
      });
      const mostCommon = Array.from(voltageCounts.entries())
        .sort((a, b) => b[1] - a[1])[0]?.[0];
      if (mostCommon) return mostCommon;
    }
  }
  
  // Default to 12V if no valid voltage found
  return 12;
}

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
  const [wireCalculations, setWireCalculations] = useState<Record<string, WireCalculation>>({});
  const [draggedComponentType, setDraggedComponentType] = useState<string | null>(null);
  const [wireConnectionMode, setWireConnectionMode] = useState(false);
  const [wireStartComponent, setWireStartComponent] = useState<string | null>(null);
  const [showWireLabels, setShowWireLabels] = useState<boolean>(true);
  const [copiedComponents, setCopiedComponents] = useState<SchematicComponent[]>([]);
  const [copiedWires, setCopiedWires] = useState<Wire[]>([]);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

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
  // Infer system voltage from components (will be recalculated when components change)
  const [systemVoltage, setSystemVoltage] = useState(initialState.systemVoltage);
  
  // Update system voltage when components change
  useEffect(() => {
    const newVoltage = inferSystemVoltage(components);
    setSystemVoltage(newVoltage);
  }, [components]);

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
    // Token streaming state
    isStreaming?: boolean;
    tokenCount?: number;
    promptTokens?: number;
    completionTokens?: number;
    streamingText?: string;
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
      // System voltage will be inferred from components, but use saved value as initial
      const inferred = inferSystemVoltage(schematic.components || []);
      setSystemVoltage(inferred || schematic.systemVoltage || 12);
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
        // System voltage will be inferred from components
        const inferred = inferSystemVoltage(state.components || []);
        setSystemVoltage(inferred || state.systemVoltage || 12);
        
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
          // System voltage will be inferred from components
        const inferred = inferSystemVoltage(state.components || []);
        setSystemVoltage(inferred || state.systemVoltage || 12);
          
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
                isStreaming: false,
                streamingText: "",
                tokenCount: 0,
              });
            } else if (currentEventType === "ai-request-start") {
              setIterationProgress(prev => prev ? {
                ...prev,
                isStreaming: true,
                streamingText: "",
                tokenCount: 0,
                promptTokens: 0,
                completionTokens: 0,
              } : null);
            } else if (currentEventType === "ai-token") {
              setIterationProgress(prev => prev ? {
                ...prev,
                isStreaming: true,
                streamingText: (prev.streamingText || "") + (data.token || ""),
                tokenCount: data.accumulatedLength || 0,
              } : null);
            } else if (currentEventType === "ai-response-complete") {
              setIterationProgress(prev => prev ? {
                ...prev,
                isStreaming: false,
                promptTokens: data.promptTokens || 0,
                completionTokens: data.completionTokens || 0,
                tokenCount: data.totalTokens || 0,
              } : null);
            } else if (currentEventType === "iteration-complete") {
              setIterationProgress(prev => prev ? {
                ...prev,
                iteration: data.iteration,
                maxIterations: data.maxIterations,
                score: data.score,
                errorCount: data.errorCount,
                warningCount: data.warningCount,
                isBest: data.isBest,
                isStreaming: false,
              } : null);
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

  // Wire calculation - uses actual wire properties and connected load data
  // Helper function to calculate inverter DC input from AC loads
  const calculateInverterDCInput = (
    inverterId: string,
    inverterEfficiency: number = 0.875
  ): { acLoadWatts: number; dcInputWatts: number; dcInputCurrent: number; acVoltage: number } => {
    const inverter = components.find(c => c.id === inverterId);
    if (!inverter || (inverter.type !== "multiplus" && inverter.type !== "phoenix-inverter" && inverter.type !== "inverter")) {
      return { acLoadWatts: 0, dcInputWatts: 0, dcInputCurrent: 0, acVoltage: 120 };
    }

    const inverterACOutputTerminals = ["ac-out-hot", "ac-out-neutral"];
    let totalACWatts = 0;
    let acVoltage = 120;

    const findACLoads = (componentId: string, visited: Set<string> = new Set()): { watts: number; voltage: number } => {
      if (visited.has(componentId)) return { watts: 0, voltage: 120 };
      visited.add(componentId);

      const comp = components.find(c => c.id === componentId);
      if (!comp) return { watts: 0, voltage: 120 };

      if (comp.type === "ac-load") {
        const loadWatts = (comp.properties?.watts || comp.properties?.power || 0) as number;
        const loadVoltage = comp.properties?.acVoltage || comp.properties?.voltage || 120;
        return { watts: loadWatts, voltage: loadVoltage };
      }

      if (comp.type === "ac-panel") {
        let panelWatts = 0;
        let panelVoltage = 120;
        const panelWires = wires.filter(
          w => (w.fromComponentId === componentId || w.toComponentId === componentId) &&
               w.polarity === "hot"
        );
        
        const panelVisited = new Set<string>();
        for (const panelWire of panelWires) {
          const otherCompId = panelWire.fromComponentId === componentId 
            ? panelWire.toComponentId 
            : panelWire.fromComponentId;
          
          if (!panelVisited.has(otherCompId)) {
            panelVisited.add(otherCompId);
            const result = findACLoads(otherCompId, new Set(visited));
            panelWatts += result.watts;
            if (result.voltage !== 120) panelVoltage = result.voltage;
          }
        }
        return { watts: panelWatts, voltage: panelVoltage };
      }

      const connectedWires = wires.filter(
        w => (w.fromComponentId === componentId || w.toComponentId === componentId) &&
             (w.polarity === "hot" || w.polarity === "neutral" || w.polarity === "ground")
      );

      for (const connectedWire of connectedWires) {
        const otherCompId = connectedWire.fromComponentId === componentId 
          ? connectedWire.toComponentId 
          : connectedWire.fromComponentId;
        const result = findACLoads(otherCompId, new Set(visited));
        if (result.watts > 0) {
          return result;
        }
      }

      return { watts: 0, voltage: 120 };
    };

    const inverterACWires = wires.filter(
      w => (w.fromComponentId === inverterId || w.toComponentId === inverterId) &&
           ((w.fromTerminal === "ac-out-hot" && w.fromComponentId === inverterId) ||
            (w.toTerminal === "ac-out-hot" && w.toComponentId === inverterId))
    );

    const visitedComponents = new Set<string>();
    for (const acWire of inverterACWires) {
      const otherCompId = acWire.fromComponentId === inverterId 
        ? acWire.toComponentId 
        : acWire.fromComponentId;
      
      if (!visitedComponents.has(otherCompId)) {
        visitedComponents.add(otherCompId);
        const result = findACLoads(otherCompId, new Set());
        totalACWatts += result.watts;
        if (result.voltage !== 120) acVoltage = result.voltage;
      }
    }

    if (totalACWatts === 0) {
      const inverterRating = (inverter.properties?.powerRating || inverter.properties?.watts || inverter.properties?.power || 0) as number;
      if (inverterRating > 0) {
        totalACWatts = inverterRating * 0.8;
      }
    }

    const dcInputWatts = totalACWatts / inverterEfficiency;
    const dcInputCurrent = systemVoltage > 0 ? dcInputWatts / systemVoltage : 0;

    return { acLoadWatts: totalACWatts, dcInputWatts, dcInputCurrent, acVoltage };
  };

  const calculateWire = (wire: Wire, overrideVoltage?: number) => {
    try {
      // Find parallel wires (same from/to components, same polarity)
      const parallelWires = wires.filter(w => 
        w.id !== wire.id &&
        w.polarity === wire.polarity &&
        ((w.fromComponentId === wire.fromComponentId && w.toComponentId === wire.toComponentId) ||
         (w.fromComponentId === wire.toComponentId && w.toComponentId === wire.fromComponentId))
      );
      const parallelCount = parallelWires.length + 1; // +1 for the current wire

      // Calculate current from connected load if not set
      let current = wire.current || 0;
      let voltage = overrideVoltage || systemVoltage;

      // Find connected components to calculate current (define at top level for scope)
      const fromComp = components.find(c => c.id === wire.fromComponentId);
      const toComp = components.find(c => c.id === wire.toComponentId);

      if (current === 0) {

        // Check if this is an inverter DC connection - use inverter DC input current
        const isInverterDCWire = 
          ((fromComp?.type === "multiplus" || fromComp?.type === "phoenix-inverter" || fromComp?.type === "inverter") &&
           (wire.fromTerminal === "dc-positive" || wire.fromTerminal === "dc-negative")) ||
          ((toComp?.type === "multiplus" || toComp?.type === "phoenix-inverter" || toComp?.type === "inverter") &&
           (wire.toTerminal === "dc-positive" || wire.toTerminal === "dc-negative"));
        
        if (isInverterDCWire) {
          const inverterId = fromComp?.type === "multiplus" || fromComp?.type === "phoenix-inverter" || fromComp?.type === "inverter"
            ? fromComp.id
            : toComp?.id;
          if (inverterId) {
            const inverterDC = calculateInverterDCInput(inverterId);
            current = inverterDC.dcInputCurrent;
            // Use system voltage for DC side
            if (fromComp?.properties?.voltage) {
              voltage = fromComp.properties.voltage as number;
            } else if (toComp?.properties?.voltage) {
              voltage = toComp.properties.voltage as number;
            }
          }
        } else {
          // Special handling for solar panels - use Vmp (maximum power voltage) not system voltage
          if (fromComp?.type === "solar-panel") {
            const panelWatts = (fromComp.properties?.watts || fromComp.properties?.power || 0) as number;
            // Solar panels operate at Vmp (maximum power voltage), not system voltage
            // Typical Vmp: 18V for 12V system, 36V for 24V system, 72V for 48V system
            let panelVoltage = fromComp.properties?.voltage as number;
            if (!panelVoltage) {
              // Default to typical Vmp based on system voltage
              panelVoltage = systemVoltage * 1.5; // 18V for 12V system, 36V for 24V, etc.
            } else {
              // If user set voltage, assume it's Vmp (they might set 18V for a 12V system panel)
              // But if they set 12V, that's probably system voltage, so convert to Vmp
              if (panelVoltage <= systemVoltage * 1.2) {
                // If voltage is close to system voltage, assume they meant system voltage and convert to Vmp
                panelVoltage = systemVoltage * 1.5;
              }
            }
            if (panelWatts > 0 && panelVoltage > 0) {
              current = panelWatts / panelVoltage;
              voltage = panelVoltage;
            }
          } else {
            // Use component voltage if available
            if (fromComp?.properties?.voltage) {
              voltage = fromComp.properties.voltage as number;
            } else if (toComp?.properties?.voltage) {
              voltage = toComp.properties.voltage as number;
            }
            
            // If wire is FROM an MPPT/charger TO a bus bar or load, use source output current
            if (fromComp && (fromComp.type === "mppt" || fromComp.type === "blue-smart-charger" || fromComp.type === "orion-dc-dc")) {
              // For MPPT/chargers, use their output current
              // MPPT uses maxCurrent, chargers use amps/current
              const chargeCurrent = fromComp.type === "mppt"
                ? (fromComp.properties?.maxCurrent || fromComp.properties?.amps || fromComp.properties?.current || 0) as number
                : (fromComp.properties?.amps || fromComp.properties?.current || 0) as number;
              if (chargeCurrent > 0) {
                current = chargeCurrent;
              }
            }
            // Calculate current from load watts
            else if (toComp && (toComp.type === "dc-load" || toComp.type === "ac-load")) {
              const loadWatts = (toComp.properties?.watts || toComp.properties?.power || 0) as number;
              // AC loads use AC voltage (120V), DC loads use component voltage
              const loadVoltage = toComp.type === "ac-load" 
                ? (toComp.properties?.acVoltage || toComp.properties?.voltage || 120)
                : (toComp.properties?.voltage as number || voltage);
              if (loadWatts > 0 && loadVoltage > 0) {
                current = loadWatts / loadVoltage;
                voltage = loadVoltage; // Use load's voltage
              }
            } else if (toComp && toComp.type === "dc-panel") {
              // For wires TO a DC panel, trace through to find all connected DC loads
              const panelWires = wires.filter(
                w => (w.fromComponentId === toComp.id || w.toComponentId === toComp.id) &&
                     w.polarity === "positive" &&
                     w.id !== wire.id
              );
              
              let totalLoadCurrent = 0;
              const visitedLoads = new Set<string>();
              
              for (const panelWire of panelWires) {
                const loadCompId = panelWire.fromComponentId === toComp.id 
                  ? panelWire.toComponentId 
                  : panelWire.fromComponentId;
                
                if (!visitedLoads.has(loadCompId)) {
                  visitedLoads.add(loadCompId);
                  const loadComp = components.find(c => c.id === loadCompId);
                  if (loadComp && loadComp.type === "dc-load") {
                    const loadWatts = (loadComp.properties?.watts || loadComp.properties?.power || 0) as number;
                    const loadVoltage = (loadComp.properties?.voltage as number || voltage);
                    if (loadWatts > 0 && loadVoltage > 0) {
                      totalLoadCurrent += loadWatts / loadVoltage;
                    }
                  }
                }
              }
              
              if (totalLoadCurrent > 0) {
                current = totalLoadCurrent;
              }
            } else if (fromComp && (fromComp.type === "dc-load" || fromComp.type === "ac-load")) {
              const loadWatts = (fromComp.properties?.watts || fromComp.properties?.power || 0) as number;
              // AC loads use AC voltage (120V), DC loads use component voltage
              const loadVoltage = fromComp.type === "ac-load"
                ? (fromComp.properties?.acVoltage || fromComp.properties?.voltage || 120)
                : (fromComp.properties?.voltage as number || voltage);
              if (loadWatts > 0 && loadVoltage > 0) {
                current = loadWatts / loadVoltage;
                voltage = loadVoltage; // Use load's voltage
              }
            } else if (toComp?.type?.includes("busbar") && (fromComp?.type === "fuse" || fromComp?.type === "battery" || fromComp?.type === "smartshunt")) {
              // For wires TO a bus bar FROM a fuse/battery, calculate NET current (loads minus sources)
              const connectedWires = wires.filter(
                w => (w.fromComponentId === toComp.id || w.toComponentId === toComp.id) && w.id !== wire.id
              );
              
              let totalLoadCurrent = 0;
              let totalSourceCurrent = 0;
              const visitedComps = new Set<string>();
              
              for (const connectedWire of connectedWires) {
                const otherCompId = connectedWire.fromComponentId === toComp.id 
                  ? connectedWire.toComponentId 
                  : connectedWire.fromComponentId;
                
                if (visitedComps.has(otherCompId)) continue;
                visitedComps.add(otherCompId);
                
                const otherComp = components.find(c => c.id === otherCompId);
                if (!otherComp) continue;
                
                // Skip AC loads and AC panels
                if (otherComp.type === "ac-load" || otherComp.type === "ac-panel") continue;
                
                // For inverters, get DC input current (load)
                if (otherComp.type === "inverter" || otherComp.type === "multiplus" || otherComp.type === "phoenix-inverter") {
                  const inverterDC = calculateInverterDCInput(otherComp.id);
                  totalLoadCurrent += inverterDC.dcInputCurrent;
                }
                // For DC loads, calculate current
                else if (otherComp.type === "dc-load") {
                  const loadWatts = (otherComp.properties?.watts || otherComp.properties?.power || 0) as number;
                  const loadVoltage = (otherComp.properties?.voltage as number || voltage);
                  if (loadWatts > 0 && loadVoltage > 0) {
                    totalLoadCurrent += loadWatts / loadVoltage;
                  }
                }
                // For DC panels, trace through to find DC loads
                else if (otherComp.type === "dc-panel") {
                  const panelWires = wires.filter(
                    w => (w.fromComponentId === otherComp.id || w.toComponentId === otherComp.id) &&
                         w.polarity === "positive"
                  );
                  
                  const visitedLoads = new Set<string>();
                  for (const panelWire of panelWires) {
                    const loadCompId = panelWire.fromComponentId === otherComp.id 
                      ? panelWire.toComponentId 
                      : panelWire.fromComponentId;
                    
                    if (!visitedLoads.has(loadCompId)) {
                      visitedLoads.add(loadCompId);
                      const loadComp = components.find(c => c.id === loadCompId);
                      if (loadComp && loadComp.type === "dc-load") {
                        const loadWatts = (loadComp.properties?.watts || loadComp.properties?.power || 0) as number;
                        const loadVoltage = (loadComp.properties?.voltage as number || voltage);
                        if (loadWatts > 0 && loadVoltage > 0) {
                          totalLoadCurrent += loadWatts / loadVoltage;
                        }
                      }
                    }
                  }
                }
                // For MPPT/chargers, get their output current (source - subtract it)
                else if (otherComp.type === "mppt" || otherComp.type === "blue-smart-charger" || otherComp.type === "orion-dc-dc") {
                  const chargeCurrent = otherComp.type === "mppt"
                    ? (otherComp.properties?.maxCurrent || otherComp.properties?.amps || otherComp.properties?.current || 0) as number
                    : (otherComp.properties?.amps || otherComp.properties?.current || 0) as number;
                  totalSourceCurrent += chargeCurrent;
                }
              }
              
              // Net current = loads minus sources
              current = Math.max(0, totalLoadCurrent - totalSourceCurrent);
            } else if ((fromComp?.type === "battery" || toComp?.type === "battery") && current === 0) {
              // Special handling for battery wires - calculate net current through fuse/SmartShunt to bus bar
              const batteryComp = fromComp?.type === "battery" ? fromComp : toComp;
              const otherComp = fromComp?.type === "battery" ? toComp : fromComp;
              
              if (batteryComp && otherComp) {
                // For battery wires, only count loads (inverter, DC loads), not sources (MPPT, chargers)
                if (otherComp.type === "mppt" || otherComp.type === "blue-smart-charger" || otherComp.type === "orion-dc-dc") {
                  // Sources don't draw from battery, skip
                  current = 0;
                } else if (otherComp.type === "fuse" || otherComp.type === "smartshunt") {
                  // For battery → fuse or battery → SmartShunt, trace through to bus bar and calculate net current
                  // Find the bus bar connected to the fuse/SmartShunt
                  const busBarWires = wires.filter(
                    w => (w.fromComponentId === otherComp.id || w.toComponentId === otherComp.id) && w.id !== wire.id
                  );
                  
                  for (const busBarWire of busBarWires) {
                    const busBarCompId = busBarWire.fromComponentId === otherComp.id 
                      ? busBarWire.toComponentId 
                      : busBarWire.fromComponentId;
                    
                    const busBarComp = components.find(c => c.id === busBarCompId);
                    if (busBarComp && busBarComp.type?.includes("busbar")) {
                      // Calculate net current on this bus bar (loads minus sources)
                      const connectedWires = wires.filter(
                        w => (w.fromComponentId === busBarComp.id || w.toComponentId === busBarComp.id) && w.id !== busBarWire.id
                      );
                      
                      let totalLoadCurrent = 0;
                      let totalSourceCurrent = 0;
                      const visitedComps = new Set<string>();
                      
                      for (const connectedWire of connectedWires) {
                        const otherCompId = connectedWire.fromComponentId === busBarComp.id 
                          ? connectedWire.toComponentId 
                          : connectedWire.fromComponentId;
                        
                        if (visitedComps.has(otherCompId)) continue;
                        visitedComps.add(otherCompId);
                        
                        const connectedComp = components.find(c => c.id === otherCompId);
                        if (!connectedComp) continue;
                        
                        // Skip AC loads and AC panels
                        if (connectedComp.type === "ac-load" || connectedComp.type === "ac-panel") continue;
                        
                        // For inverters, get DC input current (load)
                        if (connectedComp.type === "inverter" || connectedComp.type === "multiplus" || connectedComp.type === "phoenix-inverter") {
                          const inverterDC = calculateInverterDCInput(connectedComp.id);
                          totalLoadCurrent += inverterDC.dcInputCurrent;
                        }
                        // For DC loads, calculate current
                        else if (connectedComp.type === "dc-load") {
                          const loadWatts = (connectedComp.properties?.watts || connectedComp.properties?.power || 0) as number;
                          const loadVoltage = (connectedComp.properties?.voltage as number || voltage);
                          if (loadWatts > 0 && loadVoltage > 0) {
                            totalLoadCurrent += loadWatts / loadVoltage;
                          }
                        }
                        // For DC panels, trace through to find DC loads
                        else if (connectedComp.type === "dc-panel") {
                          const panelWires = wires.filter(
                            w => (w.fromComponentId === connectedComp.id || w.toComponentId === connectedComp.id) &&
                                 w.polarity === "positive"
                          );
                          
                          const visitedLoads = new Set<string>();
                          for (const panelWire of panelWires) {
                            const loadCompId = panelWire.fromComponentId === connectedComp.id 
                              ? panelWire.toComponentId 
                              : panelWire.fromComponentId;
                            
                            if (!visitedLoads.has(loadCompId)) {
                              visitedLoads.add(loadCompId);
                              const loadComp = components.find(c => c.id === loadCompId);
                              if (loadComp && loadComp.type === "dc-load") {
                                const loadWatts = (loadComp.properties?.watts || loadComp.properties?.power || 0) as number;
                                const loadVoltage = (loadComp.properties?.voltage as number || voltage);
                                if (loadWatts > 0 && loadVoltage > 0) {
                                  totalLoadCurrent += loadWatts / loadVoltage;
                                }
                              }
                            }
                          }
                        }
                        // For MPPT/chargers, get their output current (source - subtract it)
                        else if (connectedComp.type === "mppt" || connectedComp.type === "blue-smart-charger" || connectedComp.type === "orion-dc-dc") {
                          const chargeCurrent = connectedComp.type === "mppt"
                            ? (connectedComp.properties?.maxCurrent || connectedComp.properties?.amps || connectedComp.properties?.current || 0) as number
                            : (connectedComp.properties?.amps || connectedComp.properties?.current || 0) as number;
                          totalSourceCurrent += chargeCurrent;
                        }
                      }
                      
                      // Net current = loads minus sources
                      current = Math.max(0, totalLoadCurrent - totalSourceCurrent);
                      break; // Found the bus bar, use its net current
                    }
                  }
                }
              }
            } else if (fromComp?.properties?.current) {
              current = fromComp.properties.current as number;
            } else if (toComp?.properties?.current) {
              current = toComp.properties.current as number;
            } else if (fromComp?.properties?.amps) {
              current = fromComp.properties.amps as number;
            } else if (toComp?.properties?.amps) {
              current = toComp.properties.amps as number;
            }
          }
        }
      }

      // Default to 10A if still no current found (only for non-inverter wires)
      // But skip this default if we're still calculating (current === 0 might be valid for sources)
      if (current === 0 && !fromComp?.type?.includes("busbar") && !toComp?.type?.includes("busbar")) {
        current = 10;
      }

      // Use actual wire length and gauge if available
      const wireLength = wire.length || 10;

      // Divide current by number of parallel wires (each wire carries 1/N of total current)
      const currentPerWire = current / parallelCount;

      // Calculate wire size client-side (no server request needed)
      const result = calculateWireSize({
        current: currentPerWire, // Use current per wire, not total current
        length: wireLength,
        voltage: voltage,
        conductorMaterial: (wire as any).conductorMaterial || "copper",
        currentGauge: wire.gauge, // Pass current gauge to prevent recommending smaller
      });
      
      // Store the total current in the result for display purposes
      result.totalCurrent = current;
      result.parallelCount = parallelCount;
      
      // Store the full calculation result including message
      setWireCalculations(prev => ({
        ...prev,
        [wire.id]: {
          ...result,
          message: result.message, // Ensure message is included
        }
      }));
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
      // Use component's voltage if available, otherwise system voltage
      const componentVoltage = comp.properties?.voltage || systemVoltage;
      // Calculate all connected wires
      connectedWires.forEach(wire => {
        calculateWire(wire, componentVoltage);
      });
    } else {
      setWireCalculations({});
    }
  };

  const handleWireSelect = (wire: Wire | null) => {
    if (wire) {
      setSelectedWire(wire);
      // Don't clear component selection - keep it so we can go back
      // Calculate wire client-side (instant, no server request)
      calculateWire(wire);
    } else {
      // Clear wire selection (go back to component view)
      setSelectedWire(null);
    }
  };

  const handleComponentDrop = (x: number, y: number) => {
    if (!draggedComponentType) return;

    // Get default properties based on component type
    const getDefaultProperties = (type: string): Record<string, any> => {
      const defaults: Record<string, Record<string, any>> = {
        battery: { voltage: systemVoltage, capacity: 200, batteryType: 'LiFePO4' },
        'dc-load': { watts: 50, voltage: systemVoltage },
        'ac-load': { watts: 1000, acVoltage: 120 },
        'solar-panel': { watts: 300, voltage: systemVoltage },
        mppt: { amps: 30, voltage: systemVoltage },
        multiplus: { watts: 3000, powerRating: 3000, voltage: systemVoltage },
        inverter: { watts: 2000, voltage: systemVoltage },
        'phoenix-inverter': { watts: 1200, voltage: systemVoltage },
        'blue-smart-charger': { amps: 15, voltage: systemVoltage },
        'orion-dc-dc': { amps: 30, voltage: systemVoltage },
        'battery-protect': { amps: 100, voltage: systemVoltage },
        fuse: { fuseRating: 400, amps: 400 },
        switch: { voltage: systemVoltage },
        'busbar-positive': { voltage: systemVoltage },
        'busbar-negative': { voltage: systemVoltage },
        cerbo: { voltage: systemVoltage },
        smartshunt: { voltage: systemVoltage },
      };
      return defaults[type] || { voltage: systemVoltage };
    };

    const newComponent: SchematicComponent = {
      id: `comp-${Date.now()}`,
      type: draggedComponentType,
      name: draggedComponentType.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      x,
      y,
      properties: getDefaultProperties(draggedComponentType),
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

  const handleCopy = (componentIds: string[]) => {
    // Get selected components with all properties
    const componentsToCopy = components.filter(c => componentIds.includes(c.id));
    
    // Get wires that connect only the selected components (internal wires)
    const wiresToCopy = wires.filter(w => 
      componentIds.includes(w.fromComponentId) && componentIds.includes(w.toComponentId)
    );
    
    setCopiedComponents(componentsToCopy);
    setCopiedWires(wiresToCopy);
    
    toast({
      title: "Copied",
      description: `Copied ${componentsToCopy.length} component${componentsToCopy.length !== 1 ? 's' : ''} and ${wiresToCopy.length} wire${wiresToCopy.length !== 1 ? 's' : ''}`,
    });
  };

  const handlePaste = () => {
    if (copiedComponents.length === 0) return;
    
    // Calculate offset (50px down and right)
    const offsetX = 50;
    const offsetY = 50;
    
    // Create ID mapping for new components
    const idMap = new Map<string, string>();
    const newComponents: SchematicComponent[] = copiedComponents.map(comp => {
      const newId = `comp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      idMap.set(comp.id, newId);
      return {
        ...comp,
        id: newId,
        x: comp.x + offsetX,
        y: comp.y + offsetY,
        // Preserve all properties
        properties: { ...comp.properties },
      };
    });
    
    // Create new wires with updated component IDs
    const newWires: Wire[] = copiedWires.map(wire => ({
      ...wire,
      id: `wire-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      fromComponentId: idMap.get(wire.fromComponentId) || wire.fromComponentId,
      toComponentId: idMap.get(wire.toComponentId) || wire.toComponentId,
      // Preserve all wire properties
      length: wire.length,
      gauge: wire.gauge,
      current: wire.current,
      voltageDrop: wire.voltageDrop,
      color: wire.color,
      conductorMaterial: wire.conductorMaterial,
    }));
    
    // Add new components and wires
    setComponents(prev => [...prev, ...newComponents]);
    setWires(prev => [...prev, ...newWires]);
    
    // Select the newly pasted components
    setSelectedComponent(newComponents[0]);
    
    toast({
      title: "Pasted",
      description: `Pasted ${newComponents.length} component${newComponents.length !== 1 ? 's' : ''} and ${newWires.length} wire${newWires.length !== 1 ? 's' : ''}`,
    });
  };

  const handleClearAll = () => {
    // Clear all components and wires
    setComponents([]);
    setWires([]);
    setSelectedComponent(null);
    setSelectedWire(null);
    setWireCalculations({});
    setCopiedComponents([]);
    setCopiedWires([]);
    setCurrentDesignId(null);
    setCurrentDesignName(null);
    
    // Clear auto-saved state
    localStorage.removeItem("autoSavedDiagramState");
    
    // Clear validation
    setValidationResult(null);
    
    toast({
      title: "Cleared",
      description: "All components and wires have been removed",
    });
    
    setClearDialogOpen(false);
  };

  const handleWireConnectionComplete = async (wireData: import("@/components/SchematicCanvas").WireConnectionData) => {
    // Get component references (used throughout this function)
    const fromComp = components.find(c => c.id === wireData.fromComponentId);
    const toComp = components.find(c => c.id === wireData.toComponentId);

    // Validate connection
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

    // Get default wire length based on component types
    let wireLength = wireData.length;
    if (!wireLength || wireLength === 0) {
      wireLength = getDefaultWireLength(
        fromComp!,
        toComp!,
        wireData.fromTerminal.id,
        wireData.toTerminal.id
      );
    }

    try {

      // Estimate current based on component type and properties
      let estimatedCurrent = 10; // Default 10A
      if (fromComp?.properties.current) {
        estimatedCurrent = fromComp.properties.current;
      } else if (toComp?.properties.current) {
        estimatedCurrent = toComp.properties.current;
      } else if (fromComp?.properties.watts && fromComp?.properties.voltage) {
        estimatedCurrent = fromComp.properties.watts / fromComp.properties.voltage;
      } else if (toComp?.properties.watts && toComp?.properties.voltage) {
        estimatedCurrent = toComp.properties.watts / toComp.properties.voltage;
      }

      // Calculate wire size client-side (no server request needed)
      const calculation = calculateWireSize({
        current: estimatedCurrent,
        length: wireLength,
        voltage: systemVoltage,
        temperatureC: 30,
        conductorMaterial: "copper",
        currentGauge: wire.gauge, // Pass current gauge to prevent recommending smaller
        insulationType: "75C",
        bundlingFactor: 0.8,
        maxVoltageDrop: 3,
      });

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
      length: wireLength,
      gauge: calculatedGauge,
    };

    setWires(prev => [...prev, newWire]);
    setWireStartComponent(null);
    setWireConnectionMode(false);
  };

  const handleWireDelete = (wireId: string) => {
    setWires(prev => prev.filter(w => w.id !== wireId));
  };

  const handleCreateParallelWires = (wireId: string, count: number) => {
    const originalWire = wires.find(w => w.id === wireId);
    if (!originalWire) return;

    // Find the recommended gauge from calculation
    const calc = wireCalculations[wireId];
    const recommendedGauge = calc?.recommendedGauge || "4/0 AWG";

    // Create parallel wires (count - 1 additional wires, since we'll keep the original)
    const newWires: Wire[] = [];
    for (let i = 1; i < count; i++) {
      newWires.push({
        id: `wire-${Date.now()}-${i}`,
        fromComponentId: originalWire.fromComponentId,
        toComponentId: originalWire.toComponentId,
        fromTerminal: originalWire.fromTerminal,
        toTerminal: originalWire.toTerminal,
        polarity: originalWire.polarity,
        gauge: recommendedGauge,
        length: originalWire.length || 10,
        conductorMaterial: originalWire.conductorMaterial,
      });
    }

    // Update original wire to recommended gauge
    setWires(prev => prev.map(w => 
      w.id === wireId ? { ...w, gauge: recommendedGauge } : w
    ).concat(newWires));

    toast({
      title: "Parallel wires created",
      description: `Created ${count - 1} additional parallel wire(s) of ${recommendedGauge}`,
    });
  };

  const handleWireUpdate = (wireId: string, updates: Partial<Wire>) => {
    setWires(prev => prev.map(w => {
      if (w.id === wireId) {
        const updated = { ...w, ...updates };
        // Recalculate if this wire is selected and length/gauge changed
        if (selectedWire?.id === wireId && (updates.length !== undefined || updates.gauge !== undefined)) {
          calculateWire(updated);
        }
        return updated;
      }
      return w;
    }));
    if (selectedWire?.id === wireId) {
      const updated = selectedWire ? { ...selectedWire, ...updates } : null;
      setSelectedWire(updated);
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
        onClear={() => setClearDialogOpen(true)}
        wireMode={wireConnectionMode}
        hasComponents={components.length > 0}
        designQualityScore={validationResult?.score}
        user={user}
        currentDesignName={currentDesignName || undefined}
        isAIWiring={aiWireMutation.isPending}
        showWireLabels={showWireLabels}
        onToggleWireLabels={() => setShowWireLabels(!showWireLabels)}
        systemVoltage={systemVoltage}
      />

      {/* Alpha Warning Banner */}
      <div className="px-4 pt-3 pb-0">
        <Alert variant="default" className="border-yellow-500/50 bg-yellow-500/10">
          <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-500" />
          <AlertTitle className="text-yellow-800 dark:text-yellow-400">⚠️ Important Disclaimer</AlertTitle>
          <AlertDescription className="text-yellow-700 dark:text-yellow-500">
            <strong>Do not trust calculations without verification.</strong> This tool is in active development and calculations may contain errors. Always double-check wire sizing, current ratings, and voltage drop calculations against ABYC/NEC standards and manufacturer specifications. Verify all component ratings and connections before installation. This tool is for planning purposes only and does not replace professional electrical engineering review.
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
          showWireLabels={showWireLabels}
          onCopy={handleCopy}
          onPaste={handlePaste}
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
          wireCalculations={Object.fromEntries(
            Object.entries(wireCalculations).map(([id, calc]) => [
              id,
              {
                current: calc.current,
                length: calc.length,
                voltage: calc.voltage,
                recommendedGauge: calc.recommendedGauge,
                voltageDrop: calc.voltageDropPercent ?? calc.actualVoltageDrop,
                voltageDropPercent: calc.voltageDropPercent,
                status: calc.status,
              }
            ])
          )}
          validationResult={validationResult}
          wires={wires}
          components={components}
          onUpdateWire={handleWireUpdate}
          onWireSelect={handleWireSelect}
          onComponentSelect={handleComponentSelect}
          onCreateParallelWires={handleCreateParallelWires}
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

      {/* Iteration Progress Overlay */}
      {iterationProgress && (
        <IterationProgress
          currentIteration={iterationProgress.iteration}
          maxIterations={iterationProgress.maxIterations}
          currentScore={iterationProgress.score || 0}
          status={
            iterationProgress.isStreaming
              ? "🤖 AI is generating response..."
              : iterationProgress.errorCount && iterationProgress.errorCount > 0
              ? `⚠️ Iteration ${iterationProgress.iteration} complete with ${iterationProgress.errorCount} errors`
              : iterationProgress.warningCount && iterationProgress.warningCount > 0
              ? `⚠️ Iteration ${iterationProgress.iteration} complete with ${iterationProgress.warningCount} warnings`
              : iterationProgress.score && iterationProgress.score >= 70
              ? `✅ Iteration ${iterationProgress.iteration} complete - Quality score: ${iterationProgress.score}`
              : `🔄 Iteration ${iterationProgress.iteration} complete - Quality score: ${iterationProgress.score || 0}`
          }
          isStreaming={iterationProgress.isStreaming}
          tokenCount={iterationProgress.tokenCount}
          promptTokens={iterationProgress.promptTokens}
          completionTokens={iterationProgress.completionTokens}
          streamingText={iterationProgress.streamingText}
        />
      )}

      <Dialog open={designQualitySheetOpen} onOpenChange={setDesignQualitySheetOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Design Quality Review</DialogTitle>
          </DialogHeader>
          <div className="mt-4">
            <DesignReviewPanel
              components={components}
              wires={wires}
              systemVoltage={systemVoltage}
              validationResult={validationResult}
              onValidate={validateDesign}
              onIssueClick={(issue) => {
                // Close the modal
                setDesignQualitySheetOpen(false);
                
                // Check for wireId (singular) or wireIds (plural)
                const wireId = (issue as any).wireId || (issue.wireIds && issue.wireIds.length > 0 ? issue.wireIds[0] : null);
                
                // If issue has a wire, select that wire
                if (wireId) {
                  const wire = wires.find(w => w.id === wireId);
                  if (wire) {
                    handleWireSelect(wire);
                    // Scroll to wire by finding one of its connected components
                    setTimeout(() => {
                      const fromComp = components.find(c => c.id === wire.fromComponentId);
                      const toComp = components.find(c => c.id === wire.toComponentId);
                      const compToScroll = fromComp || toComp;
                      if (compToScroll) {
                        // Use the correct selector from SchematicCanvas
                        const element = document.querySelector(`[data-testid="canvas-component-${compToScroll.id}"]`);
                        if (element) {
                          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                      }
                    }, 100);
                  }
                }
                // If issue has componentIds, select the first component
                else if (issue.componentIds && issue.componentIds.length > 0) {
                  const component = components.find(c => issue.componentIds?.includes(c.id));
                  if (component) {
                    handleComponentSelect(component);
                    // Try to scroll to component
                    setTimeout(() => {
                      // Use the correct selector from SchematicCanvas
                      const element = document.querySelector(`[data-testid="canvas-component-${component.id}"]`);
                      if (element) {
                        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }
                    }, 100);
                  }
                }
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Clear All Confirmation Dialog */}
      <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All Components and Wires?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all components, wires, and connections from the canvas. This action cannot be undone.
              {currentDesignName && (
                <span className="block mt-2 font-semibold">
                  Current design: "{currentDesignName}"
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
