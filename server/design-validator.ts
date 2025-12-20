import type { SchematicComponent, Wire } from "@shared/schema";
import { TERMINAL_CONFIGS } from "../client/src/lib/terminal-config";
import { getWireAmpacity } from "./wire-calculator";

export interface ValidationIssue {
  severity: "error" | "warning" | "info";
  category: "electrical" | "wire-sizing" | "layout" | "terminal" | "ai-quality";
  message: string;
  componentIds?: string[];
  wireId?: string;
  wireIds?: string[];
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  score: number; // 0-100 quality score
  issues: ValidationIssue[];
  metrics: DesignMetrics;
}

export interface DesignMetrics {
  componentCount: number;
  wireCount: number;
  avgComponentSpacing: number;
  overlappingComponents: number;
  invalidTerminalConnections: number;
  wireGaugeIssues: number;
  electricalRuleViolations: number;
  layoutEfficiency: number; // 0-100
}

/**
 * Comprehensive design validation engine
 */
export class DesignValidator {
  private components: SchematicComponent[];
  private wires: Wire[];
  private issues: ValidationIssue[] = [];
  private systemVoltage: number;

  constructor(components: SchematicComponent[], wires: Wire[], systemVoltage: number = 12) {
    this.components = components;
    this.wires = wires;
    this.systemVoltage = systemVoltage;
  }

  /**
   * Run all validations and return results
   */
  validate(): ValidationResult {
    this.issues = [];

    // Run all validation checks
    this.validateElectricalRules();
    this.validateWireSizing();
    this.validateLayout();
    this.validateTerminalConnections();
    this.validateAIQuality();
    this.validatePowerCapacity();

    // Calculate metrics
    const metrics = this.calculateMetrics();

    // Calculate overall quality score
    const score = this.calculateQualityScore(metrics);

    return {
      valid: this.issues.filter(i => i.severity === "error").length === 0,
      score,
      issues: this.issues,
      metrics,
    };
  }

  /**
   * Validate electrical engineering rules
   */
  private validateElectricalRules(): void {
    // Rule 1: SmartShunt must be in negative path
    this.validateSmartShuntPlacement();

    // Rule 2: No polarity mixing on bus bars
    this.validateBusBarPolarity();

    // Rule 3: Proper grounding
    this.validateGrounding();

    // Rule 4: Battery connections
    this.validateBatteryConnections();

    // Rule 5: DC/AC separation
    this.validateDCACMingling();

    // Rule 6: Voltage mismatches
    this.validateVoltageMismatches();

    // Rule 7: MPPT must have solar panel connections
    this.validateMPPTSolarConnections();
  }

  private validateSmartShuntPlacement(): void {
    const smartShunt = this.components.find(c => c.type === "smartshunt");
    if (!smartShunt) return; // No SmartShunt, no rule to check

    const battery = this.components.find(c => c.type === "battery");
    if (!battery) {
      this.issues.push({
        severity: "error",
        category: "electrical",
        message: "SmartShunt present but no battery found",
        componentIds: [smartShunt.id],
        suggestion: "Add a battery or remove the SmartShunt",
      });
      return;
    }

    // Check that battery negative connects to SmartShunt "negative" terminal
    const batteryToShunt = this.wires.find(
      w => w.fromComponentId === battery.id &&
           w.toComponentId === smartShunt.id &&
           w.fromTerminal === "negative" &&
           w.toTerminal === "negative"
    );

    if (!batteryToShunt) {
      this.issues.push({
        severity: "error",
        category: "electrical",
        message: "SmartShunt not properly connected in negative path from battery",
        componentIds: [battery.id, smartShunt.id],
        suggestion: "Connect battery negative to SmartShunt 'negative' terminal",
      });
    }

    // Check that all loads connect to system-minus (not directly to battery negative)
    const loads = this.components.filter(c => c.type === "dc-load" || c.type === "multiplus");
    const loadsConnectedDirectly = loads.filter(load => {
      return this.wires.some(
        w => w.fromComponentId === battery.id &&
             w.toComponentId === load.id &&
             w.polarity === "negative"
      );
    });

    if (loadsConnectedDirectly.length > 0) {
      this.issues.push({
        severity: "warning",
        category: "electrical",
        message: `${loadsConnectedDirectly.length} load(s) connected directly to battery negative, bypassing SmartShunt`,
        componentIds: loadsConnectedDirectly.map(l => l.id),
        suggestion: "Connect loads to SmartShunt 'system-minus' terminal for accurate current monitoring",
      });
    }
  }

  private validateBusBarPolarity(): void {
    const busBars = this.components.filter(c => c.type?.includes("busbar"));

    busBars.forEach(busBar => {
      const connections = this.wires.filter(
        w => w.fromComponentId === busBar.id || w.toComponentId === busBar.id
      );

      const polarities = new Set(connections.map(w => w.polarity));

      if (polarities.size > 1) {
        this.issues.push({
          severity: "error",
          category: "electrical",
          message: `Bus bar "${busBar.name}" has mixed polarities (${Array.from(polarities).join(", ")})`,
          componentIds: [busBar.id],
          suggestion: "Use separate bus bars for positive and negative connections",
        });
      }

      // Check DC/AC mixing
      const hasAC = connections.some(w => w.polarity === "neutral");
      const hasDC = connections.some(w => w.polarity === "positive" || w.polarity === "negative");

      if (hasAC && hasDC) {
        this.issues.push({
          severity: "error",
          category: "electrical",
          message: `Bus bar "${busBar.name}" mixes AC and DC connections`,
          componentIds: [busBar.id],
          suggestion: "Use separate bus bars for AC and DC circuits",
        });
      }
    });
  }

