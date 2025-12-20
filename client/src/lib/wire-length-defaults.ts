import type { SchematicComponent, Wire } from "@shared/schema";

/**
 * Get default wire length based on component types being connected
 * These are logical defaults for typical RV/boat installations
 */
export function getDefaultWireLength(
  fromComponent: SchematicComponent | undefined,
  toComponent: SchematicComponent | undefined,
  fromTerminal: string,
  toTerminal: string
): number {
  if (!fromComponent || !toComponent) {
    return 10; // Default fallback
  }

  const fromType = fromComponent.type;
  const toType = toComponent.type;

  // Battery connections (short runs)
  if (fromType === "battery" || toType === "battery") {
    // Battery to fuse: very short (2 feet)
    if (fromType === "fuse" || toType === "fuse") {
      return 2;
    }
    // Battery to SmartShunt: short (3 feet)
    if (fromType === "smartshunt" || toType === "smartshunt") {
      return 3;
    }
    // Battery to bus bar: short (5 feet)
    if (fromType.includes("busbar") || toType.includes("busbar")) {
      return 5;
    }
    // Battery to other components: medium (8 feet)
    return 8;
  }

  // Solar panel connections (longer runs)
  if (fromType === "solar-panel" || toType === "solar-panel") {
    // Solar panel to MPPT: typical roof-to-controller run (25 feet)
    if (fromType === "mppt" || toType === "mppt") {
      return 25;
    }
    // Solar panel to other: medium (15 feet)
    return 15;
  }

  // Fuse connections
  if (fromType === "fuse" || toType === "fuse") {
    // Fuse to bus bar: medium (10 feet)
    if (fromType.includes("busbar") || toType.includes("busbar")) {
      return 10;
    }
    // Fuse to other: short (5 feet)
    return 5;
  }

  // Bus bar connections
  if (fromType.includes("busbar") || toType.includes("busbar")) {
    // Bus bar to loads: typical distribution run (10 feet)
    if (fromType === "dc-load" || toType === "dc-load" || 
        fromType === "ac-load" || toType === "ac-load" ||
        fromType === "inverter" || toType === "inverter" ||
        fromType === "multiplus" || toType === "multiplus" ||
        fromType === "phoenix-inverter" || toType === "phoenix-inverter") {
      return 10;
    }
    // Bus bar to other components: medium (8 feet)
    return 8;
  }

  // MPPT connections
  if (fromType === "mppt" || toType === "mppt") {
    // MPPT to bus bar: medium (8 feet)
    if (fromType.includes("busbar") || toType.includes("busbar")) {
      return 8;
    }
    // MPPT to battery: short (5 feet)
    if (fromType === "battery" || toType === "battery") {
      return 5;
    }
    // MPPT to other: medium (10 feet)
    return 10;
  }

  // Load connections
  if (fromType === "dc-load" || toType === "dc-load" || 
      fromType === "ac-load" || toType === "ac-load") {
    // Load to bus bar: typical distribution (10 feet)
    if (fromType.includes("busbar") || toType.includes("busbar")) {
      return 10;
    }
    // Load to inverter: short (5 feet)
    if (fromType === "inverter" || toType === "inverter" ||
        fromType === "multiplus" || toType === "multiplus" ||
        fromType === "phoenix-inverter" || toType === "phoenix-inverter") {
      return 5;
    }
    // Load to other: medium (8 feet)
    return 8;
  }

  // Inverter connections
  if (fromType === "inverter" || toType === "inverter" ||
      fromType === "multiplus" || toType === "multiplus" ||
      fromType === "phoenix-inverter" || toType === "phoenix-inverter") {
    // Inverter to bus bar: medium (8 feet)
    if (fromType.includes("busbar") || toType.includes("busbar")) {
      return 8;
    }
    // Inverter to battery: short (5 feet)
    if (fromType === "battery" || toType === "battery") {
      return 5;
    }
    // Inverter to other: medium (10 feet)
    return 10;
  }

  // Charger connections
  if (fromType === "blue-smart-charger" || toType === "blue-smart-charger" ||
      fromType === "orion-dc-dc" || toType === "orion-dc-dc") {
    // Charger to battery: short (5 feet)
    if (fromType === "battery" || toType === "battery") {
      return 5;
    }
    // Charger to bus bar: medium (8 feet)
    if (fromType.includes("busbar") || toType.includes("busbar")) {
      return 8;
    }
    // Charger to other: medium (10 feet)
    return 10;
  }

  // SmartShunt connections
  if (fromType === "smartshunt" || toType === "smartshunt") {
    // SmartShunt to bus bar: medium (8 feet)
    if (fromType.includes("busbar") || toType.includes("busbar")) {
      return 8;
    }
    // SmartShunt to other: short (5 feet)
    return 5;
  }

  // Default for any other connection type
  return 10;
}
