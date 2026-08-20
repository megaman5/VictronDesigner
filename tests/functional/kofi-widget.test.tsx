import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { KofiWidget } from '@/components/KofiWidget';

const SRC = 'https://storage.ko-fi.com/cdn/scripts/overlay-widget.js';

describe('Ko-fi widget', () => {
  beforeEach(() => {
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
});
