/** Reject malformed provider output before it reaches normalization or the editor. */
export function parseAIDesign(content: string, wiresOnly = false): any {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fenced?.[1] ?? content;
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  let candidate: any;
  try { candidate = JSON.parse(start >= 0 && end >= start ? text.slice(start, end + 1) : text); }
  catch { throw new Error('AI returned invalid or incomplete JSON.'); }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) ||
      !Array.isArray(candidate.wires) || candidate.wires.some((w: any) => !w || typeof w !== 'object' || typeof w.fromComponentId !== 'string' || typeof w.toComponentId !== 'string') ||
      (!wiresOnly && (!Array.isArray(candidate.components) || !candidate.components.length || candidate.components.some((c: any) => !c || typeof c.id !== 'string' || typeof c.type !== 'string' || !Number.isFinite(c.x) || !Number.isFinite(c.y))))) {
    throw new Error('AI returned an invalid design structure.');
  }
  return candidate;
}
