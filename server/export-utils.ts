import type { Schematic, SchematicComponent, Wire } from "@shared/schema";

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
        report += `   ${key}: ${value}\n`;
      });
    }
  });

  report += `\nWIRING CONNECTIONS (${wires.length})\n`;
  report += `----------------------\n`;
  const componentMap = new Map(components.map((c) => [c.id, c]));
  wires.forEach((wire, i) => {
    const from = componentMap.get(wire.fromComponentId);
    const to = componentMap.get(wire.toComponentId);
    if (from && to) {
      const polarity = wire.polarity === "positive" ? "+" : wire.polarity === "negative" ? "-" : "~";
      report += `${i + 1}. ${from.name} → ${to.name}\n`;
      report += `   Polarity: ${polarity} | Gauge: ${wire.gauge || "TBD"} | Length: ${wire.length}ft\n`;
    }
  });

  report += `\n------------------\n`;
  report += `Generated by Victron Schematic Designer\n`;

  return report;
}
