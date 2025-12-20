import { useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Calculator, Settings, ShoppingCart, Tag, AlertCircle, Info, ChevronLeft } from "lucide-react";
import type { ValidationResult, Wire, SchematicComponent } from "@shared/schema";
import { SaveFeedback } from "@/components/SaveFeedback";

interface WireCalculation {
  current?: number;
  length?: number;
  voltage?: number;
  recommendedGauge?: string;
  voltageDrop?: number;
  voltageDropPercent?: number;
  status?: "valid" | "warning" | "error";
}

interface PropertiesPanelProps {
  selectedComponent?: {
    id: string;
    type: string;
    name: string;
    properties?: {
      voltage?: number;
      current?: number;
      power?: number;
      watts?: number;
      amps?: number;
      capacity?: number;
      batteryType?: string;
      fuseRating?: number;
      [key: string]: any;
    };
  };
  selectedWire?: {
    id: string;
    fromComponentId: string;
    toComponentId: string;
    fromTerminal: string;
    toTerminal: string;
    polarity: string;
    gauge?: string;
    length: number;
  };
  wireCalculation?: WireCalculation; // For backward compatibility when wire is selected
  wireCalculations?: Record<string, WireCalculation>; // Map of wireId -> calculation
  validationResult?: ValidationResult | null;
  wires?: Wire[];
  components?: SchematicComponent[];
  onEditWire?: (wire: any) => void;
  onUpdateComponent?: (id: string, updates: any) => void;
  onUpdateWire?: (wireId: string, updates: Partial<Wire>) => void;
  onWireSelect?: (wire: Wire | null) => void;
  onComponentSelect?: (component: SchematicComponent | null) => void;
}

// Helper function to get available voltages for a component type
function getAvailableVoltages(componentType: string): number[] {
  switch (componentType) {
    case 'ac-load':
      // AC loads use AC voltages (110V/120V/220V/230V)
      return [110, 120, 220, 230];
    case 'multiplus':
    case 'phoenix-inverter':
    case 'mppt':
    case 'battery-protect':
    case 'inverter':
    case 'cerbo':
    case 'smartshunt':
    case 'battery':
      return [12, 24, 48];
    case 'blue-smart-charger':
    case 'orion-dc-dc':
      return [12, 24];
    case 'dc-load':
      // DC loads use DC voltages
      return [12, 24, 48];
    default:
      // Generic components - common DC voltages
      return [12, 24, 48];
  }
}

// All components now use 'watts' consistently

// Calculate bus bar totals from connected components
function calculateBusBarTotals(
  busBarId: string,
  busBarType: string,
  wires: Wire[] = [],
  components: SchematicComponent[] = []
): { totalCurrent: number; totalWatts: number; voltage: number } {
  // Find all wires connected to this bus bar
  const connectedWires = wires.filter(
    w => w.fromComponentId === busBarId || w.toComponentId === busBarId
  );

  let totalCurrent = 0;
  let totalWatts = 0;
  let voltage = 12; // Default

  // For each connected wire, find the component on the other end
  connectedWires.forEach(wire => {
    const otherComponentId = wire.fromComponentId === busBarId 
      ? wire.toComponentId 
      : wire.fromComponentId;
    
    const otherComponent = components.find(c => c.id === otherComponentId);
    if (!otherComponent) return;

    const props = otherComponent.properties || {};
    
    // Get voltage from bus bar or connected component
    if (props.voltage) {
      voltage = props.voltage;
    }

    // Calculate current/watts from the component
    // For loads: use their watts/current
    // For sources (chargers, inverters): use their output
    if (otherComponent.type === 'dc-load' || otherComponent.type === 'ac-load') {
      const loadWatts = props.watts || props.power || 0;
      const loadCurrent = props.current || props.amps || 0;
      
      if (loadWatts > 0) {
        totalWatts += loadWatts;
        totalCurrent += loadWatts / (props.voltage || voltage);
      } else if (loadCurrent > 0) {
        totalCurrent += loadCurrent;
        totalWatts += loadCurrent * (props.voltage || voltage);
      }
    } else if (otherComponent.type === 'inverter' || otherComponent.type === 'phoenix-inverter') {
      // Inverters draw current from DC side
      const inverterWatts = props.watts || props.powerRating || 0;
      if (inverterWatts > 0) {
        totalWatts += inverterWatts;
        totalCurrent += inverterWatts / (props.voltage || voltage);
      }
    } else if (otherComponent.type === 'mppt' || otherComponent.type === 'blue-smart-charger' || otherComponent.type === 'orion-dc-dc') {
      // Chargers output current to bus bar
      const chargeCurrent = props.amps || props.current || 0;
      if (chargeCurrent > 0) {
        totalCurrent += chargeCurrent;
        totalWatts += chargeCurrent * (props.voltage || voltage);
      }
    }
  });

  return { totalCurrent, totalWatts, voltage };
}

/**
 * Calculate inverter DC input power from connected AC loads
 * Similar to calculateBusBarTotals but for inverters
 */
