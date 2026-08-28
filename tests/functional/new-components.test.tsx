import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ComponentLibrary } from '@/components/ComponentLibrary';
import { SchematicComponent } from '@/components/SchematicComponent';
import { getComponentTerminals, TERMINAL_CONFIGS } from '@/lib/terminal-config';

vi.mock('@/lib/tracking', () => ({ trackAction: vi.fn() }));

// ComponentLibrary fetches the signed-in user's saved custom components with
// useQuery, so it needs a query client in context even when signed out.
function renderLibrary() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ComponentLibrary />
    </QueryClientProvider>
  );
}

describe('Component library entries', () => {
  // The niche parts sit behind "Show more" so the list opens at a usable
  // length; expand the section before looking for them.
  const expand = (section: string) =>
    fireEvent.click(screen.getByTestId(`button-show-more-${section}`));

  it('shows the everyday parts without expanding', () => {
    renderLibrary();
    expect(screen.getByText('MultiPlus Inverter')).toBeInTheDocument();
    expect(screen.getByText('MPPT Controller')).toBeInTheDocument();
    expect(screen.getByText('Battery Bank')).toBeInTheDocument();
    expect(screen.getByText(/Fuse \(Class T, MEGA, blade/)).toBeInTheDocument();
    expect(screen.getByText('DC Circuit Breaker')).toBeInTheDocument();
  });

  it('keeps the niche parts out of the way until asked for', () => {
    renderLibrary();
    expect(screen.queryByText('Lynx Power In')).not.toBeInTheDocument();
    expect(screen.queryByText('AC Circuit Breaker')).not.toBeInTheDocument();
  });

  it('offers every Lynx module once the Victron section is expanded', () => {
    renderLibrary();
    expand('victron');
    expect(screen.getByText('Lynx Power In')).toBeInTheDocument();
    expect(screen.getByText('Lynx Distributor')).toBeInTheDocument();
    expect(screen.getByText('Lynx Shunt VE.Can')).toBeInTheDocument();
    expect(screen.getByText('Lynx Smart BMS')).toBeInTheDocument();
  });

  it('offers DC and AC breakers, and a general fuse rather than Class T only', () => {
    renderLibrary();
    expand('safety');
    expect(screen.getByText('DC Circuit Breaker')).toBeInTheDocument();
    expect(screen.getByText('AC Circuit Breaker')).toBeInTheDocument();
    expect(screen.getByText(/Fuse \(Class T, MEGA, blade/)).toBeInTheDocument();
  });

  it('collapses again with Show less', () => {
    renderLibrary();
    expand('victron');
    expect(screen.getByText('Lynx Power In')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-show-less-victron'));
    expect(screen.queryByText('Lynx Power In')).not.toBeInTheDocument();
  });
});

describe('New component terminal configs', () => {
  const types = ['lynx-power-in', 'lynx-distributor', 'lynx-shunt', 'lynx-smart-bms', 'dc-breaker', 'ac-breaker'];

  it('defines a config for every new type', () => {
    for (const t of types) {
      expect(TERMINAL_CONFIGS[t], `missing config for ${t}`).toBeDefined();
      expect(TERMINAL_CONFIGS[t].terminals.length).toBeGreaterThan(0);
    }
  });

  it('keeps every terminal inside the component body', () => {
    for (const t of types) {
      const { width, height, terminals } = TERMINAL_CONFIGS[t];
      for (const term of terminals) {
        expect(term.x, `${t}.${term.id} x`).toBeGreaterThanOrEqual(-10);
        expect(term.x, `${t}.${term.id} x`).toBeLessThanOrEqual(width + 10);
        expect(term.y, `${t}.${term.id} y`).toBeGreaterThanOrEqual(-10);
        expect(term.y, `${t}.${term.id} y`).toBeLessThanOrEqual(height + 10);
      }
    }
  });

  it('gives every terminal a unique id', () => {
    for (const t of types) {
      const ids = TERMINAL_CONFIGS[t].terminals.map(term => term.id);
      expect(new Set(ids).size, `duplicate terminal id in ${t}`).toBe(ids.length);
    }
  });

  it('adds LOAD terminals only to MPPT models that have them', () => {
    const withLoad = getComponentTerminals('mppt', { model: '100|20' }).map(t => t.id);
    const withoutLoad = getComponentTerminals('mppt', { model: '150|45' }).map(t => t.id);
    expect(withLoad).toContain('load-positive');
    expect(withLoad).toContain('load-negative');
    expect(withoutLoad).not.toContain('load-positive');
  });
});

describe('New component rendering', () => {
  const renderComponent = (type: string, properties: Record<string, any> = {}) =>
    render(
      <svg>
        <SchematicComponent id="c1" type={type} name={type} x={0} y={0} properties={properties} />
      </svg>
    );

  it('renders each Lynx module without throwing', () => {
    expect(() => renderComponent('lynx-power-in')).not.toThrow();
    expect(() => renderComponent('lynx-distributor')).not.toThrow();
    expect(() => renderComponent('lynx-shunt')).not.toThrow();
    expect(() => renderComponent('lynx-smart-bms', { amps: 500 })).not.toThrow();
  });

  it('labels a fuse with its selected family and rating', () => {
    const { container } = renderComponent('fuse', { fuseType: 'blade', fuseRating: 15 });
    expect(container.textContent).toContain('15A');
    expect(container.textContent).toContain('BLADE');
  });

  it('falls back to Class T for a legacy fuse with no type', () => {
    const { container } = renderComponent('fuse', { fuseRating: 400 });
    expect(container.textContent).toContain('400A');
    expect(container.textContent).toContain('CLASS');
  });

  it('renders breakers with their ratings', () => {
    expect(renderComponent('dc-breaker', { amps: 50 }).container.textContent).toContain('50A');
    const ac = renderComponent('ac-breaker', { amps: 30, poles: 2 }).container.textContent;
    expect(ac).toContain('30A');
    expect(ac).toContain('2-pole');
  });

  it('draws the LOAD terminals on an MPPT 100|20 but not a 150|45', () => {
    expect(renderComponent('mppt', { model: '100|20' }).container.textContent).toContain('LOAD');
    expect(renderComponent('mppt', { model: '150|45' }).container.textContent).not.toContain('LOAD');
  });
});
