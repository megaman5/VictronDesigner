import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../client/src/components/ui/tooltip';
import SchematicDesigner from '../../client/src/pages/SchematicDesigner';

vi.mock('@/components/TopBar', () => ({ TopBar: ({ onAIPrompt, onUndo, onRedo, onAIWire, onClear, canUndo, canRedo }: any) => <><button onClick={onAIPrompt}>Open AI</button><button onClick={onAIWire}>AI Wire</button><button onClick={onClear}>Clear</button><button onClick={onUndo} disabled={!canUndo}>Undo</button><button onClick={onRedo} disabled={!canRedo}>Redo</button></> }));
vi.mock('@/components/SchematicCanvas', () => ({ SchematicCanvas: ({ components, wires }: any) => <div data-testid="test-canvas" data-wires={JSON.stringify(wires)}>{components.map((c: any) => c.name).join(',')}</div> }));
vi.mock('@/components/ComponentLibrary', () => ({ ComponentLibrary: () => null }));
vi.mock('@/components/PropertiesPanel', () => ({ PropertiesPanel: () => null }));
vi.mock('@/lib/tracking', () => ({ trackAction: vi.fn() }));
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
const encoder = new TextEncoder();
const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); toast.mockClear();
  document.cookie = 'disclaimerAccepted=1; path=/';
});
afterEach(() => vi.unstubAllGlobals());
function mount(stream: string | ReadableStream, prompt = 'A marine power system', wireResult?: unknown, submit = true) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/ai-generate-system-stream') return { ok: true, body: typeof stream === 'string' ? new ReadableStream({ start(c) { c.enqueue(encoder.encode(stream)); c.close(); } }) : stream };
    if (url === '/api/ai-wire-components') return { ok: true, json: async () => wireResult };
    if (url === '/auth/user') return { ok: false };
    return { ok: true, json: async () => url.includes('custom-components') ? [] : {} };
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><TooltipProvider><SchematicDesigner /></TooltipProvider></QueryClientProvider>);
  if (!submit) return;
  fireEvent.click(screen.getByText('Open AI'));
  fireEvent.change(screen.getByTestId('input-ai-prompt'), { target: { value: prompt } });
  fireEvent.click(screen.getByTestId('button-generate-ai'));
}

