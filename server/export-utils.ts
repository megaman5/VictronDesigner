import type { Schematic, SchematicComponent, Wire } from "@shared/schema";
import { validateDesign } from "./design-validator";
import { calculateInverterDCInput, getACVoltage } from "./wire-calculator";

export interface ShoppingListItem {
  category: string;
  item: string;
  quantity: number;
  description: string;
  estimatedPrice?: string;
}

export function generateShoppingList(schematic: Schematic): ShoppingListItem[] {
  const components = schematic.components as SchematicComponent[];
  const wires = schematic.wires as Wire[];
  const items: ShoppingListItem[] = [];
  const itemMap = new Map<string, ShoppingListItem>();

  // Aggregate components
  components.forEach((comp) => {
    const key = `${comp.type}-${comp.name}`;
    
    let category = "Other";
    let description = comp.name;
    
    switch (comp.type) {
      case "multiplus":
        category = "Inverter/Charger";
        description = `Victron MultiPlus ${comp.properties.power}W Inverter/Charger`;
        break;
      case "mppt":
        category = "Solar Controllers";
        description = `Victron SmartSolar MPPT ${comp.properties.voltage || 100}/${comp.properties.current || 30}`;
        break;
      case "cerbo":
        category = "Monitoring";
        description = "Victron Cerbo GX with GX Touch 50";
        break;
      case "bmv":
        category = "Monitoring";
        description = "Victron BMV-712 Smart Battery Monitor";
        break;
      case "battery":
        category = "Batteries";
        description = `${comp.properties.voltage || 12}V ${comp.properties.capacity || 200}Ah Battery`;
        break;
      case "solar-panel":
        category = "Solar Panels";
        description = `${comp.properties.power || 300}W Solar Panel`;
        break;
      case "ac-load":
        category = "AC Loads";
        description = `AC Load: ${comp.name}`;
        break;
      case "dc-load":
        category = "DC Loads";
        description = `DC Load: ${comp.name}`;
        break;
    }

    if (itemMap.has(key)) {
      itemMap.get(key)!.quantity++;
    } else {
      itemMap.set(key, {
        category,
        item: comp.name,
        quantity: 1,
        description,
      });
    }
  });

  // Aggregate wires by gauge
  const wiresByGauge = new Map<string, number>();
  wires.forEach((wire) => {
    const gauge = wire.gauge || "10 AWG";
    const length = wire.length || 5;
    wiresByGauge.set(gauge, (wiresByGauge.get(gauge) || 0) + length);
  });

  wiresByGauge.forEach((totalLength, gauge) => {
    // Round up to nearest 10 feet
    const roundedLength = Math.ceil(totalLength / 10) * 10;
    items.push({
      category: "Wire & Cable",
      item: `${gauge} Marine Wire`,
      quantity: 1,
      description: `${roundedLength}ft of ${gauge} tinned copper marine wire (add 20% for slack)`,
    });
  });

  // Add connectors and terminals
  if (components.length > 0) {
    items.push({
      category: "Connectors & Terminals",
      item: "Ring Terminals",
      quantity: 1,
      description: "Assorted ring terminals for wire terminations",
    });
    
    items.push({
      category: "Connectors & Terminals",
      item: "Heat Shrink Tubing",
      quantity: 1,
      description: "Marine-grade heat shrink tubing assortment",
    });

    items.push({
      category: "Connectors & Terminals",
      item: "Cable Ties",
      quantity: 1,
      description: "UV-resistant cable ties for wire management",
    });
  }

  // Add items from map
  items.push(...Array.from(itemMap.values()));

  // Sort by category
  items.sort((a, b) => a.category.localeCompare(b.category));

  return items;
}

