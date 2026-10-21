import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PropertiesPanel } from '../../client/src/components/PropertiesPanel';
import type { SchematicComponent } from '../../shared/schema';

const panel: SchematicComponent = { id: 'pv', type: 'solar-panel', name: 'Panel', x: 0, y: 0, properties: { watts: 240, voltage: 24 } };

describe('Solar panel datasheet ratings', () => {
  it('saves and clears Isc and Voc without changing panel power or Vmp', () => {
    const update = vi.fn();
    const { rerender } = render(<PropertiesPanel selectedComponent={panel} onUpdateComponent={update} />);
    expect(screen.getByText(/Without these ratings, sizing is provisional/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Short-circuit current (Isc, A)'), { target: { value: '11' } });
    expect(update).toHaveBeenLastCalledWith('pv', { properties: { watts: 240, voltage: 24, isc: 11 } });
    const rated = { ...panel, properties: { ...panel.properties, isc: 11 } };
    rerender(<PropertiesPanel selectedComponent={rated} onUpdateComponent={update} />);
    fireEvent.change(screen.getByLabelText('Open-circuit voltage (Voc, V)'), { target: { value: '30' } });
    expect(update).toHaveBeenLastCalledWith('pv', { properties: { watts: 240, voltage: 24, isc: 11, voc: 30 } });
    fireEvent.change(screen.getByLabelText('Short-circuit current (Isc, A)'), { target: { value: '' } });
    expect(update).toHaveBeenLastCalledWith('pv', { properties: { watts: 240, voltage: 24, isc: undefined } });
  });
});

it('saves the charger AC input rating separately from DC charge current', () => {
  const charger: SchematicComponent = {id:'charger',type:'blue-smart-charger',name:'Charger',x:0,y:0,properties:{amps:30,voltage:12}};
  const update=vi.fn();
  const {rerender}=render(<PropertiesPanel selectedComponent={charger} onUpdateComponent={update}/>);
  fireEvent.change(screen.getByLabelText('Rated AC Input Current (A)'),{target:{value:'4'}});
  expect(update).toHaveBeenLastCalledWith('charger',{properties:{amps:30,voltage:12,acInputAmps:4}});
  rerender(<PropertiesPanel selectedComponent={{...charger,properties:{...charger.properties,acInputAmps:4}}} onUpdateComponent={update}/>);
  fireEvent.change(screen.getByLabelText('Rated AC Input Current (A)'),{target:{value:''}});
  expect(update).toHaveBeenLastCalledWith('charger',{properties:{amps:30,voltage:12,acInputAmps:undefined}});
});


it('does not invent inverter utilization when no AC loads are connected', () => {
  const inverter: SchematicComponent = { id: 'inv', type: 'inverter', name: 'Inverter', x: 0, y: 0, properties: { watts: 3000, voltage: 12 } };
  render(<PropertiesPanel selectedComponent={inverter} components={[inverter]} wires={[]} />);
  expect(screen.getByText(/no utilization guess is made/)).toBeInTheDocument();
  expect(screen.queryByText(/Total AC Loads:/)).not.toBeInTheDocument();
  expect(screen.queryByText(/DC Input Current:/)).not.toBeInTheDocument();
});
