import { useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Calculator, Settings, ShoppingCart, Tag } from "lucide-react";

interface WireCalculation {
  current: number;
  length: number;
  voltage: number;
  recommendedGauge: string;
  voltageDrop: number;
  status: "valid" | "warning" | "error";
}

interface PropertiesPanelProps {
  selectedComponent?: {
    id: string;
    name: string;
    voltage?: number;
    current?: number;
    power?: number;
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
  wireCalculation?: WireCalculation;
  onEditWire?: (wire: any) => void;
  onUpdateComponent?: (id: string, updates: any) => void;
}

export function PropertiesPanel({ selectedComponent, selectedWire, wireCalculation, onEditWire, onUpdateComponent }: PropertiesPanelProps) {
  // State for controlled inputs with auto-calculation
  const [voltage, setVoltage] = useState<number>(12);
  const [current, setCurrent] = useState<number>(0);
  const [power, setPower] = useState<number>(0);

  // Sync state when selectedComponent changes
  useEffect(() => {
    if (selectedComponent) {
      setVoltage(selectedComponent.voltage || 12);
      setCurrent(selectedComponent.current || 0);
      setPower(selectedComponent.power || 0);
    }
  }, [selectedComponent?.id, selectedComponent?.voltage, selectedComponent?.current, selectedComponent?.power]);

  // Handle voltage change - recalculate current if power is set
  const handleVoltageChange = (newVoltage: number) => {
    if (isNaN(newVoltage) || newVoltage <= 0) return;

    setVoltage(newVoltage);

    // Recalculate current based on power if power is non-zero
    if (power > 0) {
      const newCurrent = power / newVoltage;
      setCurrent(newCurrent);
      onUpdateComponent?.(selectedComponent!.id, {
        properties: { voltage: newVoltage, current: newCurrent, power }
      });
    } else {
      onUpdateComponent?.(selectedComponent!.id, {
        properties: { voltage: newVoltage, current, power }
      });
    }
  };

  // Handle current (amps) change - auto-calculate power
  const handleCurrentChange = (newCurrent: number) => {
    if (isNaN(newCurrent)) return;

    setCurrent(newCurrent);

    // Auto-calculate power: P = V × I
    const newPower = voltage * newCurrent;
    setPower(newPower);

    onUpdateComponent?.(selectedComponent!.id, {
      properties: { voltage, current: newCurrent, power: newPower }
    });
  };

  // Handle power (watts) change - auto-calculate current
  const handlePowerChange = (newPower: number) => {
    if (isNaN(newPower)) return;

    setPower(newPower);

    // Auto-calculate current: I = P / V
    if (voltage > 0) {
      const newCurrent = newPower / voltage;
      setCurrent(newCurrent);

      onUpdateComponent?.(selectedComponent!.id, {
        properties: { voltage, current: newCurrent, power: newPower }
      });
    } else {
      onUpdateComponent?.(selectedComponent!.id, {
        properties: { voltage, current, power: newPower }
      });
    }
  };

  return (
    <div className="w-80 border-l bg-card flex flex-col h-full">
      <div className="p-4 border-b">
        <h2 className="font-semibold text-lg">Properties</h2>
      </div>

      <Tabs defaultValue="properties" className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-4">
          <TabsTrigger value="properties" className="flex-1 gap-2" data-testid="tab-properties">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="calculations" className="flex-1 gap-2" data-testid="tab-calculations">
            <Calculator className="h-4 w-4" />
            Calc
          </TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1">
          <TabsContent value="properties" className="p-4 space-y-4 mt-0">
            {selectedWire ? (
              <div key={selectedWire.id}>
                <div className="space-y-2">
                  <Label>Wire Connection</Label>
                  <div className="text-sm text-muted-foreground p-2 bg-muted rounded-md">
                    {selectedWire.fromComponentId} → {selectedWire.toComponentId}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2"
                    onClick={() => onEditWire?.(selectedWire)}
                  >
                    Edit Wire Properties
                  </Button>
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="text-sm font-medium">Wire Details</h3>
                  <div className="space-y-2">
                    <Label>Polarity</Label>
                    <Badge variant={selectedWire.polarity === "positive" ? "default" : "secondary"}>
                      {selectedWire.polarity.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    <Label>Wire Gauge</Label>
                    <Input
                      defaultValue={selectedWire.gauge || "N/A"}
                      data-testid="input-wire-gauge"
                      readOnly
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Length (ft)</Label>
                    <Input
                      type="number"
                      defaultValue={selectedWire.length}
                      data-testid="input-wire-length"
                      readOnly
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>From Terminal</Label>
                    <Input
                      defaultValue={selectedWire.fromTerminal}
                      data-testid="input-from-terminal"
                      readOnly
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>To Terminal</Label>
                    <Input
                      defaultValue={selectedWire.toTerminal}
                      data-testid="input-to-terminal"
                      readOnly
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
                    onChange={(e) => onUpdateComponent?.(selectedComponent.id, { name: e.target.value })}
                  />
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="text-sm font-medium">Specifications</h3>
                  <div className="space-y-2">
                    <Label>Voltage (V)</Label>
                    <Input
                      type="number"
                      value={voltage}
                      data-testid="input-voltage"
                      onChange={(e) => handleVoltageChange(parseFloat(e.target.value))}
                    />
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
                      value={power}
                      data-testid="input-power"
                      onChange={(e) => handlePowerChange(parseFloat(e.target.value))}
                      step="1"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-8">
                <Settings className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Select a component to view properties</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="calculations" className="p-4 space-y-4 mt-0">
            {wireCalculation ? (
              <>
                <div className="space-y-3">
                  <h3 className="text-sm font-medium">Wire Sizing</h3>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Current</span>
                      <span className="font-mono font-medium">{wireCalculation.current}A</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Length</span>
                      <span className="font-mono font-medium">{wireCalculation.length}ft</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Voltage</span>
                      <span className="font-mono font-medium">{wireCalculation.voltage}V</span>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Recommended Gauge</span>
                      <Badge variant={wireCalculation.status === "valid" ? "default" : "destructive"}>
                        {wireCalculation.recommendedGauge} AWG
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Voltage Drop</span>
                      <span className={`font-mono font-medium ${wireCalculation.voltageDrop > 3 ? "text-destructive" : "text-chart-2"}`}>
                        {wireCalculation.voltageDrop.toFixed(2)}%
                      </span>
                    </div>
                  </div>

                  {wireCalculation.status === "warning" && (
                    <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 p-3 rounded-md">
                      Warning: Voltage drop exceeds 3% recommendation
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center text-muted-foreground py-8">
                <Calculator className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Connect components to calculate wire sizing</p>
              </div>
            )}
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div >
  );
}
