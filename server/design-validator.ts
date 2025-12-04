import type { SchematicComponent, Wire } from "@shared/schema";
import { TERMINAL_CONFIGS } from "../client/src/lib/terminal-config";

export interface ValidationIssue {
  severity: "error" | "warning" | "info";
  category: "electrical" | "wire-sizing" | "layout" | "terminal" | "ai-quality";
  message: string;
  componentIds?: string[];
  wireId?: string;
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

      const wireData = WIRE_DATA[wire.gauge];
      if (!wireData) {
        this.issues.push({
          severity: "warning",
          category: "wire-sizing",
          message: `Wire has unknown gauge: ${wire.gauge}`,
          wireId: wire.id,
        });
        return;
      }

      // Check ampacity
      const current = wire.current || 0;
      if (current > wireData.maxCurrent) {
        this.issues.push({
          severity: "error",
          category: "wire-sizing",
          message: `Wire gauge ${wire.gauge} insufficient for ${current}A (max ${wireData.maxCurrent}A)`,
          wireId: wire.id,
          suggestion: `Use larger gauge wire (e.g., ${this.suggestWireGauge(current)})`,
        });
      } else if (current > wireData.maxCurrent * 0.9) {
        this.issues.push({
          severity: "warning",
          category: "wire-sizing",
          message: `Wire gauge ${wire.gauge} near capacity at ${current}A (max ${wireData.maxCurrent}A)`,
          wireId: wire.id,
          suggestion: "Consider larger gauge for safety margin",
        });
      }

      // Check voltage drop
      const length = wire.length || 0;
      const resistancePerFoot = wireData.resistance / 1000;
      const voltageDrop = 2 * current * resistancePerFoot * length; // 2 for round trip
      const voltageDropPercent = (voltageDrop / this.systemVoltage) * 100;

      if (voltageDropPercent > 3) {
        this.issues.push({
          severity: "error",
          category: "wire-sizing",
          message: `Excessive voltage drop: ${voltageDropPercent.toFixed(1)}% (max 3% per ABYC)`,
          wireId: wire.id,
          suggestion: `Use larger gauge wire or shorten run (current: ${length}ft)`,
        });
      } else if (voltageDropPercent > 2.5) {
        this.issues.push({
          severity: "warning",
          category: "wire-sizing",
          message: `High voltage drop: ${voltageDropPercent.toFixed(1)}%`,
          wireId: wire.id,
          suggestion: "Consider larger gauge to reduce losses",
        });
      }
    });
  }

  private suggestWireGauge(current: number): string {
    if (current <= 25) return "10 AWG";
    if (current <= 40) return "8 AWG";
    if (current <= 60) return "6 AWG";
    if (current <= 100) return "4 AWG";
    if (current <= 150) return "2 AWG";
    return "1/0 AWG or larger";
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
