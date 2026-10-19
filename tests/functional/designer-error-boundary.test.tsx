import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DesignerErrorBoundary } from '../../client/src/components/DesignerErrorBoundary';
const { trackError } = vi.hoisted(() => ({ trackError: vi.fn() }));
vi.mock('@/lib/tracking', () => ({ trackError }));

describe('designer rendering recovery', () => {
  it('shows recovery controls and records the error instead of leaving a blank page', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    function BrokenScreen(): never { throw new Error('Cannot display AI result'); }
    try {
      render(<DesignerErrorBoundary><BrokenScreen /></DesignerErrorBoundary>);
      expect(screen.getByRole('heading')).toHaveTextContent('couldn’t display this screen');
      expect(screen.getByRole('button', { name: 'Reload designer' })).toBeInTheDocument();
      expect(trackError).toHaveBeenCalledWith('Cannot display AI result', expect.any(String), expect.objectContaining({ type: 'designer_render' }));
    } finally { consoleError.mockRestore(); }
  });
});