describe('AI streamed generation', () => {
  it('draws complete equipment and connections before applying the final design', async () => {
    let controller!: ReadableStreamDefaultController;
    mount(new ReadableStream({ start(c) { controller = c; } }));
    await waitFor(() => expect(screen.getByText('Waiting for response data')).toBeInTheDocument());
    const components = [{ id: 'b', type: 'battery', name: 'Live battery', x: 20, y: 40, properties: { voltage: 12, capacity: 200 } }, { id: 'f', type: 'fuse', name: 'Main fuse', x: 300, y: 40, properties: { fuseRating: 100 } }];
    const wires = [{ fromComponentId: 'b', toComponentId: 'f', fromTerminal: 'positive', toTerminal: 'in', polarity: 'positive', gauge: '4 AWG', length: 5 }];
    const text = JSON.stringify({ components, wires });
    await act(async () => controller.enqueue(encoder.encode(event('iteration-start', { iteration: 1, maxIterations: 6 }) + event('ai-activity', { phase: 'planning' }))));
    expect(screen.getByText('Planning your system')).toBeInTheDocument();
    await act(async () => controller.enqueue(encoder.encode(event('ai-token', { token: text, accumulatedLength: text.length }))));
    expect(screen.getByRole('img', { name: 'AI draft schematic' })).toBeInTheDocument();
    expect(screen.getAllByTestId('ai-draft-component')).toHaveLength(2);
    expect(screen.getByTestId('ai-draft-wire')).toBeInTheDocument();
    expect(screen.getByText('2 equipment · 1 wires')).toBeInTheDocument();
    expect(screen.getByTestId('test-canvas')).toBeEmptyDOMElement();
    await act(async () => controller.enqueue(encoder.encode(event('ai-response-complete', {}))));
    expect(screen.getByText('Checking electrical connections')).toBeInTheDocument();
    await act(async () => { controller.enqueue(encoder.encode(event('complete', { components, wires }))); controller.close(); });
    expect(screen.getByTestId('test-canvas')).toHaveTextContent('Live battery');
  });
  it('clears a failed primary draft on fallback and stops without changing the canvas', async () => {
    let controller!: ReadableStreamDefaultController;
    mount(new ReadableStream({ start(c) { controller = c; } }));
    const text = JSON.stringify({ components: [{ id: 'b', type: 'battery', name: 'Discarded draft', x: 20, y: 40 }], wires: [] });
    await act(async () => controller.enqueue(encoder.encode(event('ai-token', { token: text, accumulatedLength: text.length }))));
    expect(screen.getByText('Discarded draft')).toBeInTheDocument();
    await act(async () => controller.enqueue(encoder.encode(event('ai-fallback', {}))));
    expect(screen.queryByText('Discarded draft')).not.toBeInTheDocument();
    expect(screen.getByText(/Using backup AI/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop generation' }));
    const request = (fetch as any).mock.calls.find(([url]: any[]) => url === '/api/ai-generate-system-stream');
    expect(request[1].signal.aborted).toBe(true);
    await act(async () => { controller.enqueue(encoder.encode(event('complete', { components: [{ id: 'b', type: 'battery', name: 'Discarded draft', x: 20, y: 40 }], wires: [] }))); controller.close(); });
    expect(screen.getByTestId('test-canvas')).toBeEmptyDOMElement();
  });
  it('reports an interrupted stream and keeps the prompt available for retry', async () => {
    mount(event('iteration-start', { iteration: 1, maxIterations: 6 }) + event('iteration-complete', { iteration: 1, score: 70 }) +
      event('iteration-start', { iteration: 2, maxIterations: 6 }) + event('iteration-complete', { iteration: 2, score: 80 }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'destructive', description: expect.stringContaining('connection ended before the design arrived'),
    })));
    expect(screen.getByTestId('input-ai-prompt')).toHaveValue('A marine power system');
    expect(screen.getByTestId('test-canvas')).toBeInTheDocument();
  });
  it('applies completed changes directly and restores them with Undo and Redo', async () => {
    mount(event('iteration-start', { iteration: 1, maxIterations: 6 }) + event('iteration-complete', { iteration: 1, score: 70, errorCount: 2 }) +
      event('iteration-start', { iteration: 2, maxIterations: 6 }) + event('iteration-complete', { iteration: 2, score: 80, errorCount: 1 }) +
      event('complete', { components: [{ id: 'battery', type: 'battery', name: 'Marine battery', x: 100, y: 100, properties: { voltage: 12, capacity: 400 } }], wires: [],
        requirementCheck: { complete: false, status: 'needs-review', issues: [], uncheckedConstraints: ['A marine power system'] } }));
    await waitFor(() => expect(screen.getByTestId('test-canvas')).toHaveTextContent('Marine battery'));
    expect(screen.queryByText('Review AI design')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Undo'));
    await waitFor(() => expect(screen.getByTestId('test-canvas')).toBeEmptyDOMElement());
    fireEvent.click(screen.getByText('Redo'));
    await waitFor(() => expect(screen.getByTestId('test-canvas')).toHaveTextContent('Marine battery'));
    fireEvent.click(screen.getByText('Clear'));
    expect(screen.getByTestId('test-canvas')).toBeEmptyDOMElement();
    expect(screen.queryByText('Clear All Components and Wires?')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Undo'));
    expect(screen.getByTestId('test-canvas')).toHaveTextContent('Marine battery');
  });
  it('aligns icons without generating equipment, changing wires, or opening a proposal', async () => {
    const original = { systemVoltage: 24, components: [
      { id: 'a', type: 'battery', name: 'House battery', x: 101, y: 103, properties: { voltage: 12, capacity: 200 } },
      { id: 'b', type: 'fuse', name: 'Main fuse', x: 131, y: 115, properties: { fuseRating: 100 } },
    ], wires: [{ id: 'main', fromComponentId: 'a', toComponentId: 'b', fromTerminal: 'positive', toTerminal: 'in', polarity: 'positive', length: 7, gauge: '4 AWG' }] };
    localStorage.setItem('autoSavedDiagramState', JSON.stringify(original));
    mount('', 'line up the icons better');
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Icons aligned' })));
    expect((fetch as any).mock.calls.some(([url]: any[]) => url === '/api/ai-generate-system-stream')).toBe(false);
    expect(screen.queryByText('Review AI design')).not.toBeInTheDocument();
    expect(screen.getByTestId('test-canvas')).toHaveTextContent('House battery,Main fuse');
    await waitFor(() => {
      const key = Object.keys(localStorage).find(key => key.startsWith('victron:draft:'));
      expect(key).toBeDefined();
      const saved = JSON.parse(localStorage.getItem(key!)!).document;
      expect(saved.wires).toEqual(original.wires);
      expect(saved.systemVoltage).toBe(24);
      expect(saved.components[0].y).toBe(saved.components[1].y);
      expect(saved.components.map(({x,y,...rest}: any) => rest)).toEqual(original.components.map(({x,y,...rest}) => rest));
    });
  });

  it('applies AI wiring as one undoable change without confirmation', async () => {
    const original = { systemVoltage: 12, components: [
      { id: 'b', type: 'battery', name: 'Battery', x: 100, y: 100, properties: { voltage: 12 } },
      { id: 'f', type: 'fuse', name: 'Fuse', x: 400, y: 100, properties: { fuseRating: 100 } },
    ], wires: [] };
    const wires = [{ id: 'w', fromComponentId: 'b', toComponentId: 'f', fromTerminal: 'positive', toTerminal: 'in', polarity: 'positive', length: 5, gauge: '4 AWG' }];
    localStorage.setItem('autoSavedDiagramState', JSON.stringify(original));
    mount('', '', { wires, requirementCheck: { complete: false }, review: { issues: [{ category: 'unresolved', message: 'Estimated length' }] } }, false);
    fireEvent.click(screen.getByText('AI Wire'));
    await waitFor(() => expect(screen.getByTestId('test-canvas')).toHaveAttribute('data-wires', JSON.stringify(wires)));
    expect(screen.queryByText('Review AI wiring')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Undo'));
    expect(screen.getByTestId('test-canvas')).toHaveAttribute('data-wires', '[]');
    fireEvent.click(screen.getByText('Redo'));
    expect(screen.getByTestId('test-canvas')).toHaveAttribute('data-wires', JSON.stringify(wires));
  });
  it('shows all local prerequisites without a server call or a canvas change', async () => {
    const original = { components: [{ id: 'b', type: 'battery', name: 'Battery', x: 100, y: 100, properties: {} }], wires: [], systemVoltage: 12 };
    localStorage.setItem('autoSavedDiagramState', JSON.stringify(original));
    mount('', '', { preflight: [{ message: 'Add battery protection first.' }] }, false);
    fireEvent.click(screen.getByText('AI Wire'));
    await waitFor(() => expect(screen.getByText('Before AI Wire')).toBeInTheDocument());
    expect(screen.getByText(/Add battery overcurrent protection/)).toBeInTheDocument();
    expect((fetch as any).mock.calls.some(([url]: any[]) => url === '/api/ai-wire-components')).toBe(false);
    expect(screen.getByTestId('test-canvas')).toHaveTextContent('Battery');
    expect(screen.getByTestId('test-canvas')).toHaveAttribute('data-wires', '[]');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

});
