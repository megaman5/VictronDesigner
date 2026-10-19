import { useCallback, useEffect, useRef, useState } from 'react';
import { reviewFingerprint, type DesignReviewResult, type ReviewStatus } from '@shared/design-review';

/** Each request is bound to both content and sequence; cancellation is supplemented by a response guard. */
export function useDesignValidation(input: { components: any[]; wires: any[]; systemVoltage: number; options?: any; requirements?: unknown }, sequence: number, debounceMs = 500) {
  const fingerprint = reviewFingerprint(input);
  const latest = useRef({ input, sequence, fingerprint });
  latest.current = { input, sequence, fingerprint };
  const requestId = useRef(0);
  const controller = useRef<AbortController>();
  const [state, setState] = useState<{result: DesignReviewResult | null; status: ReviewStatus; fingerprint?: string; sequence?: number; error?: string}>({ result: null, status: 'unchecked' });
  const validate = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const id = ++requestId.current;
    const captured = latest.current;
    if (!captured.input.components.length && !captured.input.wires.length) { setState({result:null, status:'unchecked'}); return; }
    setState(previous => ({...previous, status:'checking', fingerprint:captured.fingerprint, sequence:captured.sequence, error:undefined}));
    const stillCurrent = () => id === requestId.current && !abort.signal.aborted && latest.current.sequence === captured.sequence && latest.current.fingerprint === captured.fingerprint;
    try {
      const response = await fetch('/api/validate-design', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(captured.input), signal:abort.signal});
      if (!response.ok) throw new Error('Design review could not be completed.');
      const result: DesignReviewResult = await response.json();
      if (result.checkedFingerprint !== captured.fingerprint) throw new Error('Review response did not match this design.');
      if (stillCurrent()) setState({result, status:'current', fingerprint:captured.fingerprint, sequence:captured.sequence});
    } catch (error) {
      if (stillCurrent()) setState(previous => ({...previous, status:'failed', error:error instanceof Error ? error.message : 'Review failed'}));
    }
  }, []);
  useEffect(() => {
    controller.current?.abort(); ++requestId.current;
    const timer = setTimeout(() => void validate(), debounceMs);
    return () => { clearTimeout(timer); controller.current?.abort(); ++requestId.current; };
  }, [fingerprint, sequence, debounceMs, validate]);
  const changed = state.fingerprint !== fingerprint || state.sequence !== sequence;
  const status: ReviewStatus = changed ? (state.result ? 'stale' : 'unchecked') : state.status;
  return { result:state.result, currentResult:status === 'current' ? state.result : null, status, error:state.error, validate };
}
