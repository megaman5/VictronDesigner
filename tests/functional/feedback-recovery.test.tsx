import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SchematicCanvas } from '@/components/SchematicCanvas';

it('recovers an existing off-screen design without changing relative layout or wires', () => {
  const onChange = vi.fn();
  const scrollTo = vi.fn();
  const components = [
    { id: 'lost', type: 'alternator', name: 'Alternator', x: -1111, y: 257, properties: {} },
    { id: 'battery', type: 'battery', name: 'Battery', x: 190, y: 968, properties: {} },
  ];
  render(<SchematicCanvas components={components} onComponentsChange={onChange} />);
  screen.getByTestId('canvas-drop-zone').scrollTo = scrollTo;
  fireEvent.click(screen.getByTestId('button-recover-components'));
  const recovered = onChange.mock.calls[0][0];
  expect(recovered[0]).toMatchObject({ x: 20, y: 257 });
  expect(recovered[1]).toMatchObject({ x: 1321, y: 968 });
  expect(scrollTo).toHaveBeenCalledWith({ left: 0, top: 0 });
  expect(components[0].x).toBe(-1111);
});

it('renders shared terminals and manual bends at their exact anchors', () => {
  const components = [
    { id: 'shunt', type: 'smartshunt', name: 'SmartShunt', x: 361.6, y: 251.6, properties: {} },
    { id: 'inverter', type: 'multiplus', name: 'MultiPlus', x: 969.4, y: 103, properties: { mirrorX: true } },
  ];
  const base = { fromComponentId: 'shunt', toComponentId: 'inverter', fromTerminal: 'system-minus',
    toTerminal: 'dc-negative', polarity: 'negative' as const, gauge: '2/0 AWG', length: 10 };
  const { container } = render(<SchematicCanvas components={components} wires={[
    { ...base, id: 'auto' }, { ...base, id: 'manual', waypoints: [{ x: 300, y: 200 }] },
  ]} />);
  const paths = [...container.querySelectorAll('[data-testid="canvas-drop-zone"] > div > svg path')]
    .map(p => p.getAttribute('d')!).filter(d => d.startsWith('M 431.6 341.6'));
  expect(paths.length).toBeGreaterThanOrEqual(2);
  paths.forEach(d => expect(d.endsWith('989.4 251')).toBe(true));
});
