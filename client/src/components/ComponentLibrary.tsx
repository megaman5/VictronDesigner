import { Plus, Pencil, Trash2, ChevronDown } from "lucide-react";
import { useState } from "react";
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
import { ComponentIcon, CustomComponentIcon } from "@/components/component-icons";
import type { CustomComponentDefinition } from "@/lib/custom-components";

interface Component {
  id: string;
  name: string;
  category: string;
  /**
   * Shown up-front. Everything else sits behind "Show more" - with 32 built-in
   * parts, listing them all flat buries the handful most systems actually use
   * (a MultiPlus and an MPPT) under Lynx modules and Cyrix combiners.
   */
  common?: boolean;
}

const victronComponents: Component[] = [
  { id: "multiplus", name: "MultiPlus Inverter", category: "victron", common: true },
  { id: "quattro", name: "Quattro Inverter/Charger", category: "victron", common: true },
  { id: "mppt", name: "MPPT Controller", category: "victron", common: true },
  { id: "cerbo", name: "Cerbo GX", category: "victron", common: true },
  { id: "smartshunt", name: "SmartShunt", category: "victron", common: true },
  { id: "orion-dc-dc", name: "Orion DC-DC Charger", category: "victron", common: true },
  { id: "phoenix-inverter", name: "Phoenix Inverter", category: "victron" },
  { id: "bmv", name: "BMV-712 Battery Monitor", category: "victron" },
  { id: "blue-smart-charger", name: "Blue Smart Charger", category: "victron" },
  { id: "battery-protect", name: "Battery Protect", category: "victron" },
  { id: "argofet", name: "Argo FET Isolator", category: "victron" },
  { id: "cyrix-ct", name: "Cyrix-CT Combiner", category: "victron" },
  { id: "battery-balancer", name: "Battery Balancer", category: "victron" },
  { id: "lynx-power-in", name: "Lynx Power In", category: "victron" },
  { id: "lynx-distributor", name: "Lynx Distributor", category: "victron" },
  { id: "lynx-shunt", name: "Lynx Shunt VE.Can", category: "victron" },
  { id: "lynx-smart-bms", name: "Lynx Smart BMS", category: "victron" },
];

const genericComponents: Component[] = [
  { id: "battery", name: "Battery Bank", category: "generic", common: true },
  { id: "solar-panel", name: "Solar Panel", category: "generic", common: true },
  { id: "dc-load", name: "DC Load", category: "generic", common: true },
  { id: "ac-load", name: "AC Load", category: "generic", common: true },
  { id: "busbar-positive", name: "Positive Bus Bar", category: "generic", common: true },
  { id: "busbar-negative", name: "Negative Bus Bar", category: "generic", common: true },
  { id: "alternator", name: "Alternator", category: "generic" },
  { id: "inverter", name: "Inverter", category: "generic" },
];

const safetyComponents: Component[] = [
  { id: "fuse", name: "Fuse (Class T, MEGA, blade...)", category: "safety", common: true },
  { id: "dc-breaker", name: "DC Circuit Breaker", category: "safety", common: true },
  { id: "switch", name: "Battery Switch", category: "safety", common: true },
  { id: "shore-power", name: "Shore Power", category: "safety", common: true },
  { id: "ac-breaker", name: "AC Circuit Breaker", category: "safety" },
  { id: "dc-panel", name: "DC Panel", category: "safety" },
  { id: "ac-panel", name: "AC Panel", category: "safety" },
  { id: "transfer-switch", name: "Transfer Switch", category: "safety" },
];

/**
 * One library category. Common parts render immediately; the rest stay behind
 * a "Show more" toggle so the list opens at a usable length.
 */
function ComponentSection({
  value,
  title,
  components,
  onDragStart,
}: {
  value: string;
  title: string;
  components: Component[];
  onDragStart: (component: Component) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const common = components.filter((c) => c.common);
  // A category with nothing marked common shows everything rather than
  // rendering an empty list behind a toggle.
  const visible = common.length === 0 || expanded ? components : common;
  const hiddenCount = components.length - visible.length;

  return (
    <AccordionItem value={value}>
      <AccordionTrigger className="text-sm font-medium">{title}</AccordionTrigger>
      <AccordionContent>
        <div className="space-y-2 mt-2">
          {visible.map((component) => (
            <div
              key={component.id}
              draggable
              onDragStart={() => onDragStart(component)}
              className="flex items-center gap-3 p-3 rounded-md border bg-background hover-elevate active-elevate-2 cursor-move select-none"
              data-testid={`component-${component.id}`}
            >
              <div className="text-primary shrink-0">
                <ComponentIcon type={component.id} />
              </div>
              <span className="text-sm flex-1">{component.name}</span>
            </div>
          ))}

          {hiddenCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full gap-1 text-xs text-muted-foreground"
              onClick={() => setExpanded(true)}
              data-testid={`button-show-more-${value}`}
            >
              <ChevronDown className="h-3.5 w-3.5" />
              Show {hiddenCount} more
            </Button>
          )}

          {expanded && common.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-muted-foreground"
              onClick={() => setExpanded(false)}
              data-testid={`button-show-less-${value}`}
            >
              Show less
            </Button>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

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
            <ComponentSection
              value="victron"
              title="Victron Components"
              components={victronComponents}
              onDragStart={handleDragStart}
            />

            <ComponentSection
              value="generic"
              title="Generic Components"
              components={genericComponents}
              onDragStart={handleDragStart}
            />

            <ComponentSection
              value="safety"
              title="Safety & Distribution"
              components={safetyComponents}
              onDragStart={handleDragStart}
            />

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
                        <CustomComponentIcon
                          width={def.width}
                          height={def.height}
                          terminals={def.terminals}
                        />
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