function calculateInverterDCInput(
  inverterId: string,
  wires: Wire[] = [],
  components: SchematicComponent[] = [],
  systemVoltage: number = 12,
  inverterEfficiency: number = 0.875
): { acLoadWatts: number; dcInputWatts: number; dcInputCurrent: number; acVoltage: number } {
  const inverter = components.find(c => c.id === inverterId);
  if (!inverter || (inverter.type !== "multiplus" && inverter.type !== "phoenix-inverter" && inverter.type !== "inverter")) {
    return { acLoadWatts: 0, dcInputWatts: 0, dcInputCurrent: 0, acVoltage: 120 };
  }

  // Find all AC loads connected to this inverter
  // Trace from inverter AC output terminals to AC loads
  const inverterACOutputTerminals = ["ac-out-hot", "ac-out-neutral"];
  let totalACWatts = 0;
  let acVoltage = 120; // Default

  // Helper to find AC loads connected through AC panels
  const findACLoads = (componentId: string, visited: Set<string> = new Set()): { watts: number; voltage: number } => {
    if (visited.has(componentId)) return { watts: 0, voltage: 120 };
    visited.add(componentId);

    const comp = components.find(c => c.id === componentId);
    if (!comp) return { watts: 0, voltage: 120 };

    // If this is an AC load, return its watts and voltage
    if (comp.type === "ac-load") {
      const loadWatts = (comp.properties?.watts || comp.properties?.power || 0) as number;
      const loadVoltage = comp.properties?.acVoltage || comp.properties?.voltage || 120;
      return { watts: loadWatts, voltage: loadVoltage };
    }

    // If this is an AC panel, trace through to its loads
    // Only trace from "hot" wires to avoid double-counting
    if (comp.type === "ac-panel") {
      let panelWatts = 0;
      let panelVoltage = 120;
      const panelWires = wires.filter(
        w => (w.fromComponentId === componentId || w.toComponentId === componentId) &&
             w.polarity === "hot" // Only trace from hot wires
      );
      
      const panelVisited = new Set<string>();
      for (const panelWire of panelWires) {
        const otherCompId = panelWire.fromComponentId === componentId 
          ? panelWire.toComponentId 
          : panelWire.fromComponentId;
        
        // Only count each load once
        if (!panelVisited.has(otherCompId)) {
          panelVisited.add(otherCompId);
          const result = findACLoads(otherCompId, new Set(visited));
          panelWatts += result.watts;
          if (result.voltage !== 120) panelVoltage = result.voltage; // Use first non-default voltage
        }
      }
      return { watts: panelWatts, voltage: panelVoltage };
    }

    // For other AC components, trace through
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

  // Find wires connected to inverter AC output terminals
  // Only trace from "hot" wire to avoid double-counting (hot and neutral go to same loads)
  const inverterACWires = wires.filter(
    w => (w.fromComponentId === inverterId || w.toComponentId === inverterId) &&
         ((w.fromTerminal === "ac-out-hot" && w.fromComponentId === inverterId) ||
          (w.toTerminal === "ac-out-hot" && w.toComponentId === inverterId))
  );

  // Track visited components to avoid double-counting
  const visitedComponents = new Set<string>();
  
  for (const acWire of inverterACWires) {
    const otherCompId = acWire.fromComponentId === inverterId 
      ? acWire.toComponentId 
      : acWire.fromComponentId;
    
    // Only process each component once
    if (!visitedComponents.has(otherCompId)) {
      visitedComponents.add(otherCompId);
      const result = findACLoads(otherCompId, new Set());
      totalACWatts += result.watts;
      if (result.voltage !== 120) acVoltage = result.voltage;
    }
  }

  // If no AC loads found via tracing, check if inverter has a power rating
  // and assume it's being used at that capacity
  if (totalACWatts === 0) {
    const inverterRating = (inverter.properties?.powerRating || inverter.properties?.watts || inverter.properties?.power || 0) as number;
    if (inverterRating > 0) {
      // Assume 80% utilization
      totalACWatts = inverterRating * 0.8;
    }
  }

  // Calculate DC input power: AC output / efficiency
  const dcInputWatts = totalACWatts / inverterEfficiency;
  
  // Calculate DC current: DC power / DC voltage
  const dcInputCurrent = systemVoltage > 0 ? dcInputWatts / systemVoltage : 0;

  return { acLoadWatts: totalACWatts, dcInputWatts, dcInputCurrent, acVoltage };
}

export function PropertiesPanel({ selectedComponent, selectedWire, wireCalculation, wireCalculations = {}, validationResult, wires = [], components = [], onEditWire, onUpdateComponent, onUpdateWire, onWireSelect, onComponentSelect }: PropertiesPanelProps) {
  // State for controlled inputs with auto-calculation
  const [voltage, setVoltage] = useState<number>(12);
  const [current, setCurrent] = useState<number>(0);
  const [watts, setWatts] = useState<number>(0);
  
  // Battery-specific state
  const [batteryType, setBatteryType] = useState<string>('LiFePO4');
  const [capacity, setCapacity] = useState<number>(200);
  
  // Fuse-specific state
  const [fuseRating, setFuseRating] = useState<number>(400);
  
  // Inverter-specific state (separate from generic watts)
  const [inverterWatts, setInverterWatts] = useState<number>(3000);

  // Wire editing state
  const [wireGauge, setWireGauge] = useState<string>("");
  const [wirePolarity, setWirePolarity] = useState<string>("positive");
  const [wireLength, setWireLength] = useState<string>("0");
  const [wireMaterial, setWireMaterial] = useState<string>("copper");

  // Save feedback state
  const [showSaveFeedback, setShowSaveFeedback] = useState(false);

  // Sync state when selectedComponent changes
  useEffect(() => {
    if (selectedComponent) {
      const props = selectedComponent.properties || {};
      // For AC loads, use acVoltage property, fallback to voltage, then default
      // For AC loads, use acVoltage property, fallback to voltage, then default
      const componentVoltage = selectedComponent.type === 'ac-load'
        ? (props.acVoltage || props.voltage || 120)
        : (props.voltage || 12);
      setVoltage(componentVoltage);
      
      // Get watts and current from properties
      const componentWatts = props.watts || props.power || 0;
      setWatts(componentWatts);
      
      // For components that use amps, prioritize amps over current
      let componentCurrent = 0;
      if (['mppt', 'blue-smart-charger', 'orion-dc-dc', 'battery-protect'].includes(selectedComponent.type)) {
        componentCurrent = props.amps || props.current || 0;
      } else {
        componentCurrent = props.current || props.amps || 0;
      }
      
      // Auto-calculate current from watts if current is missing/zero but watts is set
      // This handles cases where components are created with default watts but no current
      if (componentCurrent === 0 && componentWatts > 0 && componentVoltage > 0) {
        componentCurrent = componentWatts / componentVoltage;
      }
      
      setCurrent(componentCurrent);
      setBatteryType(props.batteryType || 'LiFePO4');
      setCapacity(props.capacity || 200);
      setFuseRating(props.fuseRating || props.amps || 400);
      setInverterWatts(props.watts || props.powerRating || 3000);
    }
  }, [selectedComponent?.id, selectedComponent?.properties, selectedComponent?.type]);

  // Sync wire state when selectedWire changes
  useEffect(() => {
    if (selectedWire) {
      const gaugeValue = selectedWire.gauge ? selectedWire.gauge.replace(" AWG", "") : "10";
      setWireGauge(gaugeValue);
      setWirePolarity(selectedWire.polarity || "positive");
      setWireLength(selectedWire.length?.toString() || "0");
      setWireMaterial((selectedWire as any).conductorMaterial || "copper");
    }
  }, [selectedWire?.id, selectedWire?.gauge, selectedWire?.polarity, selectedWire?.length]);

  // Handle voltage change - recalculate current if watts is set
  const handleVoltageChange = (newVoltage: number) => {
    if (isNaN(newVoltage) || newVoltage <= 0) return;

    setVoltage(newVoltage);

    // For AC loads, store in acVoltage property; for others, use voltage property
    const voltageProperty = selectedComponent!.type === 'ac-load' 
      ? { acVoltage: newVoltage }
      : { voltage: newVoltage };

    // Recalculate current based on watts if watts is non-zero
    if (watts > 0) {
      const newCurrent = watts / newVoltage;
      setCurrent(newCurrent);
      onUpdateComponent?.(selectedComponent!.id, {
        properties: { ...selectedComponent!.properties, ...voltageProperty, current: newCurrent, watts }
      });
      triggerSaveFeedback();
    } else {
      onUpdateComponent?.(selectedComponent!.id, {
        properties: { ...selectedComponent!.properties, ...voltageProperty, current, watts }
      });
      triggerSaveFeedback();
    }
  };

  // Handle current (amps) change - auto-calculate watts
  const handleCurrentChange = (newCurrent: number) => {
    if (isNaN(newCurrent)) return;

    setCurrent(newCurrent);

    // Auto-calculate watts: P = V × I
    const newWatts = voltage * newCurrent;
    setWatts(newWatts);

    onUpdateComponent?.(selectedComponent!.id, {
      properties: { ...selectedComponent!.properties, voltage, current: newCurrent, watts: newWatts }
    });
    triggerSaveFeedback();
  };

  // Handle watts change - auto-calculate current
  const handleWattsChange = (newWatts: number) => {
    if (isNaN(newWatts)) return;

    setWatts(newWatts);

    // Auto-calculate current: I = P / V
    if (voltage > 0) {
      const newCurrent = newWatts / voltage;
      setCurrent(newCurrent);

      onUpdateComponent?.(selectedComponent!.id, {
        properties: { ...selectedComponent!.properties, voltage, current: newCurrent, watts: newWatts }
      });
      triggerSaveFeedback();
    } else {
      onUpdateComponent?.(selectedComponent!.id, {
        properties: { ...selectedComponent!.properties, voltage, current, watts: newWatts }
      });
      triggerSaveFeedback();
    }
  };

  // Trigger save feedback - reset first to ensure animation triggers
  const triggerSaveFeedback = () => {
    setShowSaveFeedback(false);
    // Use setTimeout to ensure state reset happens before setting to true
    setTimeout(() => {
      setShowSaveFeedback(true);
    }, 10);
  };

  // Handle wire property updates
  const handleWireGaugeChange = (value: string) => {
    if (!selectedWire || !onUpdateWire) return;
    const formattedGauge = value && !value.endsWith("AWG") ? `${value} AWG` : value;
    setWireGauge(value);
    onUpdateWire(selectedWire.id, { gauge: formattedGauge });
    triggerSaveFeedback();
  };

  const handleWirePolarityChange = (value: string) => {
    if (!selectedWire || !onUpdateWire) return;
    setWirePolarity(value);
    onUpdateWire(selectedWire.id, { polarity: value as "positive" | "negative" | "ground" });
    triggerSaveFeedback();
  };

  const handleWireLengthChange = (value: string) => {
    if (!selectedWire || !onUpdateWire) return;
    const length = parseFloat(value) || 0;
    setWireLength(value);
    onUpdateWire(selectedWire.id, { length });
    triggerSaveFeedback();
  };

  const handleWireMaterialChange = (value: string) => {
    if (!selectedWire || !onUpdateWire) return;
    setWireMaterial(value);
    onUpdateWire(selectedWire.id, { conductorMaterial: value as "copper" | "aluminum" });
    triggerSaveFeedback();
  };

  return (
    <div className="w-80 border-l bg-card flex flex-col h-full relative">
      <SaveFeedback show={showSaveFeedback} />
      <div className="p-4 border-b">
        <h2 className="font-semibold text-lg">Properties</h2>
      </div>

      <Tabs defaultValue="properties" className="flex-1 flex flex-col min-h-0">
        <TabsList className="mx-4 mt-4 flex-shrink-0">
          <TabsTrigger value="properties" className="flex-1 gap-2" data-testid="tab-properties">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="calculations" className="flex-1 gap-2" data-testid="tab-calculations">
            <Calculator className="h-4 w-4" />
            Calc
          </TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1 min-h-0">
          <TabsContent value="properties" className="p-4 space-y-4 mt-0 pr-2">
            {/* Display issues for selected component or wire */}
            {(() => {
              const relevantIssues = validationResult?.issues.filter(issue => {
                if (selectedComponent && issue.componentIds?.includes(selectedComponent.id)) {
                  return true;
                }
                if (selectedWire && (issue.wireId === selectedWire.id || issue.wireIds?.includes(selectedWire.id))) {
                  return true;
                }
                return false;
              }) || [];

              if (relevantIssues.length > 0) {
                return (
                  <div className="space-y-2 mb-4">
                    <Label className="text-sm font-semibold">Issues</Label>
                    {relevantIssues.map((issue, idx) => (
                      <Alert
                        key={idx}
                        variant={issue.severity === "error" ? "destructive" : issue.severity === "warning" ? "default" : "default"}
                        className={issue.severity === "warning" ? "border-yellow-500 bg-yellow-50 dark:bg-yellow-950/30" : ""}
                      >
                        {issue.severity === "error" ? (
                          <AlertCircle className="h-4 w-4 text-red-600" />
                        ) : issue.severity === "warning" ? (
                          <AlertCircle className="h-4 w-4 text-yellow-600" />
                        ) : (
                          <Info className="h-4 w-4 text-blue-600" />
                        )}
                        <AlertTitle className="text-sm font-semibold">
                          {issue.severity === "error" ? "Error" : issue.severity === "warning" ? "Warning" : "Info"}
                        </AlertTitle>
                        <AlertDescription className="text-sm">
                          <div className="mt-1">{issue.message}</div>
                          {issue.suggestion && (
                            <div className="mt-2 text-xs text-muted-foreground">
                              <strong>Suggestion:</strong> {issue.suggestion}
                            </div>
                          )}
                        </AlertDescription>
                      </Alert>
                    ))}
                    <Separator className="my-4" />
                  </div>
                );
              }
              return null;
            })()}

            {selectedWire ? (
              <div key={selectedWire.id}>
                <div className="space-y-2">
                  <Label>Wire Connection</Label>
                  <div className="text-sm text-muted-foreground p-2 bg-muted rounded-md">
                    {selectedWire.fromComponentId} → {selectedWire.toComponentId}
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="text-sm font-medium">Wire Properties</h3>
                  <div className="space-y-2">
                    <Label>Polarity</Label>
                    <Select value={wirePolarity} onValueChange={handleWirePolarityChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select polarity" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="positive">Positive (+)</SelectItem>
                        <SelectItem value="negative">Negative (-)</SelectItem>
                        <SelectItem value="ground">Ground</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Wire Gauge</Label>
                    <Select value={wireGauge} onValueChange={handleWireGaugeChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select gauge" />
                      </SelectTrigger>
                      <SelectContent>
                        {["4/0", "2/0", "1/0", "2", "4", "6", "8", "10", "12", "14", "16"].map(g => (
                          <SelectItem key={g} value={g}>{g} AWG</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Length (ft)</Label>
                    <Input
                      type="number"
                      value={wireLength}
                      onChange={(e) => handleWireLengthChange(e.target.value)}
                      data-testid="input-wire-length"
                      step="0.1"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Conductor Material</Label>
                    <Select value={wireMaterial} onValueChange={handleWireMaterialChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select material" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="copper">Copper</SelectItem>
                        <SelectItem value="aluminum">Aluminum</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label>From Terminal</Label>
                    <Input
                      value={selectedWire.fromTerminal}
                      data-testid="input-from-terminal"
                      readOnly
                      className="bg-muted"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>To Terminal</Label>
                    <Input
                      value={selectedWire.toTerminal}
                      data-testid="input-to-terminal"
                      readOnly
                      className="bg-muted"
                    />
                  </div>
                </div>
              </div>
            ) : selectedComponent ? (
              <div key={selectedComponent.id}>
                <div className="space-y-2">
                  <Label>Component Name</Label>
                  <Input
                    defaultValue={selectedComponent.name}
                    data-testid="input-component-name"
                    onChange={(e) => {
                      onUpdateComponent?.(selectedComponent.id, { name: e.target.value });
                      triggerSaveFeedback();
                    }}
                  />
                </div>

                <Separator />

                {/* Battery-specific properties */}
                {selectedComponent.type === 'battery' && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium">Battery Specifications</h3>
                    <div className="space-y-2">
                      <Label>Battery Type</Label>
                      <Select
                        value={batteryType}
                        onValueChange={(value) => {
                          setBatteryType(value);
                          onUpdateComponent?.(selectedComponent.id, {
                            properties: { ...selectedComponent.properties, batteryType: value }
                          });
                          triggerSaveFeedback();
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select battery type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="LiFePO4">LiFePO4 (Lithium Iron Phosphate)</SelectItem>
                          <SelectItem value="AGM">AGM (Absorbed Glass Mat)</SelectItem>
                          <SelectItem value="Lithium">Lithium Ion</SelectItem>
                          <SelectItem value="GEL">GEL</SelectItem>
                          <SelectItem value="FLA">Flooded Lead Acid</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Voltage (V)</Label>
                      <Select
                        value={voltage.toString()}
                        onValueChange={(value) => {
                          const v = parseInt(value);
                          setVoltage(v);
                          onUpdateComponent?.(selectedComponent.id, {
                            properties: { ...selectedComponent.properties, voltage: v }
                          });
                          triggerSaveFeedback();
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select voltage" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="12">12V</SelectItem>
                          <SelectItem value="24">24V</SelectItem>
                          <SelectItem value="48">48V</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Capacity (Ah)</Label>
                      <Input
                        type="number"
                        value={capacity}
                        data-testid="input-capacity"
                        onChange={(e) => {
                          const c = parseInt(e.target.value) || 0;
                          setCapacity(c);
                          onUpdateComponent?.(selectedComponent.id, {
                            properties: { ...selectedComponent.properties, capacity: c }
                          });
                          triggerSaveFeedback();
                        }}
                        step="10"
                      />
                    </div>
                    <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
                      Total Energy: {voltage * capacity}Wh ({(voltage * capacity / 1000).toFixed(1)}kWh)
                    </div>
                  </div>
                )}

                {/* Inverter-specific properties */}
                {selectedComponent.type === 'inverter' && (() => {
                  const inverterDC = calculateInverterDCInput(selectedComponent.id, wires, components, voltage);
                  return (
                    <div className="space-y-4">
                      <h3 className="text-sm font-medium">Inverter Specifications</h3>
                      <div className="space-y-2">
                        <Label>AC Output Rating (W)</Label>
                        <Input
                          type="number"
                          value={inverterWatts}
                          data-testid="input-watts"
                          onChange={(e) => {
                            const w = parseInt(e.target.value) || 0;
                            setInverterWatts(w);
                            onUpdateComponent?.(selectedComponent.id, {
                              properties: { ...selectedComponent.properties, watts: w }
                            });
                            triggerSaveFeedback();
                          }}
                          step="100"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Input Voltage (V)</Label>
                      <Select
                        value={voltage.toString()}
                        onValueChange={(value) => {
                          const v = parseInt(value);
                          setVoltage(v);
                          onUpdateComponent?.(selectedComponent.id, {
                            properties: { ...selectedComponent.properties, voltage: v }
                          });
                          triggerSaveFeedback();
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select voltage" />
                        </SelectTrigger>
                        <SelectContent>
                          {getAvailableVoltages(selectedComponent.type).map((v) => (
                            <SelectItem key={v} value={v.toString()}>
                              {v}V DC
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
                      Max DC Current: {Math.ceil((inverterWatts || 3000) / voltage * 1.25)}A (with 25% safety margin)
                    </div>
                    <Separator />
                    <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
                      <div className="font-medium mb-1">DC Input (Calculated from AC Loads)</div>
                      <div>Total AC Loads: {inverterDC.acLoadWatts.toFixed(0)}W @ {inverterDC.acVoltage}V</div>
                      <div>DC Input Power: {inverterDC.dcInputWatts.toFixed(0)}W (87.5% efficiency)</div>
                      <div>DC Input Current: {inverterDC.dcInputCurrent.toFixed(1)}A @ {voltage}V</div>
                    </div>
                  </div>
                  );
                })()}

                {/* Fuse-specific properties */}
                {selectedComponent.type === 'fuse' && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium">Class T Fuse Specifications</h3>
                    <div className="space-y-2">
                      <Label>Fuse Rating (A)</Label>
                      <Select
                        value={fuseRating.toString()}
                        onValueChange={(value) => {
                          const r = parseInt(value);
                          setFuseRating(r);
                          onUpdateComponent?.(selectedComponent.id, {
                            properties: { ...selectedComponent.properties, fuseRating: r, amps: r }
                          });
                          triggerSaveFeedback();
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select fuse rating" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="100">100A</SelectItem>
                          <SelectItem value="150">150A</SelectItem>
                          <SelectItem value="200">200A</SelectItem>
                          <SelectItem value="250">250A</SelectItem>
                          <SelectItem value="300">300A</SelectItem>
                          <SelectItem value="400">400A</SelectItem>
                          <SelectItem value="500">500A</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
                      Class T fuses provide 20,000A interrupt capacity for lithium battery protection.
                    </div>
                  </div>
                )}

                {/* MPPT-specific properties */}
                {selectedComponent.type === 'mppt' && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium">MPPT Specifications</h3>
                    <div className="space-y-2">
                      <Label>Charge Current (A)</Label>
                      <Input
                        type="number"
                        value={current || 30}
                        data-testid="input-mppt-amps"
                        onChange={(e) => {
                          const amps = parseInt(e.target.value) || 0;
                          setCurrent(amps);
                          onUpdateComponent?.(selectedComponent.id, {
                            properties: { ...selectedComponent.properties, amps, current: amps }
                          });
                          triggerSaveFeedback();
                        }}
                        step="5"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>System Voltage (V)</Label>
                      <Select
                        value={voltage.toString()}
                        onValueChange={(value) => {
                          const v = parseInt(value);
                          setVoltage(v);
                          onUpdateComponent?.(selectedComponent.id, {
                            properties: { ...selectedComponent.properties, voltage: v }
                          });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select voltage" />
                        </SelectTrigger>
                        <SelectContent>
                          {getAvailableVoltages(selectedComponent.type).map((v) => (
                            <SelectItem key={v} value={v.toString()}>
                              {v}V
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
                      Max Charge Power: {(current || 30) * voltage}W
                    </div>
                  </div>
                )}

                {/* Blue Smart Charger-specific properties */}
                {selectedComponent.type === 'blue-smart-charger' && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium">Charger Specifications</h3>
                    <div className="space-y-2">
                      <Label>Charge Current (A)</Label>
                      <Select
                        value={(current || 15).toString()}
                        onValueChange={(value) => {
                          const amps = parseInt(value);
                          setCurrent(amps);
                          onUpdateComponent?.(selectedComponent.id, {
                            properties: { ...selectedComponent.properties, amps, current: amps }
                          });
                          triggerSaveFeedback();
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select charge current" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="5">5A</SelectItem>
                          <SelectItem value="7">7A</SelectItem>
                          <SelectItem value="10">10A</SelectItem>
                          <SelectItem value="15">15A</SelectItem>
                          <SelectItem value="20">20A</SelectItem>
                          <SelectItem value="25">25A</SelectItem>
                          <SelectItem value="30">30A</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Battery Voltage (V)</Label>
                      <Select
                        value={voltage.toString()}
                        onValueChange={(value) => {
                          const v = parseInt(value);
                          setVoltage(v);
                          onUpdateComponent?.(selectedComponent.id, {
                            properties: { ...selectedComponent.properties, voltage: v }
                          });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select voltage" />
                        </SelectTrigger>
                      <SelectContent>
                        {getAvailableVoltages(selectedComponent.type).map((v) => (
                          <SelectItem key={v} value={v.toString()}>
                            {v}V
                          </SelectItem>
                        ))}
                      </SelectContent>
                      </Select>
                    </div>
                    <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
                      Charge Power: {(current || 15) * voltage}W
                    </div>
                  </div>
                )}

                {/* Orion DC-DC Charger-specific properties */}
                {selectedComponent.type === 'orion-dc-dc' && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium">DC-DC Charger Specifications</h3>
                    <div className="space-y-2">
                      <Label>Charge Current (A)</Label>
                      <Select
                        value={(current || 30).toString()}
                        onValueChange={(value) => {
                          const amps = parseInt(value);
                          setCurrent(amps);
                          onUpdateComponent?.(selectedComponent.id, {
                            properties: { ...selectedComponent.properties, amps, current: amps }
                          });
                          triggerSaveFeedback();
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select charge current" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="12">12A</SelectItem>
                          <SelectItem value="18">18A</SelectItem>
                          <SelectItem value="30">30A</SelectItem>
                          <SelectItem value="50">50A</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
                      Typical Orion-Tr Smart models: 12A, 18A, 30A, 50A
                    </div>
                  </div>
                )}

                {/* Battery Protect-specific properties */}
                {selectedComponent.type === 'battery-protect' && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium">Battery Protect Specifications</h3>
                    <div className="space-y-2">
                      <Label>Current Rating (A)</Label>
                      <Select
                        value={(current || 100).toString()}
                        onValueChange={(value) => {
                          const amps = parseInt(value);
                          setCurrent(amps);
                          onUpdateComponent?.(selectedComponent.id, {
                            properties: { ...selectedComponent.properties, amps, current: amps }
                          });
                          triggerSaveFeedback();
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select current rating" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="65">65A</SelectItem>
                          <SelectItem value="100">100A</SelectItem>
                          <SelectItem value="220">220A</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
                      Protects loads from over-discharge and over-current
                    </div>
                  </div>
                )}

                {/* Phoenix Inverter-specific properties */}
                {selectedComponent.type === 'phoenix-inverter' && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium">Phoenix Inverter Specifications</h3>
                    <div className="space-y-2">
                      <Label>Power Rating (W)</Label>
                      <Select
                        value={(inverterWatts || 1200).toString()}
                        onValueChange={(value) => {
                          const w = parseInt(value);
                          setInverterWatts(w);
                          onUpdateComponent?.(selectedComponent.id, {
                            properties: { ...selectedComponent.properties, watts: w, powerRating: w }
                          });
                          triggerSaveFeedback();
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select power rating" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="375">375W</SelectItem>
                          <SelectItem value="500">500W</SelectItem>
                          <SelectItem value="800">800W</SelectItem>
                          <SelectItem value="1200">1200W</SelectItem>
                          <SelectItem value="1600">1600W</SelectItem>
                          <SelectItem value="2000">2000W</SelectItem>
                          <SelectItem value="3000">3000W</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Input Voltage (V)</Label>
                      <Select
                        value={voltage.toString()}
                        onValueChange={(value) => {
                          const v = parseInt(value);
                          setVoltage(v);
                          onUpdateComponent?.(selectedComponent.id, {
                            properties: { ...selectedComponent.properties, voltage: v }
                          });
                          triggerSaveFeedback();
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select voltage" />
                        </SelectTrigger>
                        <SelectContent>
                          {getAvailableVoltages(selectedComponent.type).map((v) => (
                            <SelectItem key={v} value={v.toString()}>
                              {v}V DC
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
                      Max DC Current: {Math.ceil((inverterWatts || 1200) / voltage * 1.25)}A (with 25% safety margin)
                    </div>
                  </div>
                )}

                {/* Bus bar properties - calculated from connected components */}
                {(selectedComponent.type === 'busbar-positive' || selectedComponent.type === 'busbar-negative') && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium">Bus Bar Specifications</h3>
                    <div className="text-xs text-muted-foreground bg-muted p-2 rounded mb-2">
                      Bus bar current and power are automatically calculated from connected components.
                    </div>
                    {(() => {
                      const totals = calculateBusBarTotals(selectedComponent.id, selectedComponent.type, wires, components);
                      return (
                        <>
                          <div className="space-y-2">
                            <Label>System Voltage (V)</Label>
                            <div className="text-sm font-mono bg-muted p-2 rounded">
                              {totals.voltage}V
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label>Total Current (A)</Label>
                            <div className="text-sm font-mono bg-muted p-2 rounded">
                              {totals.totalCurrent.toFixed(1)}A
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label>Total Power (W)</Label>
                            <div className="text-sm font-mono bg-muted p-2 rounded">
                              {totals.totalWatts.toFixed(0)}W
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Generic component properties (for other component types) */}
                {/* MultiPlus Inverter/Charger properties */}
                {selectedComponent.type === 'multiplus' && (() => {
                  const inverterDC = calculateInverterDCInput(selectedComponent.id, wires, components, voltage);
                  return (
                    <div className="space-y-4">
                      <h3 className="text-sm font-medium">MultiPlus Specifications</h3>
                      <div className="space-y-2">
                        <Label>AC Output Rating (W)</Label>
                        <Input
                          type="number"
                          value={inverterWatts}
                          onChange={(e) => {
                            const w = parseInt(e.target.value) || 0;
                            setInverterWatts(w);
                            onUpdateComponent?.(selectedComponent.id, {
                              properties: { ...selectedComponent.properties, watts: w, powerRating: w }
                            });
                            triggerSaveFeedback();
                          }}
                          step="100"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>DC Input Voltage (V)</Label>
                        <Select
                          value={voltage.toString()}
                          onValueChange={(value) => {
                            const v = parseInt(value);
                            handleVoltageChange(v);
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {getAvailableVoltages(selectedComponent.type).map(v => (
                              <SelectItem key={v} value={v.toString()}>{v}V</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
                        Max DC Current: {Math.ceil((inverterWatts || 3000) / voltage * 1.25)}A (with 25% safety margin)
                      </div>
                      <Separator />
                      <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
                        <div className="font-medium mb-1">DC Input (Calculated from AC Loads)</div>
                        <div>Total AC Loads: {inverterDC.acLoadWatts.toFixed(0)}W @ {inverterDC.acVoltage}V</div>
                        <div>DC Input Power: {inverterDC.dcInputWatts.toFixed(0)}W (87.5% efficiency)</div>
                        <div>DC Input Current: {inverterDC.dcInputCurrent.toFixed(1)}A @ {voltage}V</div>
                      </div>
                    </div>
                  );
                })()}

                {/* AC Distribution Panel - calculated from connected AC loads */}
                {selectedComponent.type === 'ac-panel' && (() => {
                  // Calculate total AC loads connected to this panel
                  const panelWires = wires.filter(
                    w => (w.fromComponentId === selectedComponent.id || w.toComponentId === selectedComponent.id) &&
                         w.polarity === "hot" // Only count from hot wires
                  );
                  
                  let totalACWatts = 0;
                  let acVoltage = 120;
                  const visitedLoads = new Set<string>();
                  
                  for (const wire of panelWires) {
                    const otherCompId = wire.fromComponentId === selectedComponent.id 
                      ? wire.toComponentId 
                      : wire.fromComponentId;
                    
                    if (!visitedLoads.has(otherCompId)) {
                      visitedLoads.add(otherCompId);
                      const otherComp = components.find(c => c.id === otherCompId);
                      if (otherComp && otherComp.type === "ac-load") {
                        const loadWatts = (otherComp.properties?.watts || otherComp.properties?.power || 0) as number;
                        totalACWatts += loadWatts;
                        const loadVoltage = otherComp.properties?.acVoltage || otherComp.properties?.voltage || 120;
                        if (loadVoltage !== 120) acVoltage = loadVoltage;
                      }
                    }
                  }
                  
                  const totalACCurrent = acVoltage > 0 ? totalACWatts / acVoltage : 0;
                  
                  return (
                    <div className="space-y-4">
                      <h3 className="text-sm font-medium">AC Distribution Panel Specifications</h3>
                      <div className="text-xs text-muted-foreground bg-muted p-2 rounded mb-2">
                        AC panel current and power are automatically calculated from connected AC loads.
                      </div>
                      <div className="space-y-2">
                        <Label>AC Voltage (V)</Label>
                        <div className="text-sm font-mono bg-muted p-2 rounded">
                          {acVoltage}V AC
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Total Current (A)</Label>
                        <div className="text-sm font-mono bg-muted p-2 rounded">
                          {totalACCurrent.toFixed(1)}A
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Total Power (W)</Label>
                        <div className="text-sm font-mono bg-muted p-2 rounded">
                          {totalACWatts.toFixed(0)}W
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {!['battery', 'inverter', 'fuse', 'mppt', 'blue-smart-charger', 'orion-dc-dc', 'battery-protect', 'phoenix-inverter', 'multiplus', 'busbar-positive', 'busbar-negative', 'ac-panel'].includes(selectedComponent.type) && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium">Specifications</h3>
                    <div className="space-y-2">
                      <Label>Voltage (V)</Label>
                      <Select
                        value={voltage.toString()}
                        onValueChange={(value) => {
                          const v = parseInt(value);
                          handleVoltageChange(v);
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select voltage" />
                        </SelectTrigger>
                        <SelectContent>
                          {getAvailableVoltages(selectedComponent.type).map((v) => (
                            <SelectItem key={v} value={v.toString()}>
                              {v}V {selectedComponent.type === 'ac-load' ? 'AC' : 'DC'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Current (A)</Label>
                      <Input
                        type="number"
                        value={current}
                        data-testid="input-current"
                        onChange={(e) => handleCurrentChange(parseFloat(e.target.value))}
                        step="0.1"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Power (W)</Label>
                      <Input
                        type="number"
                        value={watts}
                        data-testid="input-power"
                        onChange={(e) => handleWattsChange(parseFloat(e.target.value))}
                        step="1"
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-8">
                <Settings className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Select a component to view properties</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="calculations" className="p-4 space-y-4 mt-0 pr-2">
            {(() => {
              // When component is selected, show all connected wires
              if (selectedComponent && !selectedWire) {
                const connectedWires = wires.filter(
                  w => w.fromComponentId === selectedComponent.id || w.toComponentId === selectedComponent.id
                );

                if (connectedWires.length === 0) {
                  return (
                    <div className="text-center text-muted-foreground py-8">
                      <Calculator className="h-12 w-12 mx-auto mb-3 opacity-20" />
                      <p className="text-sm">No wires connected to this component</p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-medium mb-2">Connected Wires ({connectedWires.length})</h3>
                      <div className="text-xs text-muted-foreground bg-muted p-2 rounded mb-3">
                        Click a wire to view detailed calculations
                      </div>
                    </div>
                    <div className="space-y-3">
                      {connectedWires.map((wire) => {
                        const calc = wireCalculations[wire.id];
                        const otherComponentId = wire.fromComponentId === selectedComponent.id 
                          ? wire.toComponentId 
                          : wire.fromComponentId;
                        const otherComponent = components.find(c => c.id === otherComponentId);
                        const otherComponentName = otherComponent?.name || otherComponentId;

                        return (
                          <div
                            key={wire.id}
                            className="border rounded-lg p-3 space-y-2 cursor-pointer hover:bg-muted/50 transition-colors"
                            onClick={() => {
                              onWireSelect?.(wire);
                            }}
                          >
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <div className="text-sm font-medium">
                                  {selectedComponent.name} → {otherComponentName}
                                </div>
                                <div className="text-xs text-muted-foreground mt-1">
                                  {wire.polarity} • {wire.length.toFixed(1)}ft
                                </div>
                              </div>
                              {wire.gauge && (
                                <Badge 
                                  variant={calc && calc.status === "error" ? "destructive" : calc && calc.status === "warning" ? "secondary" : "default"}
                                  className="ml-2"
                                >
                                  {wire.gauge}
                                </Badge>
                              )}
                            </div>
                            {calc ? (
                              <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                                <div>
                                  <span className="text-muted-foreground">Current:</span>{" "}
                                  <span className="font-mono">
                                    {calc.current != null ? calc.current.toFixed(1) : '—'}A
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Voltage Drop:</span>{" "}
                                  <span className={`font-mono ${
                                    (() => {
                                      // Calculate voltage drop for actual wire gauge
                                      if (wire.gauge && calc.current != null && calc.length != null && calc.voltage != null) {
                                        const WIRE_DATA: Record<string, { resistance: number }> = {
                                          "18 AWG": { resistance: 6.385 },
                                          "16 AWG": { resistance: 4.016 },
                                          "14 AWG": { resistance: 2.525 },
                                          "12 AWG": { resistance: 1.588 },
                                          "10 AWG": { resistance: 0.9989 },
                                          "8 AWG": { resistance: 0.6282 },
                                          "6 AWG": { resistance: 0.3951 },
                                          "4 AWG": { resistance: 0.2485 },
                                          "2 AWG": { resistance: 0.1563 },
                                          "1 AWG": { resistance: 0.1240 },
                                          "1/0 AWG": { resistance: 0.0983 },
                                          "2/0 AWG": { resistance: 0.0779 },
                                          "3/0 AWG": { resistance: 0.0618 },
                                          "4/0 AWG": { resistance: 0.0490 },
                                        };
                                        const wireData = WIRE_DATA[wire.gauge];
                                        if (wireData) {
                                          const resistancePerFoot = wireData.resistance / 1000;
                                          const voltageDrop = 2 * calc.current * resistancePerFoot * calc.length;
                                          const voltageDropPercent = (voltageDrop / calc.voltage) * 100;
                                          return voltageDropPercent;
                                        }
                                      }
                                      return calc.voltageDropPercent ?? calc.voltageDrop ?? 0;
                                    })() > 3 
                                      ? "text-destructive" 
                                      : (() => {
                                        if (wire.gauge && calc.current != null && calc.length != null && calc.voltage != null) {
                                          const WIRE_DATA: Record<string, { resistance: number }> = {
                                            "18 AWG": { resistance: 6.385 },
                                            "16 AWG": { resistance: 4.016 },
                                            "14 AWG": { resistance: 2.525 },
                                            "12 AWG": { resistance: 1.588 },
                                            "10 AWG": { resistance: 0.9989 },
                                            "8 AWG": { resistance: 0.6282 },
                                            "6 AWG": { resistance: 0.3951 },
                                            "4 AWG": { resistance: 0.2485 },
                                            "2 AWG": { resistance: 0.1563 },
                                            "1 AWG": { resistance: 0.1240 },
                                            "1/0 AWG": { resistance: 0.0983 },
                                            "2/0 AWG": { resistance: 0.0779 },
                                            "3/0 AWG": { resistance: 0.0618 },
                                            "4/0 AWG": { resistance: 0.0490 },
                                          };
                                          const wireData = WIRE_DATA[wire.gauge];
                                          if (wireData) {
                                            const resistancePerFoot = wireData.resistance / 1000;
                                            const voltageDrop = 2 * calc.current * resistancePerFoot * calc.length;
                                            const voltageDropPercent = (voltageDrop / calc.voltage) * 100;
                                            return voltageDropPercent;
                                          }
                                        }
                                        return calc.voltageDropPercent ?? calc.voltageDrop ?? 0;
                                      })() > 2.5 
                                        ? "text-amber-600 dark:text-amber-400" 
                                        : "text-chart-2"
                                  }`}>
                                    {(() => {
                                      // Calculate voltage drop for actual wire gauge
                                      if (wire.gauge && calc.current != null && calc.length != null && calc.voltage != null) {
                                        const WIRE_DATA: Record<string, { resistance: number }> = {
                                          "18 AWG": { resistance: 6.385 },
                                          "16 AWG": { resistance: 4.016 },
                                          "14 AWG": { resistance: 2.525 },
                                          "12 AWG": { resistance: 1.588 },
                                          "10 AWG": { resistance: 0.9989 },
                                          "8 AWG": { resistance: 0.6282 },
                                          "6 AWG": { resistance: 0.3951 },
                                          "4 AWG": { resistance: 0.2485 },
                                          "2 AWG": { resistance: 0.1563 },
                                          "1 AWG": { resistance: 0.1240 },
                                          "1/0 AWG": { resistance: 0.0983 },
                                          "2/0 AWG": { resistance: 0.0779 },
                                          "3/0 AWG": { resistance: 0.0618 },
                                          "4/0 AWG": { resistance: 0.0490 },
                                        };
                                        const wireData = WIRE_DATA[wire.gauge];
                                        if (wireData) {
                                          const resistancePerFoot = wireData.resistance / 1000;
                                          const voltageDrop = 2 * calc.current * resistancePerFoot * calc.length;
                                          const voltageDropPercent = (voltageDrop / calc.voltage) * 100;
                                          return voltageDropPercent.toFixed(2);
                                        }
                                      }
                                      return ((calc.voltageDropPercent ?? calc.voltageDrop) != null) 
                                        ? (calc.voltageDropPercent ?? calc.voltageDrop ?? 0).toFixed(2) 
                                        : '—';
                                    })()}%
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground mt-2">
                                Calculating...
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              // When wire is selected, show detailed calculation
              if (selectedWire) {
                const calc = wireCalculation || wireCalculations[selectedWire.id];
                
                if (!calc) {
                  return (
                    <div className="text-center text-muted-foreground py-8">
                      <Calculator className="h-12 w-12 mx-auto mb-3 opacity-20" />
                      <p className="text-sm">Calculating wire sizing...</p>
                    </div>
                  );
                }

                // Check if this wire is connected to an inverter DC terminal
                const fromComp = components.find(c => c.id === selectedWire.fromComponentId);
                const toComp = components.find(c => c.id === selectedWire.toComponentId);
                const isInverterDCWire = 
                  ((fromComp?.type === "multiplus" || fromComp?.type === "phoenix-inverter" || fromComp?.type === "inverter") &&
                   (selectedWire.fromTerminal === "dc-positive" || selectedWire.fromTerminal === "dc-negative")) ||
                  ((toComp?.type === "multiplus" || toComp?.type === "phoenix-inverter" || toComp?.type === "inverter") &&
                   (selectedWire.toTerminal === "dc-positive" || selectedWire.toTerminal === "dc-negative"));
                
                const inverterId = isInverterDCWire 
                  ? (fromComp?.type === "multiplus" || fromComp?.type === "phoenix-inverter" || fromComp?.type === "inverter" ? fromComp.id : toComp?.id)
                  : null;
                
                const inverterDC = inverterId 
                  ? calculateInverterDCInput(inverterId, wires, components, calc.voltage || 12)
                  : null;

                return (
                  <div className="space-y-3">
                    {selectedComponent && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mb-2 -ml-2"
                        onClick={() => {
                          // Clear wire selection and restore component selection
                          if (onWireSelect) {
                            onWireSelect(null);
                          }
                          if (onComponentSelect && selectedComponent) {
                            onComponentSelect(selectedComponent);
                          }
                        }}
                      >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        Back to wires
                      </Button>
                    )}
                    
                    {inverterDC && inverterDC.dcInputWatts > 0 && (
                      <div className="border rounded-lg p-4 space-y-2 bg-muted/30">
                        <div className="flex items-center gap-2">
                          <Info className="h-4 w-4 text-primary" />
                          <h3 className="text-sm font-medium">Inverter DC Input Requirement</h3>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-muted-foreground">AC Loads:</span>{" "}
                            <span className="font-mono">{inverterDC.acLoadWatts.toFixed(0)}W @ {inverterDC.acVoltage}V</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">DC Input Power:</span>{" "}
                            <span className="font-mono font-semibold">{inverterDC.dcInputWatts.toFixed(0)}W</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">DC Input Current:</span>{" "}
                            <span className="font-mono font-semibold">{inverterDC.dcInputCurrent.toFixed(1)}A</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Efficiency:</span>{" "}
                            <span className="font-mono">87.5%</span>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground mt-2 pt-2 border-t">
                          This wire must carry {inverterDC.dcInputWatts.toFixed(0)}W ({inverterDC.dcInputCurrent.toFixed(1)}A) to power the inverter's AC loads.
                        </div>
                      </div>
                    )}
                    
                    <h3 className="text-sm font-medium">Wire Sizing Calculation</h3>

                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Current</span>
                        <span className="font-mono font-medium">
                          {calc.current != null ? calc.current.toFixed(1) : '—'}A
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Length</span>
                        <span className="font-mono font-medium">
                          {calc.length != null ? calc.length.toFixed(1) : '—'}ft
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Voltage</span>
                        <span className="font-mono font-medium">
                          {calc.voltage != null ? calc.voltage : '—'}V
                        </span>
                      </div>
                      {selectedWire?.gauge && (
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Current Gauge</span>
                          <span className="font-mono font-medium">{selectedWire.gauge}</span>
                        </div>
                      )}
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      {calc.recommendedGauge && (
                        <>
                          <div className="flex justify-between items-center">
                            <span className="text-sm font-medium">Recommended Gauge</span>
                            <Badge variant={calc.status === "valid" ? "default" : "destructive"}>
                              {calc.recommendedGauge}
                            </Badge>
                          </div>
                          {selectedWire?.gauge && selectedWire.gauge !== calc.recommendedGauge && (
                            <>
                              <div className="flex justify-between items-center">
                                <span className="text-sm text-muted-foreground">Current Gauge</span>
                                <Badge variant={calc.status === "error" ? "destructive" : "secondary"}>
                                  {selectedWire.gauge}
                                </Badge>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full mt-2"
                                onClick={() => {
                                  if (selectedWire && onUpdateWire && calc.recommendedGauge) {
                                    onUpdateWire(selectedWire.id, { gauge: calc.recommendedGauge });
                                    triggerSaveFeedback();
                                  }
                                }}
                              >
                                Update to {calc.recommendedGauge}
                              </Button>
                            </>
                          )}
                        </>
                      )}
                      {/* Show voltage drop for actual wire gauge if different from recommended */}
                      {selectedWire?.gauge && selectedWire.gauge !== calc.recommendedGauge && (() => {
                        // Calculate voltage drop for actual wire gauge
                        const WIRE_DATA: Record<string, { resistance: number }> = {
                          "18 AWG": { resistance: 6.385 },
                          "16 AWG": { resistance: 4.016 },
                          "14 AWG": { resistance: 2.525 },
                          "12 AWG": { resistance: 1.588 },
                          "10 AWG": { resistance: 0.9989 },
                          "8 AWG": { resistance: 0.6282 },
                          "6 AWG": { resistance: 0.3951 },
                          "4 AWG": { resistance: 0.2485 },
                          "2 AWG": { resistance: 0.1563 },
                          "1 AWG": { resistance: 0.1240 },
                          "1/0 AWG": { resistance: 0.0983 },
                          "2/0 AWG": { resistance: 0.0779 },
                          "3/0 AWG": { resistance: 0.0618 },
                          "4/0 AWG": { resistance: 0.0490 },
                        };
                        
                        const actualGauge = selectedWire.gauge.replace(/ AWG$/i, '').replace(/\\0/g, '/0');
                        const wireData = WIRE_DATA[selectedWire.gauge];
                        if (wireData && calc.current != null && calc.length != null && calc.voltage != null) {
                          const resistancePerFoot = wireData.resistance / 1000;
                          const voltageDrop = 2 * calc.current * resistancePerFoot * calc.length;
                          const voltageDropPercent = (voltageDrop / calc.voltage) * 100;
                          
                          return (
                            <div className="space-y-2">
                              <div className="flex justify-between items-center">
                                <span className="text-sm font-medium">Voltage Drop ({selectedWire.gauge})</span>
                                <span className={`font-mono font-medium ${
                                  voltageDropPercent > 3 
                                    ? "text-destructive" 
                                    : voltageDropPercent > 2.5 
                                      ? "text-amber-600 dark:text-amber-400" 
                                      : "text-chart-2"
                                }`}>
                                  {voltageDropPercent.toFixed(2)}%
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-sm text-muted-foreground">Voltage Drop ({calc.recommendedGauge})</span>
                                <span className={`font-mono text-sm ${
                                  (calc.voltageDropPercent ?? calc.voltageDrop ?? 0) > 3 
                                    ? "text-destructive" 
                                    : (calc.voltageDropPercent ?? calc.voltageDrop ?? 0) > 2.5 
                                      ? "text-amber-600 dark:text-amber-400" 
                                      : "text-chart-2"
                                }`}>
                                  {((calc.voltageDropPercent ?? calc.voltageDrop) != null) 
                                    ? (calc.voltageDropPercent ?? calc.voltageDrop ?? 0).toFixed(2) 
                                    : '—'}%
                                </span>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      })()}
                      {/* Show recommended gauge voltage drop if actual gauge matches recommended */}
                      {(!selectedWire?.gauge || selectedWire.gauge === calc.recommendedGauge) && (calc.voltageDrop != null || calc.voltageDropPercent != null) && (
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-medium">Voltage Drop</span>
                          <span className={`font-mono font-medium ${
                            (calc.voltageDropPercent ?? calc.voltageDrop ?? 0) > 3 
                              ? "text-destructive" 
                              : (calc.voltageDropPercent ?? calc.voltageDrop ?? 0) > 2.5 
                                ? "text-amber-600 dark:text-amber-400" 
                                : "text-chart-2"
                          }`}>
                            {((calc.voltageDropPercent ?? calc.voltageDrop) != null) 
                              ? (calc.voltageDropPercent ?? calc.voltageDrop ?? 0).toFixed(2) 
                              : '—'}%
                          </span>
                        </div>
                      )}
                    </div>

                    {calc.status === "warning" && (
                      <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 p-3 rounded-md">
                        {(() => {
                          // Check actual voltage drop to determine warning message
                          const actualVoltageDrop = (() => {
                            if (selectedWire?.gauge && calc.current != null && calc.length != null && calc.voltage != null) {
                              const WIRE_DATA: Record<string, { resistance: number }> = {
                                "18 AWG": { resistance: 6.385 },
                                "16 AWG": { resistance: 4.016 },
                                "14 AWG": { resistance: 2.525 },
                                "12 AWG": { resistance: 1.588 },
                                "10 AWG": { resistance: 0.9989 },
                                "8 AWG": { resistance: 0.6282 },
                                "6 AWG": { resistance: 0.3951 },
                                "4 AWG": { resistance: 0.2485 },
                                "2 AWG": { resistance: 0.1563 },
                                "1 AWG": { resistance: 0.1240 },
                                "1/0 AWG": { resistance: 0.0983 },
                                "2/0 AWG": { resistance: 0.0779 },
                                "3/0 AWG": { resistance: 0.0618 },
                                "4/0 AWG": { resistance: 0.0490 },
                              };
                              const wireData = WIRE_DATA[selectedWire.gauge];
                              if (wireData) {
                                const resistancePerFoot = wireData.resistance / 1000;
                                const voltageDrop = 2 * calc.current * resistancePerFoot * calc.length;
                                return (voltageDrop / calc.voltage) * 100;
                              }
                            }
                            return calc.voltageDropPercent ?? calc.voltageDrop ?? 0;
                          })();
                          
                          if (actualVoltageDrop > 3) {
                            return `Warning: Voltage drop (${actualVoltageDrop.toFixed(2)}%) exceeds 3% recommendation`;
                          } else {
                            return `Warning: Voltage drop (${actualVoltageDrop.toFixed(2)}%) is approaching 3% limit. Consider larger gauge for better safety margin.`;
                          }
                        })()}
                      </div>
                    )}
                    {calc.status === "error" && (
                      <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 p-3 rounded-md">
                        {calc.message || "Error: Wire gauge insufficient or voltage drop too high"}
                      </div>
                    )}
                  </div>
                );
              }

              // No selection
              return (
                <div className="text-center text-muted-foreground py-8">
                  <Calculator className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">Select a component or wire to view calculations</p>
                </div>
              );
            })()}
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