  private validateGrounding(): void {
    // Check that all data connections are properly grounded
    const dataWires = this.wires.filter(w => w.polarity === "ground");
    const cerbo = this.components.find(c => c.type === "cerbo");

    if (cerbo && dataWires.length === 0) {
      this.issues.push({
        severity: "warning",
        category: "electrical",
        message: "Cerbo GX present but no data connections found",
        componentIds: [cerbo.id],
        suggestion: "Connect monitoring devices (BMV, SmartShunt) to Cerbo via VE.Direct",
      });
    }
  }

  private validateBatteryConnections(): void {
    const batteries = this.components.filter(c => c.type === "battery");

    batteries.forEach(battery => {
      const positiveWires = this.wires.filter(
        w => w.fromComponentId === battery.id && w.fromTerminal === "positive"
      );
      const negativeWires = this.wires.filter(
        w => w.fromComponentId === battery.id && w.fromTerminal === "negative"
      );

      if (positiveWires.length === 0 || negativeWires.length === 0) {
        this.issues.push({
          severity: "error",
          category: "electrical",
          message: `Battery "${battery.name}" is not fully connected`,
          componentIds: [battery.id],
          suggestion: "Connect both positive and negative terminals",
        });
      }
    });
  }

  private validateMPPTSolarConnections(): void {
    const mppts = this.components.filter(c => c.type === "mppt");

    mppts.forEach(mppt => {
      // Check if MPPT has PV input connections (pv-positive or pv-negative terminals)
      const hasPVPositive = this.wires.some(
        w => (w.fromComponentId === mppt.id && w.fromTerminal === "pv-positive") ||
             (w.toComponentId === mppt.id && w.toTerminal === "pv-positive")
      );
      const hasPVNegative = this.wires.some(
        w => (w.fromComponentId === mppt.id && w.fromTerminal === "pv-negative") ||
             (w.toComponentId === mppt.id && w.toTerminal === "pv-negative")
      );

      // Check if connected to a solar panel (checking both terminal connections and component types)
      const connectedToSolar = this.wires.some(w => {
        const fromComp = this.components.find(c => c.id === w.fromComponentId);
        const toComp = this.components.find(c => c.id === w.toComponentId);
        
        // Solar panel to MPPT: solar "positive"/"negative" terminals to MPPT "pv-positive"/"pv-negative"
        if (fromComp?.type === "solar-panel" && toComp?.id === mppt.id) {
          return (w.fromTerminal === "positive" && w.toTerminal === "pv-positive") ||
                 (w.fromTerminal === "negative" && w.toTerminal === "pv-negative");
        }
        // MPPT to Solar panel: MPPT "pv-positive"/"pv-negative" to solar "positive"/"negative"
        if (toComp?.type === "solar-panel" && fromComp?.id === mppt.id) {
          return (w.fromTerminal === "pv-positive" && w.toTerminal === "positive") ||
                 (w.fromTerminal === "pv-negative" && w.toTerminal === "negative");
        }
        return false;
      });

      if (!hasPVPositive || !hasPVNegative || !connectedToSolar) {
        this.issues.push({
          severity: "error",
          category: "electrical",
          message: `MPPT "${mppt.name}" is missing solar panel connection`,
          componentIds: [mppt.id],
          suggestion: "Connect solar panel(s) to MPPT PV input terminals (solar panel 'positive' to MPPT 'pv-positive', solar panel 'negative' to MPPT 'pv-negative')",
        });
      }
    });
  }

  private validateDCACMingling(): void {
    // Check that DC and AC loads aren't mixed on same bus bar or circuit
    // (already covered in validateBusBarPolarity, but this is more general)
    const acComponents = this.components.filter(c => c.type === "ac-load" || c.type === "multiplus");
    const dcComponents = this.components.filter(c => c.type === "dc-load" || c.type === "battery");

    // This is more of an informational check
    if (acComponents.length > 0 && dcComponents.length > 0) {
      const hasSeparateBusses = this.components.some(c => c.name?.toLowerCase().includes("ac")) &&
                                this.components.some(c => c.name?.toLowerCase().includes("dc"));

      if (!hasSeparateBusses && this.components.some(c => c.type?.includes("busbar"))) {
        this.issues.push({
          severity: "info",
          category: "electrical",
          message: "System has both AC and DC components - ensure proper separation",
          suggestion: "Use clearly labeled bus bars: 'DC Positive Bus', 'DC Negative Bus', 'AC Positive Bus', 'AC Negative Bus'",
        });
      }
    }
  }