export function generateWireLabels(schematic: Schematic): string[] {
  const wires = schematic.wires as Wire[];
  const components = schematic.components as SchematicComponent[];
  const componentMap = new Map(components.map((c) => [c.id, c]));
  
  const labels: string[] = [];

  wires.forEach((wire, index) => {
    const fromComp = componentMap.get(wire.fromComponentId);
    const toComp = componentMap.get(wire.toComponentId);
    
    if (fromComp && toComp) {
      const wireNumber = `W${(index + 1).toString().padStart(3, "0")}`;
      const polaritySymbol = wire.polarity === "positive" ? "+" : wire.polarity === "negative" ? "-" : "~";
      const gauge = wire.gauge || "10 AWG";
      
      labels.push(
        `${wireNumber} | ${fromComp.name} → ${toComp.name} | ${polaritySymbol} ${gauge} | ${wire.length}ft`
      );
    }
  });

  return labels;
}

export function generateCSV(items: ShoppingListItem[]): string {
  const headers = ["Category", "Item", "Quantity", "Description", "Price"];
  const rows = items.map((item) => [
    item.category,
    item.item,
    item.quantity.toString(),
    item.description,
    item.estimatedPrice || "",
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map((row) =>
      row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n");

  return csvContent;
}

export function generateSystemReport(schematic: Schematic): string {
  const components = schematic.components as SchematicComponent[];
  const wires = schematic.wires as Wire[];
  const componentMap = new Map(components.map((c) => [c.id, c]));
  
  // Run validation to get warnings/errors
  const validation = validateDesign(components, wires, schematic.systemVoltage);
  
  let report = `VICTRON ELECTRICAL SYSTEM DESIGN REPORT\n`;
  report += `=========================================\n\n`;
  report += `Project: ${schematic.name}\n`;
  if (schematic.description) {
    report += `Description: ${schematic.description}\n`;
  }
  report += `System Voltage: ${schematic.systemVoltage}V DC\n`;
  report += `Date: ${new Date().toLocaleDateString()}\n\n`;

  report += `COMPONENTS (${components.length})\n`;
  report += `------------------\n`;
  components.forEach((comp, i) => {
    report += `${i + 1}. ${comp.name} (${comp.type})\n`;
    if (comp.properties) {
      Object.entries(comp.properties).forEach(([key, value]) => {
        // Skip displaying old 'voltage' property for AC loads (use acVoltage instead)
        if (comp.type === "ac-load" && key === "voltage") {
          return; // Don't display voltage for AC loads, only acVoltage
        }
        if (value !== null && value !== undefined && value !== "") {
          // Format current to 1 decimal place
          if (key === "current" && typeof value === "number") {
            report += `   ${key}: ${value.toFixed(1)}\n`;
          } else {
            report += `   ${key}: ${value}\n`;
          }
        }
      });
    }
    
    // Calculate and display component power
    const props = comp.properties || {};
    
    // For loads, show input power
    if (comp.type === "dc-load" || comp.type === "ac-load") {
      const loadWatts = (props.watts || props.power || 0) as number;
      const loadVoltage = comp.type === "ac-load" 
        ? getACVoltage(comp)
        : (props.voltage as number || schematic.systemVoltage);
      const loadCurrent = loadWatts > 0 && loadVoltage > 0 ? loadWatts / loadVoltage : 0;
      if (loadWatts > 0) {
        const voltageLabel = comp.type === "ac-load" ? `${loadVoltage}V AC` : `${loadVoltage}V DC`;
        report += `   Input Power: ${loadWatts.toFixed(0)}W @ ${voltageLabel} (${loadCurrent.toFixed(1)}A)\n`;
      }
    }
    
    // For inverters, show AC output and DC input
    if (comp.type === "multiplus" || comp.type === "phoenix-inverter" || comp.type === "inverter") {
      const inverterRating = (props.powerRating || props.watts || props.power || 0) as number;
      if (inverterRating > 0) {
        report += `   AC Output Rating: ${inverterRating.toFixed(0)}W\n`;
      }
      
      // Calculate DC input from AC loads
      const inverterDC = calculateInverterDCInput(comp.id, components, wires, schematic.systemVoltage);
      if (inverterDC.dcInputWatts > 0) {
        report += `   DC Input (calculated): ${inverterDC.dcInputWatts.toFixed(0)}W @ ${schematic.systemVoltage}V DC (${inverterDC.dcInputCurrent.toFixed(1)}A)\n`;
        report += `   AC Loads: ${inverterDC.acLoadWatts.toFixed(0)}W @ ${inverterDC.acVoltage}V AC\n`;
        report += `   Efficiency: 87.5%\n`;
      } else if (inverterRating > 0) {
        // If no AC loads found, show estimated DC input based on rating
        const estimatedDCWatts = inverterRating / 0.875; // Assume 87.5% efficiency
        const estimatedDCCurrent = estimatedDCWatts / schematic.systemVoltage;
        report += `   Estimated DC Input: ${estimatedDCWatts.toFixed(0)}W @ ${schematic.systemVoltage}V DC (${estimatedDCCurrent.toFixed(1)}A) - No AC loads detected\n`;
      }
    }
    
    // For solar panels, show output
    if (comp.type === "solar-panel") {
      const panelWatts = (props.watts || props.power || 0) as number;
      if (panelWatts > 0) {
        report += `   Output Power: ${panelWatts.toFixed(0)}W\n`;
      }
    }
    
    // For MPPT, show input/output
    if (comp.type === "mppt") {
      const maxCurrent = (props.maxCurrent || props.amps || props.current || 0) as number;
      const voltage = (props.voltage as number || schematic.systemVoltage);
      if (maxCurrent > 0) {
        report += `   Max Output: ${(maxCurrent * voltage).toFixed(0)}W @ ${voltage}V (${maxCurrent.toFixed(1)}A)\n`;
      }
    }
    
    // For bus bars, calculate totals (only DC loads and inverter DC inputs, not AC loads)
    if (comp.type === "busbar-positive" || comp.type === "busbar-negative") {
      const connectedWires = wires.filter(
        w => w.fromComponentId === comp.id || w.toComponentId === comp.id
      );
      
      let totalWatts = 0;
      let totalCurrent = 0;
      let voltage = schematic.systemVoltage;
      const visitedComps = new Set<string>();
      
      connectedWires.forEach(wire => {
        const otherCompId = wire.fromComponentId === comp.id 
          ? wire.toComponentId 
          : wire.fromComponentId;
        
        if (visitedComps.has(otherCompId)) return; // Prevent double counting
        visitedComps.add(otherCompId);
        
        const otherComp = componentMap.get(otherCompId);
        if (!otherComp) return;
        
        // Skip AC loads and AC panels - they're on a separate AC system
        if (otherComp.type === "ac-load" || otherComp.type === "ac-panel") return;
        
        const otherProps = otherComp.properties || {};
        
        // For inverters, get DC input current
        if (otherComp.type === "inverter" || otherComp.type === "multiplus" || otherComp.type === "phoenix-inverter") {
          const inverterDC = calculateInverterDCInput(otherComp.id, components, wires, schematic.systemVoltage);
          totalWatts += inverterDC.dcInputWatts;
          totalCurrent += inverterDC.dcInputCurrent;
        }
        // For DC loads, calculate from watts/voltage
        else if (otherComp.type === "dc-load") {
          const loadWatts = (otherProps.watts || otherProps.power || 0) as number;
          totalWatts += loadWatts;
          const loadVoltage = (otherProps.voltage as number || voltage);
          if (loadWatts > 0 && loadVoltage > 0) {
            totalCurrent += loadWatts / loadVoltage;
          } else if (otherProps.current || otherProps.amps) {
            const loadCurrent = (otherProps.current || otherProps.amps || 0) as number;
            totalCurrent += loadCurrent;
            totalWatts += loadCurrent * loadVoltage;
          }
        }
        // For MPPT/chargers, get their output
        else if (otherComp.type === "mppt" || otherComp.type === "blue-smart-charger" || otherComp.type === "orion-dc-dc") {
          const chargeCurrent = (otherProps.amps || otherProps.current || 0) as number;
          const chargeVoltage = (otherProps.voltage as number || voltage);
          totalCurrent += chargeCurrent;
          totalWatts += chargeCurrent * chargeVoltage;
        }
      });
      
      if (totalWatts > 0 || totalCurrent > 0) {
        report += `   Total Power: ${totalWatts.toFixed(0)}W\n`;
        report += `   Total Current: ${totalCurrent.toFixed(1)}A @ ${voltage}V DC\n`;
      }
    }
    
    // For AC panels, calculate totals
    if (comp.type === "ac-panel") {
      const panelWires = wires.filter(
        w => (w.fromComponentId === comp.id || w.toComponentId === comp.id) &&
             w.polarity === "hot"
      );
      
      let totalWatts = 0;
      let acVoltage = 120;
      const visitedLoads = new Set<string>();
      
      panelWires.forEach(wire => {
        const otherCompId = wire.fromComponentId === comp.id 
          ? wire.toComponentId 
          : wire.fromComponentId;
        
        if (!visitedLoads.has(otherCompId)) {
          visitedLoads.add(otherCompId);
          const otherComp = componentMap.get(otherCompId);
          if (otherComp && otherComp.type === "ac-load") {
            const loadWatts = (otherComp.properties?.watts || otherComp.properties?.power || 0) as number;
            totalWatts += loadWatts;
            const loadVoltage = otherComp.properties?.acVoltage || otherComp.properties?.voltage || 120;
            // AC loads should always use AC voltage (120V/220V/etc), not DC voltage
            if (loadVoltage && (loadVoltage === 110 || loadVoltage === 120 || loadVoltage === 220 || loadVoltage === 230)) {
              acVoltage = loadVoltage;
            }
          }
        }
      });
      
      if (totalWatts > 0) {
        const totalCurrent = totalWatts / acVoltage;
        report += `   Total Power: ${totalWatts.toFixed(0)}W @ ${acVoltage}V AC (${totalCurrent.toFixed(1)}A)\n`;
      }
    }
  });

  report += `\nWIRING CONNECTIONS (${wires.length})\n`;
  report += `----------------------\n`;
  wires.forEach((wire, i) => {
    const from = componentMap.get(wire.fromComponentId);
    const to = componentMap.get(wire.toComponentId);
    if (from && to) {
      const polarity = wire.polarity === "positive" ? "+" : wire.polarity === "negative" ? "-" : "~";
      report += `${i + 1}. ${from.name} → ${to.name}\n`;
      report += `   Polarity: ${polarity} | Gauge: ${wire.gauge || "TBD"} | Length: ${wire.length}ft\n`;
      
      // Calculate wire power
      let wireCurrent = wire.current || 0;
      let wireVoltage = schematic.systemVoltage;
      
      // Determine voltage
      const isACWire = wire.polarity === "hot" || wire.polarity === "neutral" || wire.polarity === "ground" ||
                       from.type === "ac-load" || to.type === "ac-load" ||
                       from.type === "ac-panel" || to.type === "ac-panel";
      
      if (isACWire) {
        wireVoltage = getACVoltage(from || to);
      } else {
        if (from.properties?.voltage) {
          wireVoltage = from.properties.voltage as number;
        } else if (to.properties?.voltage) {
          wireVoltage = to.properties.voltage as number;
        }
      }
      
      // Calculate current if not set
      if (wireCurrent === 0) {
        // Check if inverter DC connection
        const isInverterDC = (from.type === "multiplus" || from.type === "phoenix-inverter" || from.type === "inverter") &&
                            (wire.fromTerminal === "dc-positive" || wire.fromTerminal === "dc-negative") ||
                            (to.type === "multiplus" || to.type === "phoenix-inverter" || to.type === "inverter") &&
                            (wire.toTerminal === "dc-positive" || wire.toTerminal === "dc-negative");
        
        if (isInverterDC) {
          const inverterId = from.type === "multiplus" || from.type === "phoenix-inverter" || from.type === "inverter"
            ? from.id
            : to.id;
          if (inverterId) {
            const inverterDC = calculateInverterDCInput(inverterId, components, wires, schematic.systemVoltage);
            wireCurrent = inverterDC.dcInputCurrent;
            wireVoltage = schematic.systemVoltage;
          }
        } else if (to.type === "dc-load" || to.type === "ac-load") {
          const loadWatts = (to.properties?.watts || to.properties?.power || 0) as number;
          const loadVoltage = to.type === "ac-load"
            ? getACVoltage(to)
            : (to.properties?.voltage as number || wireVoltage);
          if (loadWatts > 0 && loadVoltage > 0) {
            wireCurrent = loadWatts / loadVoltage;
            wireVoltage = loadVoltage;
          }
        } else if (from.type === "dc-load" || from.type === "ac-load") {
          const loadWatts = (from.properties?.watts || from.properties?.power || 0) as number;
          const loadVoltage = from.type === "ac-load"
            ? getACVoltage(from)
            : (from.properties?.voltage as number || wireVoltage);
          if (loadWatts > 0 && loadVoltage > 0) {
            wireCurrent = loadWatts / loadVoltage;
            wireVoltage = loadVoltage;
          }
        } else if (to.type === "ac-panel" && wire.polarity === "hot") {
          // For AC panel hot wire connections, calculate from connected AC loads
          const panelWires = wires.filter(
            w => (w.fromComponentId === to.id || w.toComponentId === to.id) &&
                 w.polarity === "hot"
          );
          
          let panelWatts = 0;
          let panelVoltage = 120;
          const visitedLoads = new Set<string>();
          
          panelWires.forEach(panelWire => {
            const otherCompId = panelWire.fromComponentId === to.id 
              ? panelWire.toComponentId 
              : panelWire.fromComponentId;
            
            if (!visitedLoads.has(otherCompId)) {
              visitedLoads.add(otherCompId);
              const otherComp = componentMap.get(otherCompId);
              if (otherComp && otherComp.type === "ac-load") {
                const loadWatts = (otherComp.properties?.watts || otherComp.properties?.power || 0) as number;
                panelWatts += loadWatts;
                const loadVoltage = otherComp.properties?.acVoltage || otherComp.properties?.voltage || 120;
                if (loadVoltage && (loadVoltage === 110 || loadVoltage === 120 || loadVoltage === 220 || loadVoltage === 230)) {
                  panelVoltage = loadVoltage;
                }
              }
            }
          });
          
          if (panelWatts > 0) {
            wireCurrent = panelWatts / panelVoltage;
            wireVoltage = panelVoltage;
          }
        } else if (from.type === "ac-panel" && wire.polarity === "hot") {
          // For AC panel hot wire connections (from panel to load)
          const loadWatts = (to.properties?.watts || to.properties?.power || 0) as number;
          const loadVoltage = getACVoltage(to);
          if (loadWatts > 0 && loadVoltage > 0) {
            wireCurrent = loadWatts / loadVoltage;
            wireVoltage = loadVoltage;
          }
        } else if (to.type === "inverter" && (wire.polarity === "hot" || wire.polarity === "neutral")) {
          // For inverter AC output wires, calculate from connected AC loads
          const inverterDC = calculateInverterDCInput(to.id, components, wires, schematic.systemVoltage);
          if (inverterDC.acLoadWatts > 0) {
            wireCurrent = inverterDC.acLoadWatts / inverterDC.acVoltage;
            wireVoltage = inverterDC.acVoltage;
          }
        } else if (from.type === "inverter" && (wire.polarity === "hot" || wire.polarity === "neutral")) {
          // For inverter AC output wires (from inverter to panel)
          const inverterDC = calculateInverterDCInput(from.id, components, wires, schematic.systemVoltage);
          if (inverterDC.acLoadWatts > 0) {
            wireCurrent = inverterDC.acLoadWatts / inverterDC.acVoltage;
            wireVoltage = inverterDC.acVoltage;
          }
        }
      }
      
      // Calculate wire power (only for hot/positive/negative wires, not neutral/ground)
      // Don't show power for neutral or ground wires (they don't carry power separately)
      if (wire.polarity !== "neutral" && wire.polarity !== "ground" && wireCurrent > 0) {
        const wireWatts = wireCurrent * wireVoltage;
        const voltageLabel = isACWire ? `${wireVoltage}V AC` : `${wireVoltage}V DC`;
        report += `   Power: ${wireWatts.toFixed(0)}W (${wireCurrent.toFixed(1)}A @ ${voltageLabel})\n`;
      }
    }
  });

  // Add validation warnings and errors
  if (validation.issues && validation.issues.length > 0) {
    report += `\n\nVALIDATION RESULTS\n`;
    report += `------------------\n`;
    report += `Quality Score: ${validation.score}/100\n\n`;
    
    const errors = validation.issues.filter(i => i.severity === "error");
    const warnings = validation.issues.filter(i => i.severity === "warning");
    const info = validation.issues.filter(i => i.severity === "info");
    
    if (errors.length > 0) {
      report += `ERRORS (${errors.length}):\n`;
      errors.forEach((issue, i) => {
        report += `${i + 1}. [${issue.category.toUpperCase()}] ${issue.message}\n`;
        if (issue.suggestion) {
          report += `   Suggestion: ${issue.suggestion}\n`;
        }
        if (issue.componentIds && issue.componentIds.length > 0) {
          const compNames = issue.componentIds.map(id => {
            const comp = componentMap.get(id);
            return comp?.name || id;
          }).join(", ");
          report += `   Components: ${compNames}\n`;
        }
        if (issue.wireId) {
          const wire = wires.find(w => w.id === issue.wireId);
          if (wire) {
            const from = componentMap.get(wire.fromComponentId);
            const to = componentMap.get(wire.toComponentId);
            if (from && to) {
              report += `   Wire: ${from.name} → ${to.name}\n`;
            }
          }
        }
      });
      report += `\n`;
    }
    
    if (warnings.length > 0) {
      report += `WARNINGS (${warnings.length}):\n`;
      warnings.forEach((issue, i) => {
        report += `${i + 1}. [${issue.category.toUpperCase()}] ${issue.message}\n`;
        if (issue.suggestion) {
          report += `   Suggestion: ${issue.suggestion}\n`;
        }
        if (issue.componentIds && issue.componentIds.length > 0) {
          const compNames = issue.componentIds.map(id => {
            const comp = componentMap.get(id);
            return comp?.name || id;
          }).join(", ");
          report += `   Components: ${compNames}\n`;
        }
        if (issue.wireId) {
          const wire = wires.find(w => w.id === issue.wireId);
          if (wire) {
            const from = componentMap.get(wire.fromComponentId);
            const to = componentMap.get(wire.toComponentId);
            if (from && to) {
              report += `   Wire: ${from.name} → ${to.name}\n`;
            }
          }
        }
      });
      report += `\n`;
    }
    
    if (info.length > 0) {
      report += `INFORMATION (${info.length}):\n`;
      info.forEach((issue, i) => {
        report += `${i + 1}. [${issue.category.toUpperCase()}] ${issue.message}\n`;
        if (issue.suggestion) {
          report += `   Suggestion: ${issue.suggestion}\n`;
        }
      });
      report += `\n`;
    }
  }

  report += `\n------------------\n`;
  report += `Generated by Victron Schematic Designer\n`;

  return report;
}
