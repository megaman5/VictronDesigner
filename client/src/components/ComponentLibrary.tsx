import { Battery, Cable, Gauge, Cpu, Sun, Plus } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface Component {
  id: string;
  name: string;
  icon: React.ReactNode;
  category: string;
}

const victronComponents: Component[] = [
  { id: "multiplus", name: "MultiPlus Inverter", icon: <Cable className="h-5 w-5" />, category: "victron" },
  { id: "mppt", name: "MPPT Controller", icon: <Sun className="h-5 w-5" />, category: "victron" },
  { id: "cerbo", name: "Cerbo GX", icon: <Cpu className="h-5 w-5" />, category: "victron" },
  { id: "bmv", name: "BMV Monitor", icon: <Gauge className="h-5 w-5" />, category: "victron" },
  { id: "smartshunt", name: "SmartShunt", icon: <Gauge className="h-5 w-5" />, category: "victron" },
  { id: "battery", name: "Battery Bank", icon: <Battery className="h-5 w-5" />, category: "victron" },
];

const genericComponents: Component[] = [
  { id: "solar-panel", name: "Solar Panel", icon: <Sun className="h-5 w-5" />, category: "generic" },
  { id: "ac-load", name: "AC Load", icon: <Gauge className="h-5 w-5" />, category: "generic" },
  { id: "dc-load", name: "DC Load", icon: <Cable className="h-5 w-5" />, category: "generic" },
  { id: "busbar-positive", name: "Positive Bus Bar", icon: <Cable className="h-5 w-5" />, category: "generic" },
  { id: "busbar-negative", name: "Negative Bus Bar", icon: <Cable className="h-5 w-5" />, category: "generic" },
];

interface ComponentLibraryProps {
  onDragStart?: (component: Component) => void;
  onAddCustom?: () => void;
}

export function ComponentLibrary({ onDragStart, onAddCustom }: ComponentLibraryProps) {
  const handleDragStart = (component: Component) => {
    console.log("Drag started:", component.name);
    onDragStart?.(component);
  };

  return (
    <div className="w-80 border-r bg-card flex flex-col h-full">
      <div className="p-4 border-b">
        <h2 className="font-semibold text-lg">Components</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Drag components to canvas
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4">
          <Accordion type="multiple" defaultValue={["victron", "generic", "custom"]} className="w-full">
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
                      className="flex items-center gap-3 p-3 rounded-md border bg-background hover-elevate active-elevate-2 cursor-move"
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
                      className="flex items-center gap-3 p-3 rounded-md border bg-background hover-elevate active-elevate-2 cursor-move"
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
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 mt-2"
                  onClick={onAddCustom}
                  data-testid="button-add-custom"
                >
                  <Plus className="h-4 w-4" />
                  Add Custom Component
                </Button>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </ScrollArea>
    </div>
  );
}
