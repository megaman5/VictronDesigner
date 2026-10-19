import { isLayoutOnlyRequest, tidyComponentLayout } from "@/lib/tidy-layout";
import { aiResultNotice } from "@/lib/ai-result-notice";
import { wirePreflight, type AIBlocker } from "@shared/ai-policy";
import { useCloudAutosave, readDraft, readDraftAsync, autosaveFingerprint } from "@/hooks/use-cloud-autosave";
import { useDesignValidation } from "@/hooks/use-design-validation";
import { useDesignDocument } from "@/hooks/use-design-document";
import { loadDesignDocument, type DesignDocument } from "@shared/design-document";
import { useState, useEffect, useRef, useMemo, lazy, Suspense } from "react";
import { analyzeElectricalDesign } from "@shared/electrical-analysis";
import { designRequirementsSchema, checkDesignRequirements, type DesignRequirements } from "@shared/design-requirements";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CanvasViewTransition, View3DLoadError } from "@/components/CanvasViewTransition";
import { TopBar } from "@/components/TopBar";
import { RuntimeEstimatesDialog } from "@/components/RuntimeEstimatesDialog";
import { ComponentLibrary } from "@/components/ComponentLibrary";
import { SchematicCanvas } from "@/components/SchematicCanvas";
import { PropertiesPanel } from "@/components/PropertiesPanel";
import { DesignReviewPanel } from "@/components/DesignReviewPanel";
import { AIPromptDialog } from "@/components/AIPromptDialog";
import { ExportDialog } from "@/components/ExportDialog";
import { FeedbackDialog } from "@/components/FeedbackDialog";
import { SaveDesignDialog } from "@/components/SaveDesignDialog";
import { OpenDesignDialog } from "@/components/OpenDesignDialog";
import { CustomComponentDialog } from "@/components/CustomComponentDialog";
import { CustomComponentEditor } from "@/components/CustomComponentEditor";
import { toPlacedProperties, type CustomComponentDefinition } from "@/lib/custom-components";
import { DisclaimerDialog } from "@/components/DisclaimerDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
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
import { calculateWireSize, type WireGaugeFormat, type LengthUnit } from "@/lib/wire-calculator";
import { type WireRoutingStyle, type WireRoutingOptions, DEFAULT_WIRE_ROUTING_OPTIONS, WIRE_ROUTING_STYLES, normalizeRoutingOptions } from "@/lib/wire-routing";

const Design3DView = lazy(() => import("@/components/Design3DView").catch(() => ({
  default: View3DLoadError,
})));

const WIRE_ROUTING_OPTIONS_KEY = "wireRoutingOptions";