  private validateVoltageMismatches(): void {
    // Get system voltage (from battery or systemVoltage parameter)
    const battery = this.components.find(c => c.type === "battery");
    const batteryVoltage = battery?.properties?.voltage as number | undefined;
    const systemVoltage = batteryVoltage || this.systemVoltage;

    if (!systemVoltage) return; // Can't validate without a reference voltage

    const mismatchedComponents: string[] = [];

    // Check all components that have voltage properties
    this.components.forEach(comp => {
      const compVoltage = comp.properties?.voltage as number | undefined;
      
      // Skip components that don't have voltage or are the battery itself
      if (!compVoltage || comp.type === "battery") return;

      // Check if voltage matches system voltage
      if (compVoltage !== systemVoltage) {
        mismatchedComponents.push(comp.id);
      }
    });

    if (mismatchedComponents.length > 0) {
      const componentNames = mismatchedComponents.map(id => this.getComponentName(id)).join(", ");
      this.issues.push({
        severity: "error",
        category: "electrical",
        message: `${mismatchedComponents.length} component(s) have voltage mismatch: ${componentNames}`,
        componentIds: mismatchedComponents,
        suggestion: `All components should match system voltage (${systemVoltage}V). Update component properties to ${systemVoltage}V or adjust system voltage.`,
      });
    }

    // Also check for components connected via wires that have mismatched voltages
    this.wires.forEach(wire => {
      const fromComp = this.components.find(c => c.id === wire.fromComponentId);
      const toComp = this.components.find(c => c.id === wire.toComponentId);

      if (!fromComp || !toComp) return;

      const fromVoltage = fromComp.properties?.voltage as number | undefined;
      const toVoltage = toComp.properties?.voltage as number | undefined;

      // Skip if either component doesn't have voltage specified
      if (!fromVoltage || !toVoltage) return;

      // Skip if both match system voltage (already checked above)
      if (fromVoltage === systemVoltage && toVoltage === systemVoltage) return;

      // Check if connected components have different voltages
      if (fromVoltage !== toVoltage) {
        this.issues.push({
          severity: "error",
          category: "electrical",
          message: `Voltage mismatch: ${this.getComponentName(fromComp.id)} (${fromVoltage}V) connected to ${this.getComponentName(toComp.id)} (${toVoltage}V)`,
          componentIds: [fromComp.id, toComp.id],
          wireId: wire.id,
          suggestion: `Components must have matching voltages. Update one or both components to ${systemVoltage}V.`,
        });
      }
    });
  }

