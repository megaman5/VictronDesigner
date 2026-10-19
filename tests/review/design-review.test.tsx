import { renderHook, act, render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, afterEach } from 'vitest';
import { useDesignValidation } from '../../client/src/hooks/use-design-validation';
import { buildDesignReview, reviewHeadline, reviewFingerprint } from '../../shared/design-review';
import { DesignReviewPanel } from '../../client/src/components/DesignReviewPanel';
import { designRequirementsSchema } from '../../shared/design-requirements';
const a = {components:[{id:'load',type:'dc-load',properties:{watts:120}}], wires:[],systemVoltage:12};
const b = {...a, systemVoltage:24};
const legacy = {valid:false,score:99,issues:[{severity:'error' as const,category:'electrical',message:'Missing battery',componentIds:['load']}]};
const result = (input: typeof a) => buildDesignReview(input, legacy);
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
afterEach(() => {vi.unstubAllGlobals();vi.useRealTimers();});
describe('Design review', () => {
  it('uses estimated lengths for sizing without generic review blockers', () => {
    const input = { components: [{ id: 'battery', type: 'battery', properties: {} }, { id: 'load', type: 'dc-load', properties: { watts: 120 } }], wires: [{ id: 'wire', fromComponentId: 'battery', toComponentId: 'load', fromTerminal: 'positive', toTerminal: 'positive', gauge: '4 AWG', length: 10, lengthEstimated: true }], systemVoltage: 12,
      requirements: designRequirementsSchema.parse({ dcVoltage: 12, constraints: ['A compact RV system'], assumptions: ['Cable runs include service slack.'] }) };
    const checked = buildDesignReview(input, { valid: true, score: 100, issues: [] });
    expect(checked.analysis.wires.wire.status).toBe('known');
    expect(checked.issues).toHaveLength(0);
    expect(checked.requirementCheck?.status).toBe('complete');
    render(<DesignReviewPanel {...input} validationResult={checked} status="current" />);
    expect(screen.getByText(/AI-estimated wire lengths: 1/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No errors found in supported checks');
    const undersized = buildDesignReview({ ...input, wires: [{ ...input.wires[0], gauge: '18 AWG', length: 100 }] }, { valid: true, score: 100, issues: [] });
    expect(undersized.issues.some(issue => issue.category === 'wire-sizing' && issue.severity === 'error')).toBe(true);
  });
  it('leads with electrical errors even with an excellent legacy score', () => {
    expect(reviewHeadline(result(a),'current')).toBe('1 error needs attention');
    expect(result(a).issues[0].id).toBe(result(a).issues[0].id);
  });
  it('preserves grounding and parallel constraints when replacing current guesses', () => {
    const checked = buildDesignReview(a, {...legacy, issues:[{severity:'error',category:'wire-sizing',message:'Ground wire gauge should match hot/neutral',wireId:'ground'},{severity:'error',category:'wire-sizing',message:'Parallel conductors must be at least 1/0 AWG',wireId:'parallel'}]});
    expect(checked.issues).toHaveLength(2);expect(checked.valid).toBe(false);
  });
  it('flags required equipment removed during manual editing independently of layout score', () => {
    const requirements = designRequirementsSchema.parse({dcVoltage:12,equipment:[{id:'two-batteries',type:'battery',quantity:2}]});
    const checked = buildDesignReview({...a,requirements},{valid:true,score:100,issues:[]});
    expect(checked.valid).toBe(false);
    expect(checked.requirementCheck?.complete).toBe(false);
    expect(checked.issues.some(issue => issue.ruleId === 'two-batteries')).toBe(true);
    expect(reviewFingerprint({...a,requirements})).not.toBe(reviewFingerprint(a));
  });
  it('previews a supported gauge correction before applying it', () => {
    const input={components:[{id:'battery',type:'battery',properties:{}},{id:'load',type:'dc-load',properties:{watts:120}}],wires:[{id:'wire',fromComponentId:'battery',toComponentId:'load',fromTerminal:'positive',toTerminal:'positive',gauge:'18 AWG',length:10}],systemVoltage:12};
    const checked=buildDesignReview(input,{valid:true,score:100,issues:[]});
    const apply=vi.fn();
    render(<DesignReviewPanel {...input} validationResult={checked} status="current" onApplyGaugeFix={apply}/>);
    fireEvent.click(screen.getByText('Preview gauge change'));
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Apply gauge change'));
    expect(apply).toHaveBeenCalledWith('wire',checked.analysis.wires.wire.calculation?.recommendedGauge);
  });
  it('ignores an older response after a newer document has been checked', async () => {
    vi.useFakeTimers();
    const pending: Array<(value: any) => void> = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => pending.push(resolve))));
    const {result: hook, rerender} = renderHook(({input,seq}) => useDesignValidation(input,seq,10),{initialProps:{input:a,seq:1}});
    await act(async () => {vi.advanceTimersByTime(10);});
    rerender({input:b,seq:2});
    expect(hook.current.status).toBe('unchecked');
    await act(async () => {vi.advanceTimersByTime(10);});
    await act(async () => {pending[1]({ok:true,json:async () => result(b)});await flush();});
    expect(hook.current.status).toBe('current');
    await act(async () => {pending[0]({ok:true,json:async () => result(a)});await flush();});
    expect(hook.current.currentResult?.checkedFingerprint).toBe(reviewFingerprint(b));
    rerender({input:a,seq:3});
    expect(hook.current.status).toBe('stale');expect(hook.current.currentResult).toBeNull();
  });
  it('exposes request failures and can retry', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ok:true,json:async () => result(a)});
    vi.stubGlobal('fetch',fetchMock);
    const {result:hook} = renderHook(() => useDesignValidation(a,1,10));
    await act(async () => {vi.advanceTimersByTime(10);await flush();});
    expect(hook.current.status).toBe('failed');
    await act(async () => {await hook.current.validate();});
    expect(hook.current.status).toBe('current');
  });
});

