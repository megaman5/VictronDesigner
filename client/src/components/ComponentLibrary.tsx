import { Battery, Cable, Gauge, Cpu, Sun, Plus, Pencil, Trash2, Puzzle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { CustomComponentDefinition } from "@/lib/custom-components";

interface Component {
  id: string;
  name: string;
  icon: React.ReactNode;
  category: string;
}

const victronComponents: Component[] = [
  { id: "multiplus", name: "MultiPlus Inverter", icon: <Cable className="h-5 w-5" />, category: "victron" },
  { id: "quattro", name: "Quattro Inverter/Charger", icon: <Cable className="h-5 w-5" />, category: "victron" },
  { id: "argofet", name: "Argo FET Isolator", icon: <Gauge className="h-5 w-5" />, category: "victron" },
  { id: "cyrix-ct", name: "Cyrix-CT Combiner", icon: <Gauge className="h-5 w-5" />, category: "victron" },
  { id: "phoenix-inverter", name: "Phoenix Inverter", icon: <Cable className="h-5 w-5" />, category: "victron" },
  { id: "mppt", name: "MPPT Controller", icon: <Sun className="h-5 w-5" />, category: "victron" },
  { id: "orion-dc-dc", name: "Orion DC-DC Charger", icon: <Battery className="h-5 w-5" />, category: "victron" },
  { id: "battery-balancer", name: "Battery Balancer", icon: <Gauge className="h-5 w-5" />, category: "victron" },
  { id: "blue-smart-charger", name: "Blue Smart Charger", icon: <Battery className="h-5 w-5" />, category: "victron" },
  { id: "cerbo", name: "Cerbo GX", icon: <Cpu className="h-5 w-5" />, category: "victron" },
  { id: "smartshunt", name: "SmartShunt", icon: <Gauge className="h-5 w-5" />, category: "victron" },
  { id: "battery-protect", name: "Battery Protect", icon: <Gauge className="h-5 w-5" />, category: "victron" },
  { id: "lynx-power-in", name: "Lynx Power In", icon: <Cable className="h-5 w-5" />, category: "victron" },
  { id: "lynx-distributor", name: "Lynx Distributor", icon: <Cable className="h-5 w-5" />, category: "victron" },
  { id: "lynx-shunt", name: "Lynx Shunt VE.Can", icon: <Gauge className="h-5 w-5" />, category: "victron" },
  { id: "lynx-smart-bms", name: "Lynx Smart BMS", icon: <Cpu className="h-5 w-5" />, category: "victron" },
];

const genericComponents: Component[] = [
  { id: "battery", name: "Battery Bank", icon: <Battery className="h-5 w-5" />, category: "generic" },
  { id: "inverter", name: "Inverter", icon: <Cable className="h-5 w-5" />, category: "generic" },
  { id: "solar-panel", name: "Solar Panel", icon: <Sun className="h-5 w-5" />, category: "generic" },
  { id: "alternator", name: "Alternator", icon: <Gauge className="h-5 w-5" />, category: "generic" },
  { id: "ac-load", name: "AC Load", icon: <Gauge className="h-5 w-5" />, category: "generic" },
  { id: "dc-load", name: "DC Load", icon: <Cable className="h-5 w-5" />, category: "generic" },
  { id: "busbar-positive", name: "Positive Bus Bar", icon: <Cable className="h-5 w-5" />, category: "generic" },
  { id: "busbar-negative", name: "Negative Bus Bar", icon: <Cable className="h-5 w-5" />, category: "generic" },
];

const safetyComponents: Component[] = [
  { id: "fuse", name: "Fuse (Class T, MEGA, blade...)", icon: <Cable className="h-5 w-5" />, category: "safety" },
  { id: "dc-breaker", name: "DC Circuit Breaker", icon: <Cable className="h-5 w-5" />, category: "safety" },
  { id: "ac-breaker", name: "AC Circuit Breaker", icon: <Cable className="h-5 w-5" />, category: "safety" },
  { id: "switch", name: "Battery Switch", icon: <Cable className="h-5 w-5" />, category: "safety" },
  { id: "ac-panel", name: "AC Panel", icon: <Gauge className="h-5 w-5" />, category: "safety" },
  { id: "dc-panel", name: "DC Panel", icon: <Gauge className="h-5 w-5" />, category: "safety" },
  { id: "shore-power", name: "Shore Power", icon: <Cable className="h-5 w-5" />, category: "safety" },
  { id: "transfer-switch", name: "Transfer Switch", icon: <Cable className="h-5 w-5" />, category: "safety" },
];

interface ComponentLibraryProps {
  onDragStart?: (component: Component) => void;
  onAddCustom?: () => void;
  isAuthenticated?: boolean;
  onDragStartCustomDefinition?: (definition: CustomComponentDefinition) => void;
  onCreateCustomDefinition?: () => void;
  onEditCustomDefinition?: (definition: CustomComponentDefinition) => void;
  onDeleteCustomDefinition?: (definition: CustomComponentDefinition) => void;
}

export function ComponentLibrary({
  onDragStart,
  onAddCustom,
  isAuthenticated,
  onDragStartCustomDefinition,
  onCreateCustomDefinition,
  onEditCustomDefinition,
  onDeleteCustomDefinition,
}: ComponentLibraryProps) {
  const handleDragStart = (component: Component) => {
    console.log("Drag started:", component.name);
    onDragStart?.(component);
  };

  const { data: myComponents = [], isLoading: myComponentsLoading } = useQuery<CustomComponentDefinition[]>({
    queryKey: ["/api/custom-components"],
    enabled: !!isAuthenticated,
  });

  return (
    <div className="w-80 shrink-0 border-r bg-card flex flex-col h-full">
      <div className="p-4 border-b">
        <h2 className="font-semibold text-lg">Components</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Drag components to canvas
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4">
          <Accordion type="multiple" defaultValue={["victron", "generic", "safety", "custom"]} className="w-full">
            <AccordionItem value="victron">
              <AccordionTrigger className="text-sm font-medium">
                Victron Components
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2 mt-2">
                  {victronComponents.map((component) => (
                    <div
                      key={component.id}
                      draggable
                      onDragStart={() => handleDragStart(component)}
                      className="flex items-center gap-3 p-3 rounded-md border bg-background hover-elevate active-elevate-2 cursor-move select-none"
                      data-testid={`component-${component.id}`}
                    >
                      <div className="text-primary">{component.icon}</div>
                      <span className="text-sm flex-1">{component.name}</span>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="generic">
              <AccordionTrigger className="text-sm font-medium">
                Generic Components
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2 mt-2">
                  {genericComponents.map((component) => (
                    <div
                      key={component.id}
                      draggable
                      onDragStart={() => handleDragStart(component)}
                      className="flex items-center gap-3 p-3 rounded-md border bg-background hover-elevate active-elevate-2 cursor-move select-none"
                      data-testid={`component-${component.id}`}
                    >
                      <div className="text-primary">{component.icon}</div>
                      <span className="text-sm flex-1">{component.name}</span>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="safety">
              <AccordionTrigger className="text-sm font-medium">
                Safety & Distribution
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2 mt-2">
                  {safetyComponents.map((component) => (
                    <div
                      key={component.id}
                      draggable
                      onDragStart={() => handleDragStart(component)}
                      className="flex items-center gap-3 p-3 rounded-md border bg-background hover-elevate active-elevate-2 cursor-move select-none"
                      data-testid={`component-${component.id}`}
                    >
                      <div className="text-primary">{component.icon}</div>
                      <span className="text-sm flex-1">{component.name}</span>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="custom">
              <AccordionTrigger className="text-sm font-medium">
                Custom Components
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3 mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-2"
                    onClick={onCreateCustomDefinition}
                    data-testid="button-create-custom-definition"
                  >
                    <Plus className="h-4 w-4" />
                    Build a Component
                  </Button>

                  {!isAuthenticated && (
                    <p className="text-xs text-muted-foreground">
                      Sign in to build components with your own terminals and reuse them across designs.
                    </p>
                  )}

                  {isAuthenticated && myComponentsLoading && (
                    <p className="text-xs text-muted-foreground">Loading...</p>
                  )}

                  {isAuthenticated && !myComponentsLoading && myComponents.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Nothing saved yet. Build a component to place your own terminals exactly where you need them.
                    </p>
                  )}

                  {myComponents.map((def) => (
                    <div
                      key={def.id}
                      draggable
                      onDragStart={() => onDragStartCustomDefinition?.(def)}
                      className="flex items-center gap-2 p-3 rounded-md border bg-background hover-elevate active-elevate-2 cursor-move select-none"
                      data-testid={`component-custom-${def.id}`}
                    >
                      <div className="text-primary shrink-0">
                        <Puzzle className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{def.name}</div>
                        {def.subtitle && (
                          <div className="text-xs text-muted-foreground truncate">{def.subtitle}</div>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditCustomDefinition?.(def);
                        }}
                        data-testid={`button-edit-custom-${def.id}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteCustomDefinition?.(def);
                        }}
                        data-testid={`button-delete-custom-${def.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}

                  <Separator />

                  <div className="space-y-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full gap-2"
                      onClick={onAddCustom}
                      data-testid="button-add-custom"
                    >
                      <Plus className="h-4 w-4" />
                      Quick-add a plain box
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      A one-off placeholder with fixed +/- in and out terminals. Not saved to your library.
                    </p>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </ScrollArea>
    </div>
  );
}