  /**
   * Validate wire sizing against ABYC/NEC standards
   */
  private validateWireSizing(): void {
    // Import wire data for validation
    const WIRE_DATA: Record<string, { maxCurrent: number; resistance: number }> = {
      "18 AWG": { maxCurrent: 14, resistance: 6.385 },
      "16 AWG": { maxCurrent: 18, resistance: 4.016 },
      "14 AWG": { maxCurrent: 20, resistance: 2.525 },
      "12 AWG": { maxCurrent: 25, resistance: 1.588 },
      "10 AWG": { maxCurrent: 35, resistance: 0.9989 },
      "8 AWG": { maxCurrent: 50, resistance: 0.6282 },
      "6 AWG": { maxCurrent: 65, resistance: 0.3951 },
      "4 AWG": { maxCurrent: 85, resistance: 0.2485 },
      "2 AWG": { maxCurrent: 115, resistance: 0.1563 },
      "1 AWG": { maxCurrent: 130, resistance: 0.1240 },
      "1/0 AWG": { maxCurrent: 150, resistance: 0.0983 },
      "2/0 AWG": { maxCurrent: 175, resistance: 0.0779 },
      "3/0 AWG": { maxCurrent: 200, resistance: 0.0618 },
      "4/0 AWG": { maxCurrent: 230, resistance: 0.0490 },
    };

    this.wires.forEach(wire => {
      if (!wire.gauge) {
        this.issues.push({
          severity: "error",
          category: "wire-sizing",
          message: `Wire from ${this.getComponentName(wire.fromComponentId)} to ${this.getComponentName(wire.toComponentId)} has no gauge specified`,
          wireId: wire.id,
          suggestion: "Specify wire gauge based on current and length",
        });
        return;
      }

      // Normalize gauge format - remove duplicate " AWG" suffixes and normalize
      let normalizedGaugeForLookup = wire.gauge.trim();
      // Remove trailing " AWG" if present (handle cases like "1/0 AWG AWG")
      normalizedGaugeForLookup = normalizedGaugeForLookup.replace(/\s+AWG\s*AWG\s*$/i, " AWG");
      // Ensure it ends with " AWG" for lookup
      if (!normalizedGaugeForLookup.endsWith(" AWG")) {
        normalizedGaugeForLookup = normalizedGaugeForLookup + " AWG";
      }
      
      const wireData = WIRE_DATA[normalizedGaugeForLookup];
      if (!wireData) {
        this.issues.push({
          severity: "warning",
          category: "wire-sizing",
          message: `Wire has unknown gauge: ${wire.gauge}`,
          wireId: wire.id,
          suggestion: `Normalized to: ${normalizedGaugeForLookup}. Please use standard gauge format (e.g., "10 AWG", "1/0 AWG").`,
        });
        return;
      }

      // Calculate current from connected components if not set
      let current = wire.current || 0;
      
      // If current not set, calculate from connected load
      if (current === 0) {
        const fromComp = this.components.find(c => c.id === wire.fromComponentId);
        const toComp = this.components.find(c => c.id === wire.toComponentId);
        
        // Calculate current from load watts
        if (toComp && (toComp.type === "dc-load" || toComp.type === "ac-load")) {
          const loadWatts = (toComp.properties?.watts || toComp.properties?.power || 0) as number;
          const loadVoltage = (toComp.properties?.voltage as number || this.systemVoltage);
          if (loadWatts > 0 && loadVoltage > 0) {
            current = loadWatts / loadVoltage;
          }
        } else if (fromComp && (fromComp.type === "dc-load" || fromComp.type === "ac-load")) {
          const loadWatts = (fromComp.properties?.watts || fromComp.properties?.power || 0) as number;
          const loadVoltage = (fromComp.properties?.voltage as number || this.systemVoltage);
          if (loadWatts > 0 && loadVoltage > 0) {
            current = loadWatts / loadVoltage;
          }
        } else if (fromComp?.properties?.current) {
          current = fromComp.properties.current as number;
        } else if (toComp?.properties?.current) {
          current = toComp.properties.current as number;
        } else if (fromComp?.properties?.amps) {
          current = fromComp.properties.amps as number;
        } else if (toComp?.properties?.amps) {
          current = toComp.properties.amps as number;
        }
      }

      // Check ampacity using proper temperature-adjusted calculations
      if (current > 0) {
        // Normalize gauge format (remove " AWG" suffix if present)
        const normalizedGauge = wire.gauge.replace(/ AWG$/i, '').replace(/\\0/g, '/0');
        const maxAmpacity = getWireAmpacity(normalizedGauge, "75C", 30, 1.0);

        if (maxAmpacity === 0) {
          this.issues.push({
            severity: "warning",
            category: "wire-sizing",
            message: `Wire has unknown gauge: ${wire.gauge}`,
            wireId: wire.id,
          });
        } else if (current > maxAmpacity) {
          this.issues.push({
            severity: "error",
            category: "wire-sizing",
            message: `Wire gauge ${wire.gauge} insufficient for ${current.toFixed(1)}A (max ${maxAmpacity.toFixed(1)}A at 75°C)`,
            wireId: wire.id,
            componentIds: [wire.fromComponentId, wire.toComponentId],
            suggestion: `Use larger gauge wire (e.g., ${this.suggestWireGauge(current)})`,
          });
        } else if (current > maxAmpacity * 0.8) {
          // Warning if wire is above 80% of capacity
          this.issues.push({
            severity: "warning",
            category: "wire-sizing",
            message: `Wire gauge ${wire.gauge} running at ${((current / maxAmpacity) * 100).toFixed(0)}% capacity (${current.toFixed(1)}A of ${maxAmpacity.toFixed(1)}A max)`,
            wireId: wire.id,
            componentIds: [wire.fromComponentId, wire.toComponentId],
            suggestion: `Consider using larger gauge for better safety margin`,
          });
        }
      } else {
        // Warn if we can't determine current
        this.issues.push({
          severity: "warning",
          category: "wire-sizing",
          message: `Cannot determine current for wire - gauge validation skipped`,
          wireId: wire.id,
          suggestion: `Set load properties (watts/amps) or wire current for accurate gauge validation`,
        });
      }

      // Check voltage drop (voltage drop calculations are separate from ampacity)
      const length = wire.length || 0;
      if (length > 0 && current > 0) {
        // Use component voltage if available, otherwise system voltage
        let voltage = this.systemVoltage;
        const fromComp = this.components.find(c => c.id === wire.fromComponentId);
        const toComp = this.components.find(c => c.id === wire.toComponentId);
        if (fromComp?.properties?.voltage) {
          voltage = fromComp.properties.voltage as number;
        } else if (toComp?.properties?.voltage) {
          voltage = toComp.properties.voltage as number;
        }
        
        const resistancePerFoot = wireData.resistance / 1000;
        const voltageDrop = 2 * current * resistancePerFoot * length; // 2 for round trip
        const voltageDropPercent = (voltageDrop / voltage) * 100;

        if (voltageDropPercent > 3) {
          this.issues.push({
            severity: "error",
            category: "wire-sizing",
            message: `Excessive voltage drop: ${voltageDropPercent.toFixed(1)}% (max 3% per ABYC)`,
            wireId: wire.id,
            componentIds: [wire.fromComponentId, wire.toComponentId],
            suggestion: `Use larger gauge wire (e.g., ${this.suggestWireGaugeForVoltageDrop(current, length)}) or shorten run (current: ${length}ft)`,
          });
        } else if (voltageDropPercent > 2.5) {
          this.issues.push({
            severity: "warning",
            category: "wire-sizing",
            message: `High voltage drop: ${voltageDropPercent.toFixed(1)}%`,
            wireId: wire.id,
            componentIds: [wire.fromComponentId, wire.toComponentId],
            suggestion: `Consider larger gauge (e.g., ${this.suggestWireGaugeForVoltageDrop(current, length)}) to reduce losses`,
          });
        }
      }
    });
  }

  private suggestWireGauge(current: number): string {
    if (current <= 25) return "10 AWG";
    if (current <= 40) return "8 AWG";
    if (current <= 60) return "6 AWG";
    if (current <= 100) return "4 AWG";
    if (current <= 150) return "2 AWG";
    if (current <= 200) return "1 AWG";
    if (current <= 250) return "1/0 AWG";
    if (current <= 300) return "2/0 AWG";
    if (current <= 350) return "3/0 AWG";
    return "4/0 AWG or larger";
  }

  private suggestWireGaugeForVoltageDrop(current: number, length: number): string {
    // Calculate required gauge based on voltage drop (3% max)
    const maxVDropVolts = (this.systemVoltage * 3) / 100;
    
    // Try gauges from smallest to largest until we find one that works
    const gauges = ["10", "8", "6", "4", "2", "1", "1/0", "2/0", "3/0", "4/0"];
    const WIRE_RESISTANCE: Record<string, number> = {
      "10": 0.9989,
      "8": 0.6282,
      "6": 0.3951,
      "4": 0.2485,
      "2": 0.1563,
      "1": 0.1240,
      "1/0": 0.0983,
      "2/0": 0.0779,
      "3/0": 0.0618,
      "4/0": 0.0490,
    };

    for (const gauge of gauges) {
      const resistancePerFoot = (WIRE_RESISTANCE[gauge] || 0.9989) / 1000;
      const vDrop = 2 * current * resistancePerFoot * length;
      if (vDrop <= maxVDropVolts) {
        return `${gauge} AWG`;
      }
    }
    
    // If none work, suggest based on current
    return this.suggestWireGauge(current);
  }

