import { Component, type ErrorInfo, type ReactNode } from 'react';
import { trackError } from '@/lib/tracking';
import { Button } from '@/components/ui/button';

/** Keep a rendering failure from turning the entire designer into an empty page. */
export class DesignerErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    trackError(error.message, error.stack, { componentStack: info.componentStack, type: 'designer_render' });
  }

  render() {
    if (this.state.failed) return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md space-y-4">
          <h1 className="text-xl font-semibold">The designer couldn’t display this screen</h1>
          <p className="text-sm text-muted-foreground">Reload the designer to recover your local draft.</p>
          <Button onClick={() => window.location.reload()}>Reload designer</Button>
        </div>
      </div>
    );
    return this.props.children;
  }
}