// Bump this when the disclaimer text materially changes to re-prompt everyone.
const DISCLAIMER_VERSION = "1";
const DISCLAIMER_COOKIE = "disclaimerAccepted";

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string, days = 365): void {
  if (typeof document === "undefined") return;
  const maxAge = days * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; SameSite=Lax`;
}
import { AIGenerationProgress, type AIGenerationProgressState } from "@/components/AIGenerationProgress";
import type { Schematic, SchematicComponent, Wire, WireCalculation, ValidationResult } from "@shared/schema";
import { findBatteryBanks } from "@shared/battery-bank";
import { solveDcWireCurrents } from "@/lib/dc-current-solver";

// Infer system voltage from components
// Priority: battery bank > other DC components > default 12V
function inferSystemVoltage(components: SchematicComponent[], wires: Wire[] = []): number {
  if (components.length === 0) return 12; // Default

  // First, check battery banks (most reliable indicator). Use the BANK voltage
  // so series strings (e.g. 2x12V wired in series = 24V) are read correctly
  // instead of the individual battery's nominal voltage.
  const banks = findBatteryBanks(components, wires);
  if (banks.length > 0) {
    const bankVoltages = banks
      .map(b => b.bankVoltage)
      .filter((v): v is number => v === 12 || v === 24 || v === 48);

    if (bankVoltages.length > 0) {
      // Use most common bank voltage, or first if all same
      const voltageCounts = new Map<number, number>();
      bankVoltages.forEach(v => {
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

function normalizeEditorDocument(next: DesignDocument, previous: DesignDocument): DesignDocument {
  if (next.components === previous.components && next.wires === previous.wires) return next;
  if (next.wires === previous.wires && next.components.length === previous.components.length && next.components.every((component, index) => {
    const { x, y, ...equipment } = component;
    const { x: oldX, y: oldY, ...oldEquipment } = previous.components[index];
    return JSON.stringify(equipment) === JSON.stringify(oldEquipment);
  })) return next;
  const systemVoltage = inferSystemVoltage(next.components, next.wires);
  return systemVoltage === next.systemVoltage ? next : { ...next, systemVoltage };
}

export default function SchematicDesigner() {
  const [canvasMode, setCanvasMode] = useState<"2d" | "3d">("2d");
  const { toast } = useToast();
  const [currentSchematicId, setCurrentSchematicId] = useState<string | null>(null);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [wireBlockers, setWireBlockers] = useState<AIBlocker[]>([]);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [designQualitySheetOpen, setDesignQualitySheetOpen] = useState(false);
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [openDialogOpen, setOpenDialogOpen] = useState(false);
  const [showEstimates, setShowEstimates] = useState(false);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [customComponentEditorOpen, setCustomComponentEditorOpen] = useState(false);
  const [editingCustomDefinition, setEditingCustomDefinition] = useState<CustomComponentDefinition | null>(null);
  const [draggedCustomDefinition, setDraggedCustomDefinition] = useState<CustomComponentDefinition | null>(null);
  const [deleteCustomTarget, setDeleteCustomTarget] = useState<CustomComponentDefinition | null>(null);

  // User auth state
  const [user, setUser] = useState<AuthUser | null>(null);
  // AI spends real money on the platform key, so it needs a signed-in user with
  // allowance left. The server enforces this; this query only drives the
  // greyed-out state and its tooltip so the limit is visible before clicking.
  const { data: aiUsage } = useQuery<{
    allowed: boolean;
    reason?: string;
    blockedBy?: "lifetime" | "monthly";
    lifetimeRemainingUsd: number;
  }>({
    queryKey: ["/api/ai/usage"],
    enabled: !!user,
  });

  const aiBlockedReason = !user
    ? "Log in to use AI features"
    : aiUsage && !aiUsage.allowed
      ? aiUsage.blockedBy === "monthly"
        ? aiUsage.reason ?? "Monthly AI limit reached - it resets at the start of next month."
        : "Out of free AI usage. Please use the tip button below and I will credit you with more usage."
      : undefined;
  const [disclaimerOpen, setDisclaimerOpen] = useState(() => getCookie(DISCLAIMER_COOKIE) !== DISCLAIMER_VERSION);
  const [disclaimerReviewOnly, setDisclaimerReviewOnly] = useState(false);

  const acceptDisclaimer = () => {
    setCookie(DISCLAIMER_COOKIE, DISCLAIMER_VERSION);
    setDisclaimerOpen(false);
    setDisclaimerReviewOnly(false);
    // Persist to the account too, so it carries across devices. Signed-out
    // visitors are covered by the cookie alone - calling this without a session
    // just returns 401, which was the single most common error in the logs.
    if (user) {
      fetch("/api/user/disclaimer", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: DISCLAIMER_VERSION }),
      }).catch(() => { /* offline: the cookie still covers this browser */ });
    }
  };

  const showDisclaimer = () => {
    setDisclaimerReviewOnly(true);
    setDisclaimerOpen(true);
  };
  const [selectedComponent, setSelectedComponent] = useState<SchematicComponent | null>(null);
  const [selectedWire, setSelectedWire] = useState<Wire | null>(null);
  const [wireCalculations, setWireCalculations] = useState<Record<string, WireCalculation>>({});
  const [draggedComponentType, setDraggedComponentType] = useState<string | null>(null);
  const [wireConnectionMode, setWireConnectionMode] = useState(false);
  const [wireStartComponent, setWireStartComponent] = useState<string | null>(null);
  const [showWireLabels, setShowWireLabels] = useState<boolean>(true);
  // Collapsible side panels, so a small screen (or someone wiring a big design)
  // can reclaim the width for the canvas. Persisted per-browser like the other
  // display toggles above - there is no per-account reason to sync it.
  const [leftPanelOpen, setLeftPanelOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem("leftPanelOpen") !== "0";
    } catch {
      return true;
    }
  });
  const [rightPanelOpen, setRightPanelOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem("rightPanelOpen") !== "0";
    } catch {
      return true;
    }
  });
  const toggleLeftPanel = () => {
    setLeftPanelOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem("leftPanelOpen", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };
  const toggleRightPanel = () => {
    setRightPanelOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem("rightPanelOpen", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };
  const [wireGaugeFormat, setWireGaugeFormat] = useState<WireGaugeFormat>("awg");
  const [lengthUnit, setLengthUnit] = useState<LengthUnit>("ft");
  const validRoutingStyles = WIRE_ROUTING_STYLES.map((s) => s.value);
  const [wireRoutingOptions, setWireRoutingOptionsState] = useState<WireRoutingOptions>(() => {
    try {
      const saved = typeof window !== "undefined" ? localStorage.getItem(WIRE_ROUTING_OPTIONS_KEY) : null;
      if (saved) return normalizeRoutingOptions(JSON.parse(saved));
    } catch {
      // ignore parse/storage errors
    }
    return DEFAULT_WIRE_ROUTING_OPTIONS;
  });
  const [wireRoutingSelectorEnabled, setWireRoutingSelectorEnabled] = useState(false);

  const setWireRoutingOptions = (options: WireRoutingOptions) => {
    setWireRoutingOptionsState(options);
    try {
      localStorage.setItem(WIRE_ROUTING_OPTIONS_KEY, JSON.stringify(options));
    } catch {
      // ignore storage errors (e.g. private mode)
    }
  };
  const [viewMode, setViewMode] = useState<'standard' | 'load'>('standard');
  const [loadMode, setLoadModeState] = useState<'nominal' | 'expected' | 'max'>(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("loadMode") : null;
    return saved === "expected" || saved === "max" ? saved : "nominal";
  });
  const setLoadMode = (mode: 'nominal' | 'expected' | 'max') => {
    setLoadModeState(mode);
    try { localStorage.setItem("loadMode", mode); } catch { /* ignore */ }
  };
  const [copiedComponents, setCopiedComponents] = useState<SchematicComponent[]>([]);
  const [copiedWires, setCopiedWires] = useState<Wire[]>([]);

  // Initialize state from localStorage if available (lazy initialization)
  const initializeState = () => {
    // Only restore if no other design is being loaded
    const hasFeedbackState = localStorage.getItem("loadedFeedbackState");
    const hasPendingAuth = localStorage.getItem("pendingAuthDiagramState");
    
    if (hasFeedbackState || hasPendingAuth) {
      return { components: [], wires: [], systemVoltage: 12 };
    }
    
    const scoped = readDraft();
    if (scoped && !scoped.metadata?.cloudOwnerId) {
      try { return loadDesignDocument(scoped); } catch { /* Keep invalid drafts for recovery. */ }
    }
    const legacy = localStorage.getItem("autoSavedDiagramState");
    if (legacy) {
      try {
        const record = JSON.parse(legacy);
        if (!record.metadata?.id && !record.id) return loadDesignDocument(record);
      } catch { localStorage.setItem("invalidAutoSavedDiagramState", legacy); }
    }
    return { components: [], wires: [], systemVoltage: 12 };
  };

  // All persistent canvas changes share one document boundary.
  const { document: designDocument, sequence: documentSequence, setComponents, setWires, setSystemVoltage,
    replaceDocument, updateDocument, undo, redo, canUndo, canRedo, undoLabel, redoLabel, beginTransaction, endTransaction } = useDesignDocument(initializeState, normalizeEditorDocument);
  const { components, wires, systemVoltage } = designDocument;
  const recoveryDocumentRef=useRef(designDocument);
  recoveryDocumentRef.current=designDocument;
  const aiGenerationController = useRef<AbortController | null>(null);
  const aiWireInputDocument = useRef<DesignDocument | null>(null);
  const applyAIChanges = (candidate: {
    components: SchematicComponent[]; wires: Wire[]; requirements?: DesignRequirements; systemVoltage?: number;
  }) => {
    try {
      const validated = loadDesignDocument({ ...designDocument, components: candidate.components, wires: candidate.wires,
        systemVoltage: candidate.systemVoltage ?? designDocument.systemVoltage,
        ...(candidate.requirements ? { requirements: candidate.requirements } : {}),
      });
      updateDocument(previous => ({ ...validated, metadata: previous.metadata }), { label: "AI changes" });
      return true;
    } catch {
      toast({ title: "AI changes could not be applied", description: "The returned data is incomplete. Your design has been kept.", variant: "destructive" });
      return false;
    }
  };
  const currentDesignId = designDocument.metadata.id ?? null;
  const currentDesignName = designDocument.metadata.name === "Untitled design" ? null : designDocument.metadata.name;
  const setCurrentDesignId = (id: string | null) => updateDocument(previous => ({
    ...previous, metadata: { ...previous.metadata, id: id ?? undefined },
  }), { recordHistory: false });
  const setCurrentDesignName = (name: string | null) => updateDocument(previous => ({
    ...previous, metadata: { ...previous.metadata, name: name ?? "Untitled design" },
  }), { recordHistory: false });
  useEffect(() => {
    if (localStorage.getItem("invalidAutoSavedDiagramState")) {
      toast({ title: "Draft could not be loaded", description: "The original draft has been kept on this device for recovery.", variant: "destructive" });
    }
  }, []);

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if (key === "y" && event.ctrlKey) { event.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, [undo, redo]);

  useEffect(() => {
    setSelectedComponent(previous => previous ? components.find(component => component.id === previous.id) ?? null : null);
    setSelectedWire(previous => previous ? wires.find(wire => wire.id === previous.id) ?? null : null);
  }, [components, wires]);

  // Load public app config (wire routing beta flag + default style)
  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((config) => {
        if (cancelled || !config) return;
        setWireRoutingSelectorEnabled(!!config.wireRoutingSelectorEnabled);
        // Apply the server default style only when the user hasn't chosen
        // routing options locally yet.
        const hasLocal = localStorage.getItem(WIRE_ROUTING_OPTIONS_KEY);
        if (!hasLocal && config.defaultWireRoutingStyle &&
            validRoutingStyles.includes(config.defaultWireRoutingStyle)) {
          setWireRoutingOptionsState((prev) => ({ ...prev, style: config.defaultWireRoutingStyle }));
        }
      })
      .catch(() => {
        // Non-fatal: selector simply stays hidden if config can't load
      });
    return () => { cancelled = true; };
  }, []);

  // Validation state
  const designReview = useDesignValidation({ components, wires, systemVoltage, options: designDocument.calculationOptions, requirements: designDocument.requirements }, documentSequence);
  const sharedElectricalAnalysis = useMemo(() => analyzeElectricalDesign({ components, wires, systemVoltage }, designDocument.calculationOptions), [components, wires, systemVoltage, designDocument.calculationOptions]);
  const validationResult = designReview.currentResult;
  const validateDesign = designReview.validate;

  // Iteration progress for AI generation
  const [iterationProgress, setIterationProgress] = useState<AIGenerationProgressState | null>(null);

  // Load schematic
  const { data: schematic } = useQuery<Schematic>({
    queryKey: ["/api/schematics", currentSchematicId],
    enabled: !!currentSchematicId,
  });

  // Update local state when schematic loads
  useEffect(() => {
    if (schematic) {
      try {
        replaceDocument(schematic);
      } catch (error) {
        toast({ title: "Design could not be loaded", description: error instanceof Error ? error.message : "Invalid saved document", variant: "destructive" });
      }
    }
  }, [schematic]);

  // Check auth status on mount
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('auth') === 'failed') {
      toast({ title: 'Sign-in did not finish', description: 'Try Sign In again. Your local draft is still on this device.' });
      url.searchParams.delete('auth');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
    const checkAuth = async () => {
      try {
        const response = await fetch("/auth/user");
        if (response.ok) {
          const userData = await response.json();
          const draft=await readDraftAsync(userData.id);
          setUser(userData);
          if(draft && draft.metadata?.cloudOwnerId === userData.id && recoveryDocumentRef.current.components.length === 0 && recoveryDocumentRef.current.wires.length === 0 && !currentSchematicId && !localStorage.getItem("pendingAuthDiagramState") && !localStorage.getItem("loadedFeedbackState")) {
            try { replaceDocument(draft); } catch { toast({title:"Draft could not be restored",description:"The original remains on this device.",variant:"destructive"}); }
          }

          // Reconcile disclaimer acceptance with the account (cross-device).
          try {
            const dRes = await fetch("/api/user/disclaimer");
            if (dRes.ok) {
              const { acceptedVersion } = await dRes.json();
              if (acceptedVersion === DISCLAIMER_VERSION) {
                setCookie(DISCLAIMER_COOKIE, DISCLAIMER_VERSION);
                setDisclaimerOpen(false);
              } else if (getCookie(DISCLAIMER_COOKIE) === DISCLAIMER_VERSION) {
                // Accepted in this browser but not yet on the account: push it up.
                fetch("/api/user/disclaimer", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ version: DISCLAIMER_VERSION }),
                }).catch(() => {});
              }
            }
          } catch { /* ignore disclaimer sync errors */ }
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
        replaceDocument(state);

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
          replaceDocument(state);
          
          toast({
            title: "Diagram restored",
            description: `Your design with ${state.components?.length || 0} components has been restored`,
          });
        }
        
        // Clear the pending state
        localStorage.removeItem("pendingAuthDiagramState");
      } catch (error) {
        console.error("Error restoring diagram state:", error);
        toast({ title: "Draft could not be restored", description: "The original login draft remains on this device for recovery.", variant: "destructive" });
      }
    }
  }, []);

  const cloudSave = useCloudAutosave({ document: designDocument, userId: user?.id, paused: saveDialogOpen,
    onSaved: (saved) => updateDocument(previous => ({ ...previous, metadata: { ...previous.metadata,
      cloudVersion: saved.version, cloudSavedFingerprint: saved.cloudSavedFingerprint,
    } }), { recordHistory: false }),
  });
 // Only run once on mount

  // Automatically recalculate wire loads when diagram changes
  // Calculate all wires when diagram changes or Load View is activated
  useEffect(() => {
    if (wires.length === 0) return;
    
    // Debounce to avoid heavy calculation during drag operations
    const timer = setTimeout(() => {
      // Solve the whole DC network once, then size each wire against it.
      const solverMap = solveDcWireCurrents(components, wires, {
        systemVoltage,
        loadMode,
        inverterDcInput: (id) => {
          const r = calculateInverterDCInput(id, 0.875, components);
          return { dcInputCurrent: r.dcInputCurrent, maxDCInputCurrent: r.maxDCInputCurrent };
        },
      });
      // Pass components explicitly to avoid stale closure
      wires.forEach(wire => calculateWire(wire, undefined, components, solverMap));
    }, 100);
    return () => clearTimeout(timer);
  }, [wires, components, systemVoltage, viewMode, loadMode]); // Re-run when anything electrical changes, view mode, or load mode changes

  // Login/logout handlers
  const handleLogin = () => {
    // Save current diagram state to localStorage before redirecting to OAuth
    if (components.length > 0 || wires.length > 0) {
      const diagramState = {
        ...designDocument,
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
      replaceDocument({components:[],wires:[],systemVoltage:12});
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
    version?: number;
    [key:string]:any;
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
    
    try {
      const document=loadDesignDocument(design);
      document.metadata={...document.metadata,cloudVersion:design.version,cloudOwnerId:user?.id};
      document.metadata.cloudSavedFingerprint=autosaveFingerprint(document);
      replaceDocument(document);
      cloudSave.clearConflict();
    } catch (error) {
      toast({ title: "Design could not be loaded", description: error instanceof Error ? error.message : "Invalid saved document", variant: "destructive" });
      return;
    }
    setSelectedComponent(null);
    setSelectedWire(null);
  };

  // Handle design saved
  const handleDesignSaved = (designId: string, name: string, version?: number, saved?: any) => {
    // Track save action
    trackAction("save_design", "save", {
      designId,
      componentCount: components.length,
      wireCount: wires.length,
      systemVoltage,
    });
    
    updateDocument(previous => {
      const next={...previous,metadata:{...previous.metadata,id:designId,name,description:saved?.description ?? previous.metadata.description,cloudVersion:version,cloudOwnerId:user?.id}};
      return {...next,metadata:{...next.metadata,cloudSavedFingerprint:autosaveFingerprint(next)}};
    }, {recordHistory:false});
    cloudSave.clearConflict();
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

  const deleteCustomComponentMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/custom-components/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-components"] });
      toast({ title: "Custom component deleted" });
    },
    onError: (error: any) => {
      toast({
        title: "Delete failed",
        description: error.message || "Failed to delete custom component",
        variant: "destructive",
      });
    },
  });

  // AI generation with SSE streaming
  const [isAiGenerating, setIsAiGenerating] = useState(false);

  const handleAIGenerateWithStreaming = async (prompt: string, requirements?: DesignRequirements) => {
    if (components.length && isLayoutOnlyRequest(prompt)) {
      updateDocument(previous => ({ ...previous, components: tidyComponentLayout(previous.components) }), { label: "tidy icon layout" });
      setAiDialogOpen(false);
      toast({ title: "Icons aligned", description: "Equipment and wiring kept. Undo is available." });
      return;
    }
    aiGenerationController.current?.abort();
    const abort = new AbortController();
    aiGenerationController.current = abort;
    setIsAiGenerating(true);
    setIterationProgress({ iteration: 1, maxIterations: 6, phase: 'waiting', startedAt: Date.now(), streamingText: '' });

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
        signal: abort.signal,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          requirements,
          systemVoltage,
          minQualityScore: 70,
          maxIterations: 6,
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
      let receivedTerminalEvent = false;

      if (!reader) {
        throw new Error("No response body");
      }

      while (true) {
        const { done, value } = await reader.read();
        if (abort.signal.aborted || aiGenerationController.current !== abort) return;
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
              setIterationProgress(prev => ({
                ...prev, startedAt: prev?.startedAt ?? Date.now(),
                iteration: data.iteration, maxIterations: data.maxIterations,
                phase: data.iteration > 1 ? 'refining' : 'waiting',
                streamingText: '', receivedCharacters: 0, lastActivityAt: undefined,
              }));
            } else if (currentEventType === "ai-fallback") {
              toast({ title: "Using backup AI", description: "The primary AI is unavailable. Continuing with OpenRouter." });
              setIterationProgress(prev => prev ? { ...prev, phase: 'waiting', usedFallback: true, streamingText: '', receivedCharacters: 0, lastActivityAt: undefined } : null);
            } else if (currentEventType === "ai-request-start") {
              setIterationProgress(prev => prev ? { ...prev, phase: prev.iteration > 1 ? 'refining' : 'waiting', streamingText: '', receivedCharacters: 0, lastActivityAt: undefined } : null);
            } else if (currentEventType === "ai-activity") {
              setIterationProgress(prev => prev ? { ...prev, phase: data.phase === 'drawing' ? 'drawing' : 'planning', lastActivityAt: Date.now() } : null);
            } else if (currentEventType === "ai-token") {
              setIterationProgress(prev => prev ? {
                ...prev, phase: 'drawing', lastActivityAt: Date.now(),
                streamingText: (prev.streamingText || '') + (data.token || ''),
                receivedCharacters: data.accumulatedLength || 0,
              } : null);
            } else if (currentEventType === "ai-response-complete") {
              setIterationProgress(prev => prev ? { ...prev, phase: 'checking', lastActivityAt: Date.now() } : null);
            } else if (currentEventType === "iteration-complete") {
              setIterationProgress(prev => prev ? {
                ...prev, phase: 'checking', iteration: data.iteration,
                maxIterations: data.maxIterations ?? prev.maxIterations,
                score: data.score, errorCount: data.errorCount, warningCount: data.warningCount, isBest: data.isBest,
              } : null);
            } else if (currentEventType === "complete") {
              receivedTerminalEvent = true;
              console.log("AI Generated System - Full Data:", data);
              console.log("Components count:", data.components?.length || 0);
              console.log("Wires count:", data.wires?.length || 0);
              console.log("Components:", data.components);
              console.log("Wires:", data.wires);

              const wiresWithIds = (data.wires || []).map((wire: any, index: number) => ({
                ...wire,
                id: wire.id || `wire-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
              }));

              if (applyAIChanges({ components: data.components || [], wires: wiresWithIds, systemVoltage,
                requirements: data.requirements })) {
                toast(aiResultNotice(data, 'Design'));
              }
              setAiDialogOpen(false);
              setIterationProgress(null);
            } else if (currentEventType === "error") {
              receivedTerminalEvent = true;
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
      if (!receivedTerminalEvent) {
        throw new Error("The AI connection ended before the design arrived. Your current design is unchanged. Please try again.");
      }
    } catch (error: any) {
      if (abort.signal.aborted) return;
      console.error("AI generation error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to generate system",
        variant: "destructive",
      });
      setIterationProgress(null);
    } finally {
      if (aiGenerationController.current === abort) setIsAiGenerating(false);
    }
  };

  // AI wire generation mutation
  const aiWireMutation = useMutation({
    mutationFn: async () => {
      aiWireInputDocument.current = designDocument;
      if (components.length === 0) {
        throw new Error("Please add components to the canvas first");
      }
      const parsedRequirements = designRequirementsSchema.safeParse(designDocument.requirements);
      const preflight = wirePreflight(components, parsedRequirements.success ? parsedRequirements.data : undefined);
      if (preflight.length) return { preflight };

      // Prepare validation feedback and wire calculations for AI
      const validationFeedback = validationResult ? {
        score: validationResult.score,
        errors: validationResult.issues.filter(i => i.severity === "error").map(i => ({
          message: i.message,
          category: i.category,
          componentIds: i.componentIds,
          wireId: i.wireId,
          wireIds: i.wireIds,
          suggestion: i.suggestion,
        })),
        warnings: validationResult.issues.filter(i => i.severity === "warning").map(i => ({
          message: i.message,
          category: i.category,
          componentIds: i.componentIds,
          wireId: i.wireId,
          wireIds: i.wireIds,
          suggestion: i.suggestion,
        })),
      } : null;

      // Prepare wire calculation issues
      const wireCalculationIssues: Array<{
        wireId: string;
        fromComponentId: string;
        toComponentId: string;
        issue: string;
        currentGauge?: string;
        recommendedGauge?: string;
        current?: number;
        voltageDrop?: number;
      }> = [];

      Object.entries(wireCalculations).forEach(([wireId, calc]) => {
        if (calc.status === "error" || calc.status === "warning") {
          const wire = wires.find(w => w.id === wireId);
          if (wire) {
            wireCalculationIssues.push({
              wireId,
              fromComponentId: wire.fromComponentId,
              toComponentId: wire.toComponentId,
              issue: calc.message || `${calc.status}: Wire sizing issue`,
              currentGauge: wire.gauge,
              recommendedGauge: calc.recommendedGauge,
              current: calc.totalCurrent,
              voltageDrop: calc.voltageDropPercent,
            });
          }
        }
      });

      const res = await apiRequest("POST", "/api/ai-wire-components", {
        components,
        wires: wires.length > 0 ? wires : undefined, // Include existing wires if any
        systemVoltage,
        requirements: designRequirementsSchema.safeParse(designDocument.requirements).success ? designDocument.requirements : undefined,
        validationFeedback,
        wireCalculationIssues: wireCalculationIssues.length > 0 ? wireCalculationIssues : undefined,
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.preflight?.length) {
        setWireBlockers(data.preflight);
        return;
      }
      const newWires = (data.wires || []).map((wire: any, index: number) => ({
        ...wire, id: wire.id || `wire-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
      }));
      if (applyAIChanges({ components: aiWireInputDocument.current?.components || components, wires: newWires,
        systemVoltage: aiWireInputDocument.current?.systemVoltage ?? systemVoltage, requirements: data.requirements })) {
        toast(aiResultNotice(data, 'Wiring'));
      }
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
    inverterEfficiency: number = 0.875,
    componentsOverride?: SchematicComponent[]
  ): { acLoadWatts: number; dcInputWatts: number; dcInputCurrent: number; acVoltage: number; maxDCInputCurrent: number } => {
    const comps = componentsOverride || components;
    const inverter = comps.find(c => c.id === inverterId);
    if (!inverter || (inverter.type !== "multiplus" && inverter.type !== "phoenix-inverter" && inverter.type !== "quattro" && inverter.type !== "inverter")) {
      return { acLoadWatts: 0, dcInputWatts: 0, dcInputCurrent: 0, acVoltage: 120, maxDCInputCurrent: 0 };
    }

    const inverterACOutputTerminals = ["ac-out-hot", "ac-out-neutral"];
    let totalACWatts = 0;
    let acVoltage = 120;

    const findACLoads = (componentId: string, visited: Set<string> = new Set()): { watts: number; voltage: number } => {
      if (visited.has(componentId)) return { watts: 0, voltage: 120 };
      visited.add(componentId);

      const comp = comps.find(c => c.id === componentId);
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

      let branchWatts = 0;
      let branchVoltage = 120;

      for (const connectedWire of connectedWires) {
        const otherCompId = connectedWire.fromComponentId === componentId 
          ? connectedWire.toComponentId 
          : connectedWire.fromComponentId;
        const result = findACLoads(otherCompId, new Set(visited));
        if (result.watts > 0) {
          branchWatts += result.watts;
          if (result.voltage !== 120) branchVoltage = result.voltage;
        }
      }

      return { watts: branchWatts, voltage: branchVoltage };
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

    // Always calculate capacity-based max current for safety sizing
    const inverterRating = (inverter.properties?.powerRating || inverter.properties?.watts || inverter.properties?.power || 0) as number;
    const maxDCInputWatts = inverterRating > 0 ? (inverterRating / inverterEfficiency) : 0;
    const maxDCInputCurrent = systemVoltage > 0 ? maxDCInputWatts / systemVoltage : 0;

    // Actual load current
    const dcInputWatts = totalACWatts / inverterEfficiency;
    const dcInputCurrent = systemVoltage > 0 ? dcInputWatts / systemVoltage : 0;

    return { acLoadWatts: totalACWatts, dcInputWatts, dcInputCurrent, acVoltage, maxDCInputCurrent };
  };

  const calculateWire = (wire: Wire, overrideVoltage?: number, componentsOverride?: SchematicComponent[], solverMapOverride?: Map<string, number>) => {
    const comps = componentsOverride || components;
    try {
      // Supported nominal circuits use the exact result shown in review and
      // exports. Other scenarios retain their legacy estimate and are marked
      // unresolved by the review rather than presented as verified there.
      const shared = sharedElectricalAnalysis.wires[wire.id];
      if (loadMode === "nominal" && shared?.calculation && (!componentsOverride || componentsOverride === components) && (!overrideVoltage || overrideVoltage === shared.voltageV)) {
        const result = { ...shared.calculation, totalCurrent: shared.currentA, parallelCount: 1 };
        setWireCalculations(previous => ({ ...previous, [wire.id]: result }));
        return;
      }
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

      // Load mode: nominal = rated as entered; expected = diversity-discounted
      // (not everything runs at once); max = worst case (full loads + inverter at
      // its rated capacity, for fusing/wire sizing).
      const loadFactor = loadMode === 'expected' ? 0.75 : 1;
      const useMaxInverter = loadMode === 'max';
      const inverterCurrentFor = (dc: { dcInputCurrent: number; maxDCInputCurrent: number }) =>
        useMaxInverter ? dc.maxDCInputCurrent : dc.dcInputCurrent * loadFactor;

      // Find connected components to calculate current (define at top level for scope)
      const fromComp = comps.find(c => c.id === wire.fromComponentId);
      const toComp = comps.find(c => c.id === wire.toComponentId);

      // Graph solver: model the DC network rooted at the battery bank and read
      // this wire's current from it. Handles arbitrary radial topologies
      // (chained bus bars, sub-panels, fuses/switches in series, sources).
      const solverMap = solverMapOverride || solveDcWireCurrents(comps, wires, {
        systemVoltage: voltage,
        loadMode,
        inverterDcInput: (id) => {
          const r = calculateInverterDCInput(id, 0.875, comps);
          return { dcInputCurrent: r.dcInputCurrent, maxDCInputCurrent: r.maxDCInputCurrent };
        },
      });
      const solved = solverMap.get(wire.id);
      const hasSolved = solved != null;
      if (hasSolved) {
        current = solved as number;
        // Keep main inverter cables sized for the inverter's capacity even when
        // the present load is small.
        const invDcId =
          (fromComp && (fromComp.type === "inverter" || fromComp.type === "multiplus" || fromComp.type === "phoenix-inverter" || fromComp.type === "quattro") &&
            (wire.fromTerminal === "dc-positive" || wire.fromTerminal === "dc-negative")) ? fromComp.id
          : (toComp && (toComp.type === "inverter" || toComp.type === "multiplus" || toComp.type === "phoenix-inverter" || toComp.type === "quattro") &&
            (wire.toTerminal === "dc-positive" || wire.toTerminal === "dc-negative")) ? toComp.id
          : null;
        if (invDcId) {
          const m = calculateInverterDCInput(invDcId, 0.875, comps).maxDCInputCurrent;
          if (m > (current as number)) (wire as any)._sizingCurrent = m;
        }
      }

      // DC "trunk": the main battery path (battery bank incl. series links,
      // fuses, switches, shunt, and the main +/- bus bars) is a single series
      // loop, so every wire on it carries the same whole-system current. Compute
      // that once so the positive and negative sides agree and pass-through parts
      // (fuses, switches, series battery links) aren't left at a stale default or
      // shown as their device rating.
      const TRUNK_INFRA = new Set(["battery", "fuse", "switch", "smartshunt", "battery-protect", "lynx-distributor", "lynx-power-in", "lynx-shunt", "lynx-smart-bms"]);
      const isTrunkComp = (t?: string) => !!t && (TRUNK_INFRA.has(t) || t.includes("busbar"));
      const isTrunkWire = (wire.polarity === "positive" || wire.polarity === "negative") &&
        isTrunkComp(fromComp?.type) && isTrunkComp(toComp?.type);
      if (isTrunkWire && !hasSolved) {
        let loadA = 0;
        let sourceA = 0;
        for (const c of comps) {
          if (c.type === "inverter" || c.type === "multiplus" || c.type === "phoenix-inverter" || c.type === "quattro") {
            loadA += inverterCurrentFor(calculateInverterDCInput(c.id, 0.875, comps));
          } else if (c.type === "dc-load") {
            const w = (c.properties?.watts || c.properties?.power || 0) as number;
            const v = (c.properties?.voltage as number) || voltage;
            if (w > 0 && v > 0) loadA += (w / v) * loadFactor;
          } else if (c.type === "mppt" || c.type === "blue-smart-charger" || c.type === "orion-dc-dc" || c.type === "alternator") {
            sourceA += (c.type === "mppt"
              ? (c.properties?.maxCurrent || c.properties?.amps || c.properties?.current || 0)
              : (c.properties?.amps || c.properties?.current || 0)) as number;
          }
        }
        current = Math.max(0, loadA - sourceA);
      }

      if (current === 0 && !isTrunkWire && !hasSolved) {

        // Check if this is an inverter DC connection - use inverter DC input current
        const isInverterDCWire = 
          ((fromComp?.type === "multiplus" || fromComp?.type === "phoenix-inverter" || fromComp?.type === "quattro" || fromComp?.type === "inverter") &&
           (wire.fromTerminal === "dc-positive" || wire.fromTerminal === "dc-negative")) ||
          ((toComp?.type === "multiplus" || toComp?.type === "phoenix-inverter" || toComp?.type === "quattro" || toComp?.type === "inverter") &&
           (wire.toTerminal === "dc-positive" || wire.toTerminal === "dc-negative"));
        
        if (isInverterDCWire) {
          const inverterId = fromComp?.type === "multiplus" || fromComp?.type === "phoenix-inverter" || fromComp?.type === "quattro" || fromComp?.type === "inverter"
            ? fromComp.id
            : toComp?.id;
          if (inverterId) {
            const inverterDC = calculateInverterDCInput(inverterId, 0.875, comps);
            current = inverterCurrentFor(inverterDC);
            // Use sizingCurrent (based on capacity) for safety recommendations
            // This ensures main cables are sized for potential load, even if current load is small
            if (inverterDC.maxDCInputCurrent > 0) {
              (wire as any)._sizingCurrent = inverterDC.maxDCInputCurrent;
            }
            
            // Use system voltage for DC side
            if (fromComp?.properties?.voltage) {
              voltage = fromComp.properties.voltage as number;
            } else if (toComp?.properties?.voltage) {
              voltage = toComp.properties.voltage as number;
            }
          }
        } else {
          // Check if this is an inverter AC output wire (to AC panel or AC load)
          const isInverterACWire = 
            ((fromComp?.type === "inverter" || fromComp?.type === "multiplus" || fromComp?.type === "phoenix-inverter" || fromComp?.type === "quattro") &&
             (wire.fromTerminal === "ac-out-hot" || wire.fromTerminal === "ac-out-neutral" || wire.fromTerminal === "ac-out-ground") &&
             (wire.polarity === "hot" || wire.polarity === "neutral" || wire.polarity === "ground")) ||
            ((toComp?.type === "inverter" || toComp?.type === "multiplus" || toComp?.type === "phoenix-inverter" || toComp?.type === "quattro") &&
             (wire.toTerminal === "ac-out-hot" || wire.toTerminal === "ac-out-neutral" || wire.toTerminal === "ac-out-ground") &&
             (wire.polarity === "hot" || wire.polarity === "neutral" || wire.polarity === "ground"));
          
          if (isInverterACWire) {
            const inverterId = fromComp?.type === "inverter" || fromComp?.type === "multiplus" || fromComp?.type === "phoenix-inverter" || fromComp?.type === "quattro"
              ? fromComp.id
              : toComp?.id;
            if (inverterId) {
              const inverterDC = calculateInverterDCInput(inverterId, 0.875, comps);
              if (inverterDC.acLoadWatts > 0) {
                // Hot and neutral carry the full current, ground carries no current
                current = (wire.polarity === "hot" || wire.polarity === "neutral")
                  ? (inverterDC.acLoadWatts / inverterDC.acVoltage)
                  : 0;
                voltage = inverterDC.acVoltage; // Use AC voltage (110V/120V/220V/230V)
              }
            }
          }
          // Special handling for solar panels - use Vmp (maximum power voltage) not system voltage
          else if (fromComp?.type === "solar-panel") {
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
            
            // Special case: Alternator → Orion DC-DC wire carries Orion's charge current, not alternator output
            if (fromComp?.type === "alternator" && toComp?.type === "orion-dc-dc") {
              // Wire from alternator to Orion carries what Orion draws, not alternator's full output
              const orionAmps = (toComp.properties?.amps || toComp.properties?.current || 20) as number;
              current = orionAmps;
            }
            // If wire is FROM an MPPT/charger TO a bus bar or load, use source output current
            else if (fromComp && (fromComp.type === "mppt" || fromComp.type === "blue-smart-charger" || fromComp.type === "orion-dc-dc")) {
              // For MPPT/chargers, use their output current
              // MPPT uses maxCurrent, chargers use amps/current
              const chargeCurrent = fromComp.type === "mppt"
                ? (fromComp.properties?.maxCurrent || fromComp.properties?.amps || fromComp.properties?.current || 0) as number
                : (fromComp.properties?.amps || fromComp.properties?.current || 0) as number;
              if (chargeCurrent > 0) {
                current = chargeCurrent;
              }
            }
            // Alternator output wire (to bus bar, not to Orion) uses alternator's amps
            else if (fromComp?.type === "alternator") {
              const altAmps = (fromComp.properties?.amps || fromComp.properties?.current || 60) as number;
              current = altAmps;
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
            } else if (toComp && toComp.type === "ac-panel" && (wire.polarity === "hot" || wire.polarity === "neutral")) {
              // For wires TO an AC panel (from inverter), calculate from connected AC loads
              const panelWires = wires.filter(
                w => (w.fromComponentId === toComp.id || w.toComponentId === toComp.id) &&
                     w.polarity === "hot" &&
                     w.id !== wire.id
              );
              
              let totalLoadWatts = 0;
              let acVoltage = 120; // Default
              const visitedLoads = new Set<string>();
              
              for (const panelWire of panelWires) {
                const loadCompId = panelWire.fromComponentId === toComp.id 
                  ? panelWire.toComponentId 
                  : panelWire.fromComponentId;
                
                if (!visitedLoads.has(loadCompId)) {
                  visitedLoads.add(loadCompId);
                  const loadComp = comps.find(c => c.id === loadCompId);
                  if (loadComp && loadComp.type === "ac-load") {
                    const loadWatts = (loadComp.properties?.watts || loadComp.properties?.power || 0) as number;
                    totalLoadWatts += loadWatts;
                    const loadVoltage = loadComp.properties?.acVoltage || loadComp.properties?.voltage || 120;
                    if (loadVoltage !== 120) acVoltage = loadVoltage;
                  }
                }
              }
              
              if (totalLoadWatts > 0) {
                current = totalLoadWatts / acVoltage;
                voltage = acVoltage; // Use AC voltage
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
                  const loadComp = comps.find(c => c.id === loadCompId);
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
                
                const otherComp = comps.find(c => c.id === otherCompId);
                if (!otherComp) continue;
                
                // Skip AC loads and AC panels
                if (otherComp.type === "ac-load" || otherComp.type === "ac-panel") continue;
                
                // For inverters, get DC input current (load)
                if (otherComp.type === "inverter" || otherComp.type === "multiplus" || otherComp.type === "phoenix-inverter" || otherComp.type === "quattro") {
                  const inverterDC = calculateInverterDCInput(otherComp.id, 0.875, comps);
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
                      const loadComp = comps.find(c => c.id === loadCompId);
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
                else if (otherComp.type === "mppt" || otherComp.type === "blue-smart-charger" || otherComp.type === "orion-dc-dc" || otherComp.type === "alternator") {
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
                if (otherComp.type === "mppt" || otherComp.type === "blue-smart-charger" || otherComp.type === "orion-dc-dc" || otherComp.type === "alternator") {
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
                    
                    const busBarComp = comps.find(c => c.id === busBarCompId);
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
                        
                        const connectedComp = comps.find(c => c.id === otherCompId);
                        if (!connectedComp) continue;
                        
                        // Skip AC loads and AC panels
                        if (connectedComp.type === "ac-load" || connectedComp.type === "ac-panel") continue;
                        
                        // For inverters, get DC input current (load)
                        if (connectedComp.type === "inverter" || connectedComp.type === "multiplus" || connectedComp.type === "phoenix-inverter" || connectedComp.type === "quattro") {
                          const inverterDC = calculateInverterDCInput(connectedComp.id, 0.875, comps);
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
                              const loadComp = comps.find(c => c.id === loadCompId);
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
                        else if (connectedComp.type === "mppt" || connectedComp.type === "blue-smart-charger" || connectedComp.type === "orion-dc-dc" || connectedComp.type === "alternator") {
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

      // Fallback for Load components if current is still 0
      if (current === 0) {
        const loadComp = (fromComp?.type?.includes("load") ? fromComp : null) || (toComp?.type?.includes("load") ? toComp : null);
        if (loadComp) {
           const w = (loadComp.properties?.watts || loadComp.properties?.power || 0) as number;
           const v = loadComp.type === "ac-load" 
             ? (loadComp.properties?.acVoltage || loadComp.properties?.voltage || 120)
             : (loadComp.properties?.voltage as number || voltage);
             
           if (w > 0 && v > 0) {
             current = w / v;
             if (loadComp.type === "ac-load") voltage = v;
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

      // Calculate current for gauge sizing (may be different from display current for safety)
      const sizingCurrent = (wire as any)._sizingCurrent || current;
      
      // Divide current by number of parallel wires (each wire carries 1/N of total current)
      const currentPerWire = sizingCurrent / parallelCount;

      // Calculate wire size client-side (no server request needed)
      const result = calculateWireSize({
        current: currentPerWire, // Use sizing current per wire
        length: wireLength,
        voltage: voltage,
        conductorMaterial: (wire as any).conductorMaterial || "copper",
        currentGauge: undefined,
      });

      if ((wire as any)._sizingCurrent && (wire as any)._sizingCurrent > current) {
          // Append note about capacity sizing
          result.message = (result.message || "") + ` (Sized for Inverter Capacity: ${(wire as any)._sizingCurrent.toFixed(0)}A)`;
      }
      
      // Store the total current in the result for display purposes
      result.totalCurrent = current;
      result.parallelCount = parallelCount;
      if (shared?.status !== "known" || loadMode !== "nominal") {
        if (result.status === "valid") result.status = "warning";
        result.message = `Legacy estimate (unverified): ${shared?.reason || "This display scenario is outside the shared analyzer's supported checks."} ${result.message || ""}`;
      }
      
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

  const handleComponentSelect = (comp: SchematicComponent | null) => {
    if (!comp) {
      setSelectedComponent(null);
      return;
    }

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
    if (draggedCustomDefinition) {
      // Snapshot the definition's terminals/dimensions into the instance's
      // properties so the placed part keeps working even if the definition
      // is later edited or deleted (see docs/custom-components-design.md).
      const snap = (v: number) => Math.round(v / 20) * 20;
      const definition = draggedCustomDefinition;
      const newComponent: SchematicComponent = {
        id: `comp-${Date.now()}`,
        type: "custom",
        name: definition.name,
        x: snap(x),
        y: snap(y),
        properties: toPlacedProperties(definition),
      };
      setComponents(prev => [...prev, newComponent]);
      setSelectedComponent(newComponent);
      setDraggedCustomDefinition(null);
      return;
    }

    if (!draggedComponentType) return;

    // Get default properties based on component type
    const getDefaultProperties = (type: string): Record<string, any> => {
      const defaults: Record<string, Record<string, any>> = {
        battery: { voltage: systemVoltage, capacity: 200, batteryType: 'LiFePO4' },
        'dc-load': { watts: 50, voltage: systemVoltage },
        'ac-load': { watts: 1000, acVoltage: 120 },
        'solar-panel': { watts: 300, voltage: systemVoltage * 1.5 }, // Default to typical Vmp (1.5x system voltage)
        mppt: { amps: 30, voltage: systemVoltage },
        multiplus: { watts: 3000, powerRating: 3000, voltage: systemVoltage, acOutputVoltage: '120' },
        quattro: { watts: 5000, powerRating: 5000, voltage: systemVoltage, acOutputVoltage: '120' },
        argofet: { amps: 100, voltage: systemVoltage },
        'cyrix-ct': { amps: 120, voltage: systemVoltage },
        inverter: { watts: 2000, voltage: systemVoltage, acOutputVoltage: '120' },
        'phoenix-inverter': { watts: 1200, voltage: systemVoltage, acOutputVoltage: '120' },
        'blue-smart-charger': { amps: 15, voltage: systemVoltage },
        'orion-dc-dc': { amps: 30, voltage: systemVoltage, inputVoltage: systemVoltage, outputVoltage: systemVoltage === 12 ? 24 : 12 },
        'battery-balancer': { voltage: 24 },
        alternator: { amps: 100, current: 100, voltage: systemVoltage },
        'battery-protect': { amps: 100, voltage: systemVoltage },
        fuse: { fuseType: 'class-t', fuseRating: 400, amps: 400 },
        'dc-breaker': { amps: 50, rating: 50, voltage: systemVoltage },
        'ac-breaker': { amps: 30, rating: 30, poles: 2, acVoltage: 120 },
        switch: { voltage: systemVoltage },
        'busbar-positive': { voltage: systemVoltage },
        'busbar-negative': { voltage: systemVoltage },
        cerbo: { voltage: systemVoltage },
        smartshunt: { voltage: systemVoltage },
        'shore-power': { voltage: 120, maxAmps: 30 },
        'transfer-switch': { switchType: 'manual', priority: 'source1' },
        'lynx-power-in': { voltage: systemVoltage, maxCurrent: 1000 },
        'lynx-distributor': { voltage: systemVoltage, maxCurrent: 1000, fuseRating: 125 },
        'lynx-shunt': { voltage: systemVoltage, maxCurrent: 1000, fuseRating: 400 },
        'lynx-smart-bms': { voltage: systemVoltage, amps: 500, maxCurrent: 500 },
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

  const handleAddCustomComponent = (name: string, subtitle: string) => {
    // Place near the center of the canvas, snapped to the 20px grid
    const snap = (v: number) => Math.round(v / 20) * 20;
    const newComponent: SchematicComponent = {
      id: `comp-${Date.now()}`,
      type: "custom",
      name,
      x: snap(900),
      y: snap(700),
      // No `voltage`: like editor-built custom parts, a quick-add box has no
      // voltage field in the properties panel, so a frozen snapshot would go
      // stale against the live system voltage. See toPlacedProperties().
      properties: { subtitle },
    };
    setComponents(prev => [...prev, newComponent]);
    setSelectedComponent(newComponent);
    toast({
      title: "Custom component added",
      description: `"${name}" placed on the canvas`,
    });
  };

  const handleRotateComponents = (componentIds: string[], delta: number) => {
    const ids = new Set(componentIds);
    setComponents(prev => prev.map(comp => {
      if (!ids.has(comp.id)) return comp;
      const current = Number(comp.properties?.rotation ?? 0);
      const rotation = ((current + delta) % 360 + 360) % 360;
      const updated = { ...comp, properties: { ...comp.properties, rotation } };
      if (selectedComponent?.id === comp.id) setSelectedComponent(updated);
      return updated;
    }));
  };

  const handleComponentMove = (componentId: string, deltaX: number, deltaY: number) => {
    setComponents(prev => prev.map(comp =>
      comp.id === componentId
        ? { ...comp, x: comp.x + deltaX, y: comp.y + deltaY }
        : comp
    ));
  };

  const handleComponentDelete = (componentId: string) => {
    updateDocument(previous => ({ ...previous,
      components: previous.components.filter(c => c.id !== componentId),
      wires: previous.wires.filter(w => w.fromComponentId !== componentId && w.toComponentId !== componentId),
    }), { label: "delete component" });
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
    updateDocument(previous => ({ ...previous,
      components: [...previous.components, ...newComponents], wires: [...previous.wires, ...newWires],
    }), { label: "paste selection" });
    
    // Select the newly pasted components
    setSelectedComponent(newComponents[0]);
    
    toast({
      title: "Pasted",
      description: `Pasted ${newComponents.length} component${newComponents.length !== 1 ? 's' : ''} and ${newWires.length} wire${newWires.length !== 1 ? 's' : ''}`,
    });
  };

  const handleClearAll = () => {
    // Clear all components and wires
    updateDocument(previous => ({ ...previous, components: [], wires: [] }), { label: "clear canvas" });
    setSelectedComponent(null);
    setSelectedWire(null);
    setWireCalculations({});
    setCopiedComponents([]);
    setCopiedWires([]);
    
    // Clear auto-saved state
    localStorage.removeItem("autoSavedDiagramState");
    
    // Clear validation

    
    toast({
      title: "Cleared",
      description: "All components and wires have been removed",
    });
    
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
    let polarity: Wire["polarity"] = "positive";
    const t1 = wireData.fromTerminal.type;
    const t2 = wireData.toTerminal.type;

    // Check for AC wire polarities first (hot, neutral, ground)
    if (t1.includes("hot") || t2.includes("hot") || t1 === "hot" || t2 === "hot") {
      polarity = "hot";
    } else if (t1.includes("neutral") || t2.includes("neutral") || t1 === "neutral" || t2 === "neutral") {
      polarity = "neutral";
    } else if (t1.includes("ground") || t2.includes("ground") || t1 === "ground" || t2 === "ground") {
      polarity = "ground";
    } else if (t1 === "negative" || t2 === "negative" || t1 === "pv-negative" || t2 === "pv-negative") {
      polarity = "negative";
    } else if (t1 === "ac-in" || t2 === "ac-in" || t1 === "ac-out" || t2 === "ac-out") {
      // Fallback for generic AC terminals - check for specific types
      if (wireData.fromTerminal.id.includes("neutral") || wireData.toTerminal.id.includes("neutral")) {
        polarity = "neutral";
      } else if (wireData.fromTerminal.id.includes("ground") || wireData.toTerminal.id.includes("ground")) {
        polarity = "ground";
      } else {
        // Default to hot for AC if not explicitly neutral/ground
        polarity = "hot";
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
        currentGauge: undefined,
        insulationType: "105C",
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

  // Check if there are any wire-related issues
  const hasWireIssues = validationResult?.issues.some(issue => 
    issue.category === "wire-sizing" || 
    issue.wireId !== undefined || 
    (issue.wireIds && issue.wireIds.length > 0)
  ) ?? false;

  return (
    <div className="h-screen flex flex-col bg-background">
      <Dialog open={wireBlockers.length > 0} onOpenChange={open => { if (!open) setWireBlockers([]); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Before AI Wire</DialogTitle>
            <DialogDescription>Review these missing items and settings so the AI can wire your equipment.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-[55vh] overflow-y-auto space-y-4">
            {wireBlockers.map((issue, index) => <li key={index} className="text-sm space-y-2">
              <p>{issue.message}</p>
              {issue.componentIds.some(id => components.some(c => c.id === id)) && <Button variant="outline" size="sm" onClick={() => {
                const component = components.find(c => issue.componentIds.includes(c.id));
                if (component) { setSelectedComponent(component); setSelectedWire(null); setRightPanelOpen(true); setCanvasMode('2d'); }
                setWireBlockers([]);
              }}>Show equipment</Button>}
            </li>)}
          </ul>
        </DialogContent>
      </Dialog>
      <TopBar
        onUndo={undo} onRedo={redo} canUndo={canUndo} canRedo={canRedo} undoLabel={undoLabel} redoLabel={redoLabel}
        canvasMode={canvasMode}
        onCanvasModeChange={mode => { setWireConnectionMode(false); setCanvasMode(mode); }}
        onAIPrompt={() => setAiDialogOpen(true)}
        onAIWire={() => aiWireMutation.mutate()}
        onExport={() => { setCanvasMode("2d"); setExportDialogOpen(true); }}
        onSave={() => { setCanvasMode("2d"); setSaveDialogOpen(true); }}
        onOpen={() => setOpenDialogOpen(true)}
        onWireMode={() => { setCanvasMode("2d"); setWireConnectionMode(!wireConnectionMode); }}
        onDesignQuality={() => setDesignQualitySheetOpen(true)}
        onEstimates={() => setShowEstimates(true)}
        onFeedback={() => { setCanvasMode("2d"); setFeedbackDialogOpen(true); }}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onClear={handleClearAll}
        onShowDisclaimer={showDisclaimer}
        wireMode={wireConnectionMode}
        hasComponents={components.length > 0}
        reviewStatus={designReview.status}
        reviewErrorCount={validationResult?.issues.filter(i => i.severity === "error").length}
        reviewUnresolvedCount={validationResult?.issues.filter(i => i.category === "unresolved").length}
        user={user}
        currentDesignName={currentDesignName || undefined}
        isAIWiring={aiWireMutation.isPending}
        aiBlockedReason={aiBlockedReason}
        showWireLabels={showWireLabels}
        onToggleWireLabels={() => setShowWireLabels(!showWireLabels)}
        wireGaugeFormat={wireGaugeFormat}
        onWireGaugeFormatChange={setWireGaugeFormat}
        lengthUnit={lengthUnit}
        onLengthUnitChange={setLengthUnit}
        viewMode={viewMode}
        onToggleViewMode={() => setViewMode(viewMode === 'standard' ? 'load' : 'standard')}
        loadMode={loadMode}
        onLoadModeChange={setLoadMode}
        systemVoltage={systemVoltage}
        hasWireIssues={hasWireIssues}
      />

      <div className="flex items-center justify-end gap-2 border-b px-4 py-1 text-xs text-muted-foreground" aria-live="polite">
        <span>{cloudSave.status}</span>
        {(cloudSave.status === "Save failed" || cloudSave.status === "Sign-in required") && <Button size="sm" variant="ghost" onClick={cloudSave.retry}>Retry save</Button>}
        {cloudSave.conflict && <><span>Another session saved this design. Your local work is kept.</span><Button size="sm" variant="outline" onClick={()=>handleLoadDesign(cloudSave.conflict)}>Load cloud copy</Button><Button size="sm" variant="outline" onClick={()=>setSaveDialogOpen(true)}>Save local copy</Button></>}
      </div>
      <DisclaimerDialog
        open={disclaimerOpen}
        onOpenChange={setDisclaimerOpen}
        onAccept={acceptDisclaimer}
        reviewOnly={disclaimerReviewOnly}
      />

      <div className="flex-1 flex overflow-hidden">
        {leftPanelOpen && (
          <ComponentLibrary
            onDragStart={(comp) => { setCanvasMode("2d"); setDraggedComponentType(comp.id); }}
            onAddCustom={() => setCustomDialogOpen(true)}
            isAuthenticated={!!user}
            onDragStartCustomDefinition={(def) => { setCanvasMode("2d"); setDraggedCustomDefinition(def); }}
            onCreateCustomDefinition={() => {
              setEditingCustomDefinition(null);
              setCustomComponentEditorOpen(true);
            }}
            onEditCustomDefinition={(def) => {
              setEditingCustomDefinition(def);
              setCustomComponentEditorOpen(true);
            }}
            onDeleteCustomDefinition={(def) => setDeleteCustomTarget(def)}
          />
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-5 shrink-0 self-center rounded-none rounded-r-md border border-l-0 bg-card"
              onClick={toggleLeftPanel}
              data-testid="button-toggle-left-panel"
            >
              {leftPanelOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{leftPanelOpen ? "Hide component library" : "Show component library"}</TooltipContent>
        </Tooltip>

        <CanvasViewTransition mode={canvasMode} render3D={onReady => <Suspense fallback={null}>
            <Design3DView onReady={onReady} components={components} wires={wires} routingOptions={wireRoutingOptions}
              showWireLabels={showWireLabels} wireGaugeFormat={wireGaugeFormat} lengthUnit={lengthUnit}
              viewMode={viewMode} wireCalculations={wireCalculations}
              selectedComponentId={selectedComponent?.id} selectedWireId={selectedWire?.id}
              onComponentMove={handleComponentMove}
              onComponentSelect={component => { handleComponentSelect(component); setRightPanelOpen(true); }}
              onWireSelect={wire => { handleWireSelect(wire); setRightPanelOpen(true); }}
              onBack={() => setCanvasMode("2d")} />
          </Suspense>} editor={
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
          onEditStart={beginTransaction}
          onEditEnd={endTransaction}
          onComponentDelete={handleComponentDelete}
          onWireConnectionComplete={handleWireConnectionComplete}
          onWireDelete={handleWireDelete}
          onWireUpdate={handleWireUpdate}
          onRotateComponents={handleRotateComponents}
          wireConnectionMode={wireConnectionMode}
          wireStartComponent={wireStartComponent}
          showWireLabels={showWireLabels}
          wireGaugeFormat={wireGaugeFormat}
          lengthUnit={lengthUnit}
          viewMode={viewMode}
          wireCalculations={wireCalculations}
          onCopy={handleCopy}
          onPaste={handlePaste}
          wireRoutingOptions={wireRoutingOptions}
          onWireRoutingOptionsChange={setWireRoutingOptions}
          showWireRoutingSelector={wireRoutingSelectorEnabled}
        />
        } />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-5 shrink-0 self-center rounded-none rounded-l-md border border-r-0 bg-card"
              onClick={toggleRightPanel}
              data-testid="button-toggle-right-panel"
            >
              {rightPanelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">{rightPanelOpen ? "Hide properties panel" : "Show properties panel"}</TooltipContent>
        </Tooltip>

        {rightPanelOpen && (
        <div className="contents" onFocusCapture={event => {
          if ((event.target as HTMLElement).matches('input, textarea, [contenteditable="true"]')) beginTransaction("edit properties");
        }} onBlurCapture={event => {
          if ((event.target as HTMLElement).matches('input, textarea, [contenteditable="true"]')) endTransaction();
        }}>
        <PropertiesPanel
          selectedComponent={selectedComponent || undefined}
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
          lengthUnit={lengthUnit}
          onUpdateWire={handleWireUpdate}
          onWireSelect={handleWireSelect}
          onComponentSelect={handleComponentSelect}
          onCreateParallelWires={handleCreateParallelWires}
          onDeleteComponent={handleComponentDelete}
          onDeleteWire={handleWireDelete}
          onUpdateComponent={(id, updates) => {
            // Create updated components list first
            const updatedComponents = components.map(comp => {
              if (comp.id === id) {
                const updatedComp = { ...comp, ...updates };
                // Also update selected component state to reflect changes immediately
                if (selectedComponent?.id === id) {
                  setSelectedComponent(updatedComp);
                }
                return updatedComp;
              }
              return comp;
            });
            
            setComponents(updatedComponents);

            // Trigger wire recalculation if properties changed
            if (updates.properties) {
              // Find ALL connected wires and recalculate them
              const connectedWires = wires.filter(
                (w) => w.fromComponentId === id || w.toComponentId === id
              );
              
              // Use setTimeout to ensure React state has updated before recalculating
              setTimeout(() => {
                connectedWires.forEach(wire => {
                  calculateWire(wire);
                });
              }, 0);
            }
          }}
        />
        </div>
        )}
      </div>

      <AIPromptDialog
        open={aiDialogOpen}
        onOpenChange={(open) => {
          if (!open && isAiGenerating) {
            aiGenerationController.current?.abort();
            setIterationProgress(null);
          }
          setAiDialogOpen(open);
        }}
        onGenerate={(prompt, requirements) => handleAIGenerateWithStreaming(prompt, requirements)}
        systemVoltage={systemVoltage}
        existingComponents={components}
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
        revision={designDocument.metadata.cloudVersion ? `Cloud version ${designDocument.metadata.cloudVersion}` : undefined}
        wireGaugeFormat={wireGaugeFormat}
        lengthUnit={lengthUnit}
        requirementIssues={(() => {
          if (!designDocument.requirements) return [];
          const parsed = designRequirementsSchema.safeParse(designDocument.requirements);
          if (!parsed.success) return ["The saved requirements checklist could not be checked."];
          const check = checkDesignRequirements(parsed.data, components, wires, systemVoltage);
          return check.issues.map(issue => issue.message);
        })()}
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
        document={designDocument}
        existingVersion={Number(designDocument.metadata.cloudVersion) || undefined}
        onSaved={handleDesignSaved}
      />

      <OpenDesignDialog
        open={openDialogOpen}
        onOpenChange={setOpenDialogOpen}
        onLoad={handleLoadDesign}
      />

      <CustomComponentDialog
        open={customDialogOpen}
        onOpenChange={setCustomDialogOpen}
        onAdd={handleAddCustomComponent}
      />

      <CustomComponentEditor
        open={customComponentEditorOpen}
        onOpenChange={setCustomComponentEditorOpen}
        definition={editingCustomDefinition}
      />

      <AlertDialog open={!!deleteCustomTarget} onOpenChange={(open) => !open && setDeleteCustomTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteCustomTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the definition from your Custom Components library. Copies already
              placed on the canvas keep working - they snapshot their own terminals - but
              you won't be able to place new copies of this part.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteCustomTarget) deleteCustomComponentMutation.mutate(deleteCustomTarget.id);
                setDeleteCustomTarget(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Keep the same progress view if the dialog is hidden while running. */}
      {iterationProgress && !aiDialogOpen && (
        <div className="fixed top-20 right-4 z-50 w-[min(32rem,calc(100vw-2rem))] rounded-lg border bg-background p-4 shadow-xl">
          <AIGenerationProgress progress={iterationProgress} onStop={() => {
            aiGenerationController.current?.abort();
            setIterationProgress(null);
          }} />
        </div>
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
              validationResult={designReview.result}
              status={designReview.status}
              error={designReview.error}
              onValidate={validateDesign}
              onApplyGaugeFix={(wireId, gauge) => updateDocument(previous => ({ ...previous,
                wires: previous.wires.map(wire => wire.id === wireId ? { ...wire, gauge } : wire),
              }), { label: "apply reviewed wire gauge" })}
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

      <RuntimeEstimatesDialog
        open={showEstimates}
        onOpenChange={setShowEstimates}
        components={components}
        systemVoltage={systemVoltage}
      />

    </div>
  );
}