  /**
   * Validate layout quality (spacing, overlap)
   */
  private validateLayout(): void {
    // Check for overlapping components
    for (let i = 0; i < this.components.length; i++) {
      for (let j = i + 1; j < this.components.length; j++) {
        const comp1 = this.components[i];
        const comp2 = this.components[j];

        if (this.componentsOverlap(comp1, comp2)) {
          this.issues.push({
            severity: "error",
            category: "layout",
            message: `Components "${comp1.name}" and "${comp2.name}" overlap`,
            componentIds: [comp1.id, comp2.id],
            suggestion: "Move components apart by at least 50px",
          });
        } else if (this.componentsTooClose(comp1, comp2)) {
          this.issues.push({
            severity: "warning",
            category: "layout",
            message: `Components "${comp1.name}" and "${comp2.name}" are very close`,
            componentIds: [comp1.id, comp2.id],
            suggestion: "Increase spacing for better readability",
          });
        }
      }
    }

    // Check canvas boundaries
    this.components.forEach(comp => {
      const config = TERMINAL_CONFIGS[comp.type];
      if (config) {
        if (comp.x < 50 || comp.y < 50) {
          this.issues.push({
            severity: "warning",
            category: "layout",
            message: `Component "${comp.name}" too close to canvas edge`,
            componentIds: [comp.id],
            suggestion: "Move component at least 50px from edges",
          });
        }

        if (comp.x + config.width > 1950 || comp.y + config.height > 1450) {
          this.issues.push({
            severity: "warning",
            category: "layout",
            message: `Component "${comp.name}" near or beyond canvas boundary`,
            componentIds: [comp.id],
            suggestion: "Keep components within 2000×1500px canvas",
          });
        }
      }
    });
  }

  private componentsOverlap(comp1: SchematicComponent, comp2: SchematicComponent): boolean {
    const config1 = TERMINAL_CONFIGS[comp1.type];
    const config2 = TERMINAL_CONFIGS[comp2.type];

    if (!config1 || !config2) return false;

    const rect1 = {
      left: comp1.x,
      right: comp1.x + config1.width,
      top: comp1.y,
      bottom: comp1.y + config1.height,
    };

    const rect2 = {
      left: comp2.x,
      right: comp2.x + config2.width,
      top: comp2.y,
      bottom: comp2.y + config2.height,
    };

    return !(rect1.right < rect2.left ||
             rect1.left > rect2.right ||
             rect1.bottom < rect2.top ||
             rect1.top > rect2.bottom);
  }

  private componentsTooClose(comp1: SchematicComponent, comp2: SchematicComponent): boolean {
    const distance = Math.sqrt(
      Math.pow(comp2.x - comp1.x, 2) + Math.pow(comp2.y - comp1.y, 2)
    );
    return distance < 150 && !this.componentsOverlap(comp1, comp2);
  }

