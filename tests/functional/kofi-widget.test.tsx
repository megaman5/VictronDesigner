import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { KofiWidget } from '@/components/KofiWidget';

const SRC = 'https://storage.ko-fi.com/cdn/scripts/overlay-widget.js';

describe('Ko-fi widget', () => {
  beforeEach(() => {
    document.head.querySelectorAll('#kofi-widget-position').forEach(n => n.remove());
    document.body.innerHTML = '';
    document.querySelectorAll(`script[src="${SRC}"]`).forEach(s => s.remove());
    delete (window as any).kofiWidgetOverlay;
  });

  it('injects the overlay script once', () => {
    render(<KofiWidget />);
    render(<KofiWidget />);
    expect(document.querySelectorAll(`script[src="${SRC}"]`)).toHaveLength(1);
  });

  it('loads the script asynchronously so it cannot block first paint', () => {
    render(<KofiWidget />);
    const script = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
    expect(script?.async).toBe(true);
  });

  it('draws with the configured button once the script loads', () => {
    const draw = vi.fn();
    render(<KofiWidget />);
    const script = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`)!;
    (window as any).kofiWidgetOverlay = { draw };
    script.dispatchEvent(new Event('load'));

    expect(draw).toHaveBeenCalledTimes(1);
    const [username, config] = draw.mock.calls[0];
    expect(username).toBe('megaman5');
    expect(config['type']).toBe('floating-chat');
    expect(config['floating-chat.donateButton.text']).toBe('Tip Me');
    expect(config['floating-chat.donateButton.background-color']).toBe('#794bc4');
  });

  it('renders nothing itself', () => {
    const { container } = render(<KofiWidget />);
    expect(container.firstChild).toBeNull();
  });
  it('pins the button to the lower right', () => {
    render(<KofiWidget />);
    const style = document.getElementById('kofi-widget-position');
    expect(style).not.toBeNull();
    // Ko-fi's own stylesheet sets left: 16px; we must override it, and the
    // widget's position config key is dead so CSS is the only lever.
    expect(style!.textContent).toContain('right: 24px !important');
    expect(style!.textContent).toContain('left: auto !important');
    expect(style!.textContent).toContain('.floatingchat-container-wrap');
    expect(style!.textContent).toContain('.floatingchat-container-wrap-mobi');
  });

  it('injects the position override only once', () => {
    render(<KofiWidget />);
    render(<KofiWidget />);
    expect(document.querySelectorAll('#kofi-widget-position')).toHaveLength(1);
  });
});
