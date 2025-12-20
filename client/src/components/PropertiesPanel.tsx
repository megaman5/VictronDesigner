import { useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  wireCalculation?: WireCalculation;
  onEditWire?: (wire: any) => void;
  onUpdateComponent?: (id: string, updates: any) => void;
}

// Helper function to get available voltages for a component type
function getAvailableVoltages(componentType: string): number[] {
  switch (componentType) {
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
    default:
      // Generic components - common voltages
      return [12, 24, 48];
  }
}

export function PropertiesPanel({ selectedComponent, selectedWire, wireCalculation, onEditWire, onUpdateComponent }: PropertiesPanelProps) {
  // State for controlled inputs with auto-calculation
  const [voltage, setVoltage] = useState<number>(12);
  const [current, setCurrent] = useState<number>(0);
  const [power, setPower] = useState<number>(0);
  
  // Battery-specific state
  const [batteryType, setBatteryType] = useState<string>('LiFePO4');
  const [capacity, setCapacity] = useState<number>(200);
  
  // Fuse-specific state
  const [fuseRating, setFuseRating] = useState<number>(400);
  
  // Inverter-specific state
  const [watts, setWatts] = useState<number>(3000);

  // Sync state when selectedComponent changes
  useEffect(() => {
    if (selectedComponent) {
      const props = selectedComponent.properties || {};
      setVoltage(props.voltage || 12);
      
      // For components that use amps, prioritize amps over current
      if (['mppt', 'blue-smart-charger', 'orion-dc-dc', 'battery-protect'].includes(selectedComponent.type)) {
        setCurrent(props.amps || props.current || 0);
      } else {
        setCurrent(props.current || props.amps || 0);
      }
      
      setPower(props.power || props.watts || 0);
      setBatteryType(props.batteryType || 'LiFePO4');
      setCapacity(props.capacity || 200);
      setFuseRating(props.fuseRating || props.amps || 400);
      setWatts(props.watts || props.powerRating || 3000);
    }
  }, [selectedComponent?.id, selectedComponent?.properties, selectedComponent?.type]);

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
                {selectedComponent.type === 'inverter' && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium">Inverter Specifications</h3>
                    <div className="space-y-2">
                      <Label>Power Rating (W)</Label>
                      <Input
                        type="number"
                        value={watts}
                        data-testid="input-watts"
                        onChange={(e) => {
                          const w = parseInt(e.target.value) || 0;
                          setWatts(w);
                          onUpdateComponent?.(selectedComponent.id, {
                            properties: { ...selectedComponent.properties, watts: w }
                          });
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
                      Max DC Current: {Math.ceil(watts / voltage * 1.25)}A (with 25% safety margin)
                    </div>
                  </div>
                )}

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
                        value={(watts || 1200).toString()}
                        onValueChange={(value) => {
                          const w = parseInt(value);
                          setWatts(w);
                          onUpdateComponent?.(selectedComponent.id, {
                            properties: { ...selectedComponent.properties, watts: w, powerRating: w }
                          });
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
                      Max DC Current: {Math.ceil((watts || 1200) / voltage * 1.25)}A (with 25% safety margin)
                    </div>
                  </div>
                )}

                {/* Generic component properties (for other component types) */}
                {!['battery', 'inverter', 'fuse', 'mppt', 'blue-smart-charger', 'orion-dc-dc', 'battery-protect', 'phoenix-inverter'].includes(selectedComponent.type) && (
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
                              {v}V
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
                        value={power}
                        data-testid="input-power"
                        onChange={(e) => handlePowerChange(parseFloat(e.target.value))}
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