  /**
   * Validate terminal connections
   */
  private validateTerminalConnections(): void {
    this.wires.forEach(wire => {
      const fromComp = this.components.find(c => c.id === wire.fromComponentId);
      const toComp = this.components.find(c => c.id === wire.toComponentId);

      if (!fromComp || !toComp) {
        this.issues.push({
          severity: "error",
          category: "terminal",
          message: "Wire connects to non-existent component",
          wireId: wire.id,
          suggestion: "Remove invalid wire or fix component references",
        });
        return;
      }

      // Check if terminals exist
      const fromConfig = TERMINAL_CONFIGS[fromComp.type];
      const toConfig = TERMINAL_CONFIGS[toComp.type];

      if (fromConfig) {
        const fromTerminal = fromConfig.terminals.find(t => t.id === wire.fromTerminal);
        if (!fromTerminal) {
          this.issues.push({
            severity: "error",
            category: "terminal",
            message: `Invalid terminal "${wire.fromTerminal}" on ${fromComp.type}`,
            wireId: wire.id,
            componentIds: [fromComp.id],
            suggestion: `Valid terminals: ${fromConfig.terminals.map(t => t.id).join(", ")}`,
          });
        }
      }

      if (toConfig) {
        const toTerminal = toConfig.terminals.find(t => t.id === wire.toTerminal);
        if (!toTerminal) {
          this.issues.push({
            severity: "error",
            category: "terminal",
            message: `Invalid terminal "${wire.toTerminal}" on ${toComp.type}`,
            wireId: wire.id,
            componentIds: [toComp.id],
            suggestion: `Valid terminals: ${toConfig.terminals.map(t => t.id).join(", ")}`,
          });
        }
      }
    });

    // Check for missing required connections
    this.components.forEach(comp => {
      const config = TERMINAL_CONFIGS[comp.type];
      if (!config) return;

      // Define required terminal types for each component category
      const requiresBothPowerTerminals = [
        'battery', 'dc-load', 'solar-panel'
      ];

      if (requiresBothPowerTerminals.includes(comp.type)) {
        // These components MUST have both positive and negative connections
        const positiveTerminals = config.terminals.filter(t =>
          t.type === 'positive' || t.id.includes('positive') || t.id === 'pos'
        );
        const negativeTerminals = config.terminals.filter(t =>
          t.type === 'negative' || t.id.includes('negative') || t.id === 'neg'
        );

        // Check if positive terminals are connected
        const hasPositiveConnection = this.wires.some(w =>
          (w.fromComponentId === comp.id && positiveTerminals.some(t => t.id === w.fromTerminal)) ||
          (w.toComponentId === comp.id && positiveTerminals.some(t => t.id === w.toTerminal))
        );

        // Check if negative terminals are connected
        const hasNegativeConnection = this.wires.some(w =>
          (w.fromComponentId === comp.id && negativeTerminals.some(t => t.id === w.fromTerminal)) ||
          (w.toComponentId === comp.id && negativeTerminals.some(t => t.id === w.toTerminal))
        );

        if (!hasPositiveConnection) {
          this.issues.push({
            severity: "error",
            category: "terminal",
            message: `${comp.type} "${comp.name}" is missing positive (+) connection`,
            componentIds: [comp.id],
            suggestion: `Connect positive terminal to power source or bus bar. Valid terminals: ${positiveTerminals.map(t => t.id).join(", ")}`,
          });
        }

        if (!hasNegativeConnection) {
          this.issues.push({
            severity: "error",
            category: "terminal",
            message: `${comp.type} "${comp.name}" is missing negative (-) connection`,
            componentIds: [comp.id],
            suggestion: `Connect negative terminal to ground or negative bus bar. Valid terminals: ${negativeTerminals.map(t => t.id).join(", ")}`,
          });
        }
      }

      // AC loads require hot, neutral, and ground connections
      if (comp.type === 'ac-load') {
        const hotTerminals = config.terminals.filter(t => t.id === 'hot');
        const neutralTerminals = config.terminals.filter(t => t.id === 'neutral');
        const groundTerminals = config.terminals.filter(t => t.id === 'ground');

        const hasHotConnection = this.wires.some(w =>
          (w.fromComponentId === comp.id && hotTerminals.some(t => t.id === w.fromTerminal)) ||
          (w.toComponentId === comp.id && hotTerminals.some(t => t.id === w.toTerminal))
        );

        const hasNeutralConnection = this.wires.some(w =>
          (w.fromComponentId === comp.id && neutralTerminals.some(t => t.id === w.fromTerminal)) ||
          (w.toComponentId === comp.id && neutralTerminals.some(t => t.id === w.toTerminal))
        );

        const hasGroundConnection = this.wires.some(w =>
          (w.fromComponentId === comp.id && groundTerminals.some(t => t.id === w.fromTerminal)) ||
          (w.toComponentId === comp.id && groundTerminals.some(t => t.id === w.toTerminal))
        );

        if (!hasHotConnection) {
          this.issues.push({
            severity: "error",
            category: "terminal",
            message: `${comp.type} "${comp.name}" is missing hot (L) connection`,
            componentIds: [comp.id],
            suggestion: `Connect hot terminal to AC source. Valid terminals: hot`,
          });
        }

        if (!hasNeutralConnection) {
          this.issues.push({
            severity: "error",
            category: "terminal",
            message: `${comp.type} "${comp.name}" is missing neutral (N) connection`,
            componentIds: [comp.id],
            suggestion: `Connect neutral terminal to AC source. Valid terminals: neutral`,
          });
        }

        if (!hasGroundConnection) {
          this.issues.push({
            severity: "error",
            category: "terminal",
            message: `${comp.type} "${comp.name}" is missing ground (G) connection`,
            componentIds: [comp.id],
            suggestion: `Connect ground terminal to AC source. Valid terminals: ground`,
          });
        }
      }
    });
  }