it('fingerprints the JSON request consistently after optional properties are cleared', () => {
  const input = {...a,components:[{...a.components[0],properties:{watts:120,isc:undefined}}],options:{temperatureC:undefined}};
  expect(reviewFingerprint(input)).toBe(reviewFingerprint(JSON.parse(JSON.stringify(input))));
  expect(reviewFingerprint({...input,systemVoltage:24})).not.toBe(reviewFingerprint(input));
});
it('ignores empty and whitespace-only saved requirement notes', () => {
  const requirements = designRequirementsSchema.parse({dcVoltage:12,constraints:['','  '],assumptions:['\n'],preferences:['  ']});
  const checked = buildDesignReview({...a,requirements},{valid:true,score:100,issues:[]});
  expect(checked.issues).toHaveLength(0);
  expect(checked.requirementCheck?.complete).toBe(true);
});
it('hides previous issue counts and warnings when a review fails', () => {
  render(<DesignReviewPanel {...a} validationResult={result(a)} status="failed" error="Review failed"/>);
  expect(screen.queryByText('Missing battery')).toBeNull();
  expect(screen.queryByText('1 errors')).toBeNull();
  expect(screen.getByText('Retry review')).toBeTruthy();
});

it('accepts a server review computed from the serialized request', async () => {
  vi.useFakeTimers();
  const input={...a,components:[{...a.components[0],properties:{watts:120,isc:undefined}}],options:{temperatureC:undefined}};
  vi.stubGlobal('fetch',vi.fn(async (_url,request)=>({ok:true,json:async()=>buildDesignReview(JSON.parse(request.body),legacy)})));
  const {result:hook}=renderHook(()=>useDesignValidation(input,1,10));
  await act(async()=>{vi.advanceTimersByTime(10);await flush();});
  expect(hook.current.status).toBe('current');
  expect(hook.current.error).toBeUndefined();
});
