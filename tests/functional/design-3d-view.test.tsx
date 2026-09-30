import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Design3DView from '@/components/Design3DView';
import { DEFAULT_WIRE_ROUTING_OPTIONS } from '@/lib/wire-routing';

vi.mock('three', async importOriginal => {
  const actual = await importOriginal<typeof import('three')>();
  return { ...actual, WebGLRenderer: class { constructor() { throw new Error('WebGL unavailable'); } } };
});
const defaults = { wires: [], routingOptions: DEFAULT_WIRE_ROUTING_OPTIONS,
  onComponentSelect: vi.fn(), onWireSelect: vi.fn(), onBack: vi.fn() };
it('guides an empty design back to the editor', () => {
  render(<Design3DView {...defaults} components={[]} />);
  expect(screen.getByText('Your system, in a new dimension')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back to 2D editor' }));
  expect(defaults.onBack).toHaveBeenCalled();
});
it('offers a usable fallback when the browser cannot create WebGL', () => {
  render(<Design3DView {...defaults} components={[
    { id: 'a', name: 'Battery', type: 'battery', x: 0, y: 0, properties: {} },
  ]} />);
  expect(screen.getByRole('alert')).toHaveTextContent('3D is unavailable in this browser');
  expect(screen.getByRole('button', { name: 'Back to 2D editor' })).toBeEnabled();
});
