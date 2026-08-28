import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ComponentIcon, CustomComponentIcon } from '@/components/component-icons';
import { TERMINAL_CONFIGS } from '@/lib/terminal-config';
import { buildReplyDraft } from '@/lib/feedback-reply-drafts';

describe('ComponentIcon', () => {
  // Every placeable type should have a drawn icon; the fallback plain box is
  // there for safety, not as the normal outcome.
  const placeable = Object.keys(TERMINAL_CONFIGS).filter((t) => t !== 'custom');

  it('draws a distinct icon for every placeable component type', () => {
    const missing = placeable.filter((type) => {
      const { container } = render(<ComponentIcon type={type} />);
      const svg = container.querySelector('svg')!;
      // The fallback is a single rect and nothing else.
      return svg.children.length === 1 && svg.children[0].tagName === 'rect';
    });
    expect(missing).toEqual([]);
  });

  it('does not reuse one glyph for unrelated hardware', () => {
    const shapeOf = (type: string) =>
      render(<ComponentIcon type={type} />).container.querySelector('svg')!.innerHTML;
    // These were all the same Cable/Gauge glyph before.
    const shapes = ['multiplus', 'fuse', 'shore-power', 'smartshunt', 'busbar-positive'].map(shapeOf);
    expect(new Set(shapes).size).toBe(shapes.length);
  });
});

describe('CustomComponentIcon', () => {
  const terminals = [
    { id: 'a', type: 'positive' as const, label: '+', x: 0, y: 20, color: 'red', orientation: 'left' as const },
    { id: 'b', type: 'negative' as const, label: '-', x: 160, y: 20, color: 'black', orientation: 'right' as const },
  ];

  it('derives the icon from the definition, not a generic placeholder', () => {
    const { container } = render(
      <CustomComponentIcon width={160} height={120} terminals={terminals} />
    );
    expect(container.querySelectorAll('circle')).toHaveLength(2);
    expect(container.querySelector('rect')).toBeTruthy();
  });

  it('gives parts with different terminal layouts different icons', () => {
    const a = render(<CustomComponentIcon width={160} height={120} terminals={terminals} />)
      .container.innerHTML;
    const b = render(
      <CustomComponentIcon width={400} height={40} terminals={[terminals[0]]} />
    ).container.innerHTML;
    expect(a).not.toBe(b);
  });

  it('survives a definition with no terminals', () => {
    const { container } = render(<CustomComponentIcon width={160} height={120} terminals={[]} />);
    expect(container.querySelectorAll('circle')).toHaveLength(0);
  });
});

describe('reply drafts', () => {
  it('appends the tip link below the sign-off of a tailored draft', () => {
    const draft = buildReplyDraft({ id: '65de0c07-b2cc-40e0-8ec6-8d132dcfc40f', message: '' });
    expect(draft.body).toContain('https://ko-fi.com/megaman5');
    // Footer, not prose: it comes after the signature.
    expect(draft.body.indexOf('ko-fi.com')).toBeGreaterThan(draft.body.indexOf('VictronDesigner.com'));
  });

  it('appends it to the generic fallback draft too', () => {
    const draft = buildReplyDraft({ id: 'no-such-id', message: 'hello' });
    expect(draft.body).toContain('https://ko-fi.com/megaman5');
  });

  it('does not double-append', () => {
    const a = buildReplyDraft({ id: 'no-such-id', message: 'hello' }).body;
    expect(a.match(/ko-fi\.com/g)).toHaveLength(1);
  });
});