  /**
   * Validate AI-specific quality metrics
   */
  private validateAIQuality(): void {
    // Check for reasonable component count
    if (this.components.length === 0) {
      this.issues.push({
        severity: "error",
        category: "ai-quality",
        message: "No components in design",
        suggestion: "Add components to create a functional system",
      });
    } else if (this.components.length > 30) {
      this.issues.push({
        severity: "warning",
        category: "ai-quality",
        message: "Very complex design with many components",
        suggestion: "Consider breaking into multiple subsystems",
      });
    }

    // Check for missing or invalid properties on loads - flag EACH load separately for stronger penalty
    this.components.forEach(c => {
      if (c.type === "dc-load" || c.type === "ac-load") {
        const props = c.properties as Record<string, unknown> | undefined;
        const watts = props?.watts as number | undefined;
        const amps = props?.amps as number | undefined;
        const hasValidWatts = typeof watts === 'number' && watts > 0;
        const hasValidAmps = typeof amps === 'number' && amps > 0;
        
        if (!hasValidWatts && !hasValidAmps) {
          const loadType = c.type === "dc-load" ? "DC" : "AC";
          const examples = c.type === "dc-load" 
            ? "LED Lights: 30W, Refrigerator: 100W, Water Pump: 60W"
            : "Microwave: 1200W, Coffee Maker: 1000W, AC Outlets: 1500W";
          this.issues.push({
            severity: "error",
            category: "ai-quality",
            message: `${loadType} load "${c.name}" missing required "properties" with watts value`,
            componentIds: [c.id],
            suggestion: `Add properties: {"watts": <realistic value>}. Examples: ${examples}`,
          });
        }
      }
    });

    // Check for batteries without capacity
    const batteriesWithoutCapacity = this.components.filter(c => {
      if (c.type === "battery") {
        const props = c.properties as Record<string, unknown> | undefined;
        if (!props) return true;
        const capacity = props.capacity as number | undefined;
        return typeof capacity !== 'number' || capacity <= 0;
      }
      return false;
    });

    if (batteriesWithoutCapacity.length > 0) {
      this.issues.push({
        severity: "warning",
        category: "ai-quality",
        message: `${batteriesWithoutCapacity.length} battery(ies) missing capacity property`,
        componentIds: batteriesWithoutCapacity.map(c => c.id),
        suggestion: 'Add properties: {"voltage": 12, "capacity": 400} to batteries',
      });
    }

    // Check for solar panels without watts
    const solarsWithoutWatts = this.components.filter(c => {
      if (c.type === "solar-panel") {
        const props = c.properties as Record<string, unknown> | undefined;
        if (!props) return true;
        const watts = props.watts as number | undefined;
        return typeof watts !== 'number' || watts <= 0;
      }
      return false;
    });

    if (solarsWithoutWatts.length > 0) {
      this.issues.push({
        severity: "warning",
        category: "ai-quality",
        message: `${solarsWithoutWatts.length} solar panel(s) missing watts property`,
        componentIds: solarsWithoutWatts.map(c => c.id),
        suggestion: 'Add properties: {"watts": 300} to solar panels',
      });
    }

    // Check for orphaned components (no wires)
    const connectedComponents = new Set<string>();
    this.wires.forEach(wire => {
      connectedComponents.add(wire.fromComponentId);
      connectedComponents.add(wire.toComponentId);
    });

    const orphanedComps = this.components.filter(c => !connectedComponents.has(c.id));
    if (orphanedComps.length > 0) {
      this.issues.push({
        severity: "warning",
        category: "ai-quality",
        message: `${orphanedComps.length} component(s) not connected to any wires`,
        componentIds: orphanedComps.map(c => c.id),
        suggestion: "Wire all components or remove unused ones",
      });
    }

    // Check for reasonable wire count
    const expectedWireCount = this.components.length * 1.5; // Rough heuristic
    if (this.wires.length < this.components.length) {
      this.issues.push({
        severity: "warning",
        category: "ai-quality",
        message: "Fewer wires than components - design may be incomplete",
        suggestion: "Ensure all components are properly wired",
      });
    }
  }

  /**
   * Validate power capacity limits
   */
  private validatePowerCapacity(): void {
    // Get system voltage
    const battery = this.components.find(c => c.type === "battery");
    const batteryVoltage = battery?.properties?.voltage as number | undefined;
    const systemVoltage = batteryVoltage || this.systemVoltage;

    // Calculate total loads
    let totalDCLoads = 0;
    let totalACLoads = 0;
    let totalSolarWatts = 0;

    this.components.forEach(comp => {
      const watts = (comp.properties?.watts || comp.properties?.power || 0) as number;
      
      if (comp.type === "dc-load") {
        totalDCLoads += watts;
      } else if (comp.type === "ac-load") {
        totalACLoads += watts;
      } else if (comp.type === "solar-panel") {
        totalSolarWatts += watts;
      }
    });

    // Check DC loads vs battery capacity
    if (battery && systemVoltage) {
      const batteryCapacity = (battery.properties?.capacity as number || 0);
      const batteryWh = batteryCapacity * systemVoltage;
      
      // Calculate peak DC load current
      const peakDCCurrent = totalDCLoads / systemVoltage;
      
      // Check if loads exceed battery capacity (assuming 50% depth of discharge)
      const usableCapacity = batteryWh * 0.5; // 50% DOD for safety
      const loadEnergyPerHour = totalDCLoads; // watts = watt-hours per hour
      const hoursAtFullLoad = usableCapacity / loadEnergyPerHour;
      
      if (loadEnergyPerHour > 0 && hoursAtFullLoad < 1) {
        this.issues.push({
          severity: "error",
          category: "electrical",
          message: `DC loads (${totalDCLoads}W) exceed usable battery capacity (${usableCapacity.toFixed(0)}Wh usable from ${batteryWh.toFixed(0)}Wh total)`,
          componentIds: this.components.filter(c => c.type === "dc-load").map(c => c.id),
          suggestion: `Reduce DC loads or increase battery capacity. Current battery provides ${hoursAtFullLoad.toFixed(1)} hours at full load.`,
        });
      } else if (hoursAtFullLoad < 4) {
        this.issues.push({
          severity: "warning",
          category: "electrical",
          message: `DC loads (${totalDCLoads}W) will drain battery quickly (${hoursAtFullLoad.toFixed(1)} hours at full load)`,
          componentIds: this.components.filter(c => c.type === "dc-load").map(c => c.id),
          suggestion: `Consider increasing battery capacity or reducing loads for longer runtime.`,
        });
      }
    }

    // Check AC loads vs inverter capacity
    const inverters = this.components.filter(c => c.type === "inverter" || c.type === "multiplus" || c.type === "phoenix-inverter");
    
    if (inverters.length > 0 && totalACLoads > 0) {
      const totalInverterCapacity = inverters.reduce((sum, inv) => {
        const watts = (inv.properties?.watts || inv.properties?.powerRating || inv.properties?.power || 0) as number;
        return sum + watts;
      }, 0);

      if (totalACLoads > totalInverterCapacity) {
        this.issues.push({
          severity: "error",
          category: "electrical",
          message: `AC loads (${totalACLoads}W) exceed inverter capacity (${totalInverterCapacity}W)`,
          componentIds: [
            ...this.components.filter(c => c.type === "ac-load").map(c => c.id),
            ...inverters.map(c => c.id)
          ],
          suggestion: `Reduce AC loads or add/increase inverter capacity. Need ${totalACLoads}W, have ${totalInverterCapacity}W.`,
        });
      } else if (totalACLoads > totalInverterCapacity * 0.8) {
        this.issues.push({
          severity: "warning",
          category: "electrical",
          message: `AC loads (${totalACLoads}W) are ${((totalACLoads / totalInverterCapacity) * 100).toFixed(0)}% of inverter capacity`,
          componentIds: this.components.filter(c => c.type === "ac-load").map(c => c.id),
          suggestion: `Consider larger inverter for safety margin or reduce peak loads.`,
        });
      }
    } else if (totalACLoads > 0 && inverters.length === 0) {
      this.issues.push({
        severity: "error",
        category: "electrical",
        message: `AC loads (${totalACLoads}W) present but no inverter found`,
        componentIds: this.components.filter(c => c.type === "ac-load").map(c => c.id),
        suggestion: `Add an inverter to power AC loads.`,
      });
    }

    // Check solar panel output vs charging needs
    if (battery && systemVoltage && totalSolarWatts > 0) {
      const batteryCapacity = (battery.properties?.capacity as number || 0);
      const batteryAh = batteryCapacity;
      
      // Estimate charging current needed (assume 0.2C charge rate for lithium, 0.1C for lead-acid)
      const batteryType = (battery.properties?.batteryType as string || "").toLowerCase();
      const chargeRate = batteryType.includes("lifepo4") || batteryType.includes("lithium") ? 0.2 : 0.1;
      const recommendedChargeCurrent = batteryAh * chargeRate;
      const recommendedSolarWatts = recommendedChargeCurrent * systemVoltage;
      
      // Check if solar is sufficient for charging
      if (totalSolarWatts < recommendedSolarWatts * 0.5) {
        this.issues.push({
          severity: "warning",
          category: "electrical",
          message: `Solar panel output (${totalSolarWatts}W) may be insufficient for battery charging`,
          componentIds: this.components.filter(c => c.type === "solar-panel").map(c => c.id),
          suggestion: `Recommended: ${recommendedSolarWatts.toFixed(0)}W solar for ${batteryAh}Ah battery. Current: ${totalSolarWatts}W.`,
        });
      }
    }

  }

