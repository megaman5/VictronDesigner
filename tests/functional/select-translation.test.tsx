import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../client/src/components/ui/select';

function Gauge({ value }: { value: string }) {
  return <Select value={value}>
    <SelectTrigger data-testid="gauge"><SelectValue /></SelectTrigger>
    <SelectContent><SelectItem value="awg">AWG</SelectItem><SelectItem value="metric">mm²</SelectItem></SelectContent>
  </Select>;
}

it('changes a portaled label after translation replaced its text node', () => {
  const { rerender } = render(<Gauge value="awg" />);
  const value = screen.getByTestId('gauge').querySelector('span')!;
  const walker = document.createTreeWalker(value, NodeFilter.SHOW_TEXT);
  const text = walker.nextNode()!;
  expect(text.textContent).toBe('AWG');
  // Google Translate replaces React-owned text nodes with <font> elements.
  const font = document.createElement('font'); font.textContent = 'Translated AWG';
  text.parentNode!.replaceChild(font, text);
  expect(() => rerender(<Gauge value="metric" />)).not.toThrow();
  expect(screen.getByTestId('gauge')).toHaveTextContent('mm²');
});
