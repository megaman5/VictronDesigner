import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasViewTransition } from '../../client/src/components/CanvasViewTransition';

const editor = <input aria-label="Editor state" defaultValue="preserved" />;
afterEach(() => vi.useRealTimers());
describe('canvas view transition', () => {
  it('keeps the editor visible until 3D has rendered, then retains it across the reverse animation', () => {
    vi.useFakeTimers();
    let ready = () => {};
    const render3D = (onReady: () => void) => { ready = onReady; return <div>3D scene</div>; };
    const view = render(<CanvasViewTransition mode="2d" editor={editor} render3D={render3D} />);
    const input = screen.getByLabelText('Editor state');
    view.rerender(<CanvasViewTransition mode="3d" editor={editor} render3D={render3D} />);
    expect(screen.getByTestId('canvas-view-transition').getAttribute('data-mode')).toBe('2d');
    expect(screen.getByRole('status').textContent).toContain('Preparing');
    act(() => ready());
    expect(screen.getByTestId('canvas-view-transition').getAttribute('data-mode')).toBe('3d');
    expect(input.parentElement?.getAttribute('aria-hidden')).toBe('true');
    view.rerender(<CanvasViewTransition mode="2d" editor={editor} render3D={render3D} />);
    expect(screen.getByText('3D scene')).toBeTruthy();
    act(() => vi.advanceTimersByTime(740));
    expect(screen.queryByText('3D scene')).toBeNull();
    expect(screen.getByLabelText('Editor state')).toBe(input);
  });
  it('cancels scene disposal when the user switches back during the exit', () => {
    vi.useFakeTimers(); let ready = () => {};
    const render3D = (onReady: () => void) => { ready = onReady; return <div>3D scene</div>; };
    const view = render(<CanvasViewTransition mode="3d" editor={editor} render3D={render3D} />);
    act(() => ready());
    view.rerender(<CanvasViewTransition mode="2d" editor={editor} render3D={render3D} />);
    act(() => vi.advanceTimersByTime(300));
    view.rerender(<CanvasViewTransition mode="3d" editor={editor} render3D={render3D} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('3D scene')).toBeTruthy();
    expect(screen.getByTestId('canvas-view-transition').getAttribute('data-mode')).toBe('3d');
  });
});
