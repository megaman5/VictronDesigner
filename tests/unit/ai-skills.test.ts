import { describe, it, expect } from 'vitest';
import { getSkill, listSkills, systemDesignSkill, wireComponentsSkill } from '../../server/ai/skills';
import { terminalIdsFragment, componentDimensionsFragment } from '../../server/ai/skills/fragments';
import { TERMINAL_CONFIGS } from '../../client/src/lib/terminal-config';

describe('Skill registry', () => {
  it('exposes versioned skills', () => {
    const skills = listSkills();
    expect(skills.map(s => s.id).sort()).toEqual(['system-design', 'wire-components']);
    for (const s of skills) expect(s.version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it('throws helpfully on an unknown skill', () => {
    expect(() => getSkill('nope')).toThrow(/Unknown skill/);
  });

  it('builds a system prompt containing the shared rules', () => {
    const prompt = systemDesignSkill.buildSystemPrompt({ systemVoltage: 24 });
    expect(prompt).toContain('24V DC');
    expect(prompt).toContain('EXACT TERMINAL IDS');
    expect(prompt).toContain('OVERCURRENT PROTECTION');
    expect(prompt).toContain('AC OUTPUT VOLTAGE');
  });

  it('folds validation feedback into the user prompt for a retry', () => {
    const plain = systemDesignSkill.buildUserPrompt('build a van', { systemVoltage: 12 });
    expect(plain).toBe('build a van');

    const retry = systemDesignSkill.buildUserPrompt('build a van', {
      systemVoltage: 12,
      feedback: 'Wire gauge too small on w1',
    });
    expect(retry).toContain('build a van');
    expect(retry).toContain('Wire gauge too small');
  });

  it('includes the existing design in the wiring skill prompt', () => {
    const prompt = wireComponentsSkill.buildUserPrompt('wire these up', {
      systemVoltage: 12,
      existingDesign: { components: [{ id: 'b1', type: 'battery' }], wires: [] },
    });
    expect(prompt).toContain('b1');
    expect(prompt).toContain('battery');
  });
});

describe('Generated prompt fragments', () => {
  it('lists every component type from TERMINAL_CONFIGS', () => {
    const fragment = terminalIdsFragment();
    const types = Object.keys(TERMINAL_CONFIGS).filter(t => t !== 'custom');
    for (const type of types) {
      expect(fragment, `missing ${type}`).toContain(`- ${type}:`);
    }
  });

  it('includes every Lynx terminal id automatically', () => {
    const fragment = terminalIdsFragment();
    // The bug this prevents: Lynx was documented in one prompt section but not
    // the terminal list, so the model invented "dc-positive".
    for (const id of ['main-positive', 'bus-out-positive', 'batt-positive', 'system-positive', 'allow-to-charge']) {
      expect(fragment).toContain(`"${id}"`);
    }
    expect(fragment).toContain('lynx-smart-bms');
  });

  it('warns against the exact ids the model tends to invent', () => {
    const fragment = terminalIdsFragment();
    expect(fragment).toContain('dc-positive');
    expect(fragment).toContain('Never invent');
  });

  it('flags the battery/system side distinction on shunt devices', () => {
    const fragment = terminalIdsFragment();
    expect(fragment).toContain('not interchangeable');
  });

  it('notes the conditional MPPT load terminals', () => {
    const fragment = terminalIdsFragment();
    expect(fragment).toContain('load-positive');
    expect(fragment).toContain('100|20');
  });

  it('generates dimensions matching the terminal config', () => {
    const fragment = componentDimensionsFragment();
    const cfg = TERMINAL_CONFIGS['lynx-smart-bms'];
    expect(fragment).toContain(`- lynx-smart-bms: ${cfg.width}×${cfg.height}px`);
  });
});
