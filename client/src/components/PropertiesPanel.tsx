import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  wireCalculation?: WireCalculation;
}

export function PropertiesPanel({ selectedComponent, wireCalculation }: PropertiesPanelProps) {
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
            {selectedComponent ? (
              <div key={selectedComponent.id}>
                <div className="space-y-2">
                  <Label>Component Name</Label>
                  <Input
                    defaultValue={selectedComponent.name}
                    data-testid="input-component-name"
                  />
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="text-sm font-medium">Specifications</h3>
                  <div className="space-y-2">
                    <Label>Voltage (V)</Label>
                    <Input
                      type="number"
                      defaultValue={selectedComponent.voltage || 12}
                      data-testid="input-voltage"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Current (A)</Label>
                    <Input
                      type="number"
                      defaultValue={selectedComponent.current || 0}
                      data-testid="input-current"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Power (W)</Label>
                    <Input
                      type="number"
                      defaultValue={selectedComponent.power || 0}
                      data-testid="input-power"
                      disabled
                      className="bg-muted"
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
    </div>
  );
}