  /**
   * Calculate design metrics
   */
  private calculateMetrics(): DesignMetrics {
    const metrics: DesignMetrics = {
      componentCount: this.components.length,
      wireCount: this.wires.length,
      avgComponentSpacing: this.calculateAvgSpacing(),
      overlappingComponents: this.countOverlaps(),
      invalidTerminalConnections: this.issues.filter(i => i.category === "terminal").length,
      wireGaugeIssues: this.issues.filter(i => i.category === "wire-sizing").length,
      electricalRuleViolations: this.issues.filter(i => i.category === "electrical" && i.severity === "error").length,
      layoutEfficiency: this.calculateLayoutEfficiency(),
    };

    return metrics;
  }

  private calculateAvgSpacing(): number {
    if (this.components.length < 2) return 0;

    let totalDistance = 0;
    let count = 0;

    for (let i = 0; i < this.components.length; i++) {
      for (let j = i + 1; j < this.components.length; j++) {
        const comp1 = this.components[i];
        const comp2 = this.components[j];
        const distance = Math.sqrt(
          Math.pow(comp2.x - comp1.x, 2) + Math.pow(comp2.y - comp1.y, 2)
        );
        totalDistance += distance;
        count++;
      }
    }

    return count > 0 ? totalDistance / count : 0;
  }

  private countOverlaps(): number {
    let overlaps = 0;
    for (let i = 0; i < this.components.length; i++) {
      for (let j = i + 1; j < this.components.length; j++) {
        if (this.componentsOverlap(this.components[i], this.components[j])) {
          overlaps++;
        }
      }
    }
    return overlaps;
  }

  private calculateLayoutEfficiency(): number {
    // Higher score = better layout (compact but not overlapping, good spacing)
    let score = 100;

    // Penalize overlaps heavily
    score -= this.countOverlaps() * 20;

    // Penalize components too close to edges
    const nearEdge = this.components.filter(c => c.x < 50 || c.y < 50).length;
    score -= nearEdge * 5;

    // Reward good spacing (200-400px is ideal)
    const avgSpacing = this.calculateAvgSpacing();
    if (avgSpacing < 150) score -= 20; // Too close
    if (avgSpacing > 500) score -= 10; // Too far apart

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate overall quality score (0-100)
   */
  private calculateQualityScore(metrics: DesignMetrics): number {
    let score = 100;

    // Deduct points for issues
    this.issues.forEach(issue => {
      if (issue.severity === "error") score -= 10;
      if (issue.severity === "warning") score -= 3;
      if (issue.severity === "info") score -= 1;
    });

    // Deduct for metrics
    score -= metrics.overlappingComponents * 15;
    score -= metrics.invalidTerminalConnections * 10;
    score -= metrics.wireGaugeIssues * 5;
    score -= metrics.electricalRuleViolations * 20;

    // Bonus for good layout efficiency
    score += (metrics.layoutEfficiency - 50) * 0.3;

    return Math.max(0, Math.min(100, score));
  }

  private getComponentName(id: string): string {
    const comp = this.components.find(c => c.id === id);
    return comp ? comp.name : id;
  }
}

/**
 * Convenience function to validate a design
 */
export function validateDesign(
  components: SchematicComponent[],
  wires: Wire[],
  systemVoltage: number = 12
): ValidationResult {
  const validator = new DesignValidator(components, wires, systemVoltage);
  return validator.validate();
}
