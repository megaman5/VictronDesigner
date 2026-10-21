/** Completion means a draft arrived; the checked result determines the notice. */
export function aiResultNotice(data: any, kind: 'Design' | 'Wiring') {
  const status = data.runStatus;
  const timedOut = data.stopReason === 'run-deadline';
  if (status?.electricalCheck === 'failed') return {
    title: `${kind} draft needs corrections`,
    description: `${status.electricalErrorCount ?? 'Some'} electrical errors remain. Open Review before using this draft. Undo is available.`,
    variant: 'destructive' as const,
  };
  if (timedOut || status?.electricalCheck === 'incomplete' || status?.requirementsCheck && status.requirementsCheck !== 'complete') return {
    title: `${kind} draft needs review`,
    description: `${timedOut ? 'The time limit was reached; the best draft was kept. ' : ''}Some checks are incomplete. Open Review to see what needs attention. Undo is available.`,
  };
  return { title: `${kind} updated`, description: 'Undo is available.' };
}
