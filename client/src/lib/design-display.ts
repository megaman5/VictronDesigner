import type { SchematicComponent, Wire, WireCalculation } from '@shared/schema';
import { formatWireGauge, formatWireLength, type WireGaugeFormat, type LengthUnit } from './wire-calculator';

export function componentLoadLabel(type: string, properties: SchematicComponent['properties']) {
     if (!properties) return null;
     if (type === 'ac-load' || type === 'dc-load') {
        return `${properties.watts || properties.power || 0}W`;
     }
     if (type === 'inverter' || type === 'phoenix-inverter' || type === 'multiplus' || type === 'quattro') {
        return `${properties.watts || 3000}W`;
     }
     if (type === 'mppt') {
        return `${properties.maxCurrent || properties.amps || 0}A`;
     }
     if (type === 'alternator' || type === 'blue-smart-charger' || type === 'orion-dc-dc') {
         return `${properties.amps || properties.current || 0}A`;
     }
     if (type === 'solar-panel') {
         return `${properties.watts || 0}W`;
     }
     if (type === 'battery') {
         return `${properties.capacity || 0}Ah`;
     }
     return null;
}

export function wireDisplayLabel(wire: Wire, mode: 'standard' | 'load', gaugeFormat: WireGaugeFormat,
  lengthUnit: LengthUnit, calculation?: Pick<WireCalculation, 'current'>) {
  if (mode === 'load') {
    return calculation && Number.isFinite(calculation.current) ? `${calculation.current.toFixed(1)}A` : '— A';
  }
  const polarity = wire.polarity === 'positive' ? '+' : wire.polarity === 'negative' ? '−' : '~';
  return `${polarity} ${formatWireGauge(wire.gauge, gaugeFormat) || 'Unspecified gauge'} · ${formatWireLength(wire.length, lengthUnit)}`;
}
