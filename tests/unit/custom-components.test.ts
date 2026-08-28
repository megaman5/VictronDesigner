import { describe, it, expect } from 'vitest';
import { toPlacedProperties } from '@/lib/custom-components';
import type { CustomComponentDefinition } from '@/lib/custom-components';

const definition = (over: Partial<CustomComponentDefinition> = {}): CustomComponentDefinition => ({
  id: 'def-1',
  ownerId: 'owner-1',
  name: 'Water maker',
  subtitle: '12V, 8A',
  category: 'custom',
  width: 160,
  height: 120,
  terminals: [
    { id: 'in-positive', type: 'positive', label: '+', x: 0, y: 40, color: 'red', orientation: 'left' },
  ],
  appearance: null,
  supportedVoltages: null,
  visibility: 'private',
  version: 1,
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('toPlacedProperties', () => {
  it('does not freeze a voltage onto the placed instance', () => {
    // A custom part has no voltage field in the properties panel, so a frozen
    // snapshot could never be corrected and would feed stale numbers into wire
    // sizing and inferSystemVoltage(). It must fall back to the live value.
    expect(toPlacedProperties(definition())).not.toHaveProperty('voltage');
  });

  it('snapshots terminals and dimensions so edits to the definition do not alter placed parts', () => {
    const props = toPlacedProperties(definition());
    expect(props.terminals).toHaveLength(1);
    expect(props.width).toBe(160);
    expect(props.height).toBe(120);
    expect(props.definitionId).toBe('def-1');
    expect(props.definitionVersion).toBe(1);
  });

  it('carries declared supported voltages through to the instance', () => {
    expect(toPlacedProperties(definition({ supportedVoltages: [12, 24] })).supportedVoltages).toEqual([12, 24]);
  });

  it('omits supportedVoltages when none are declared', () => {
    expect(toPlacedProperties(definition({ supportedVoltages: [] })).supportedVoltages).toBeUndefined();
    expect(toPlacedProperties(definition({ supportedVoltages: null })).supportedVoltages).toBeUndefined();
  });
});
