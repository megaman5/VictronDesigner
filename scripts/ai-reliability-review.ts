import 'dotenv/config';
import fs from 'node:fs';
import { AISession } from '../server/ai/fallback';
import { wireComponentsSkill } from '../server/ai/skills';
import { AI_REGRESSION_CASES } from '../server/ai/benchmark/regression-cases';
import { parseAIDesign } from '../server/ai/parse-design';
import { normalizeAIDesign } from '../server/ai-design-normalizer';
import { validateDesign } from '../server/design-validator';
import { annotateCandidate, createRequirementContext } from '../server/ai/requirements';

// Synthetic fixtures only. Use the same OpenAI-compatible provider path as production.
const results: any[] = [];
for (const effort of [undefined, 'low'] as const) {
  for (const id of ['inverter-ac', 'solar-mppt', 'lynx-distribution']) {
    const fixture = AI_REGRESSION_CASES.find(c => c.id === id)!;
    const started = Date.now();
    const session = new AISession('gemini-3.8-flash');
    session.signal = AbortSignal.timeout(120_000);
    try {
      const context = { systemVoltage: fixture.systemVoltage, existingDesign: { components: fixture.existingComponents!, wires: fixture.existingWires ?? [] } };
      const response = await session.create({ model: session.model, response_format: { type: 'json_object' }, max_completion_tokens: 32_000,
        ...(effort ? { reasoning_effort: effort } : {}),
        messages: [{ role: 'system', content: wireComponentsSkill.buildSystemPrompt(context) }, { role: 'user', content: wireComponentsSkill.buildUserPrompt(fixture.prompt, context) }] });
      const parsed = parseAIDesign(response.choices[0].message.content ?? '', true);
      const design = normalizeAIDesign(fixture.existingComponents! as any, parsed.wires.map((w: any, i: number) => ({ ...w, id: `review-${i}` })), fixture.systemVoltage, { existingWires: fixture.existingWires as any ?? [] });
      const candidate = annotateCandidate({ ...design, validation: validateDesign(design.components, design.wires, fixture.systemVoltage) }, createRequirementContext({ ...context, components: fixture.existingComponents, wires: fixture.existingWires, requirements: fixture.requirements, prompt: fixture.prompt }));
      results.push({ caseId: id, effort: effort ?? 'default', durationMs: Date.now() - started, runStatus: candidate.runStatus, score: candidate.validation.score, repairs: design.repairs.length, usage: response.usage, routing: session.metadata.aiRouting });
    } catch (error: any) { results.push({ caseId: id, effort: effort ?? 'default', durationMs: Date.now() - started, error: error.message }); }
    console.log(JSON.stringify(results[results.length - 1]));
  }
}
fs.mkdirSync('docs/testing/ai-reliability-2026-10-09', { recursive: true });
fs.writeFileSync('docs/testing/ai-reliability-2026-10-09/provider-experiment.json', JSON.stringify(results, null, 2));
