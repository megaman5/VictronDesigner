import { describe, it, expect } from 'vitest';
import {
  FUSE_TYPES,
  getFuseType,
  getFuseRatings,
  smallestRatingFor,
  suggestFuseType,
} from '@shared/protection-devices';
import {
  getACVoltage,
  getInverterACVoltage,
  getSupportedACVoltages,
  isSplitPhase,
} from '@shared/ac-voltage';

describe('Protection device catalog', () => {
  it('defaults to Class T for a fuse with no type set', () => {
    expect(getFuseType({ properties: { fuseRating: 400 } })).toBe('class-t');
    expect(getFuseRatings({ properties: {} })).toEqual(FUSE_TYPES['class-t'].ratings);
  });

  it('offers small ratings for blade fuses', () => {
    const ratings = getFuseRatings({ properties: { fuseType: 'blade' } });
    expect(ratings[0]).toBeLessThanOrEqual(5);
    expect(Math.max(...ratings)).toBeLessThanOrEqual(40);
  });

  it('picks the smallest catalog rating at or above the load', () => {
    expect(smallestRatingFor('blade', 12)).toBe(15);
    expect(smallestRatingFor('class-t', 260)).toBe(300);
  });

  it('returns null when the family cannot cover the current', () => {
    expect(smallestRatingFor('blade', 200)).toBeNull();
  });

  it('suggests a family that matches the circuit size', () => {
    expect(suggestFuseType(10, false)).toBe('blade');
    expect(suggestFuseType(100, false)).toBe('midi');
    expect(suggestFuseType(250, false)).toBe('mega');
    expect(suggestFuseType(400, true)).toBe('class-t');
  });

  it('marks only high-interrupt families as suitable for a lithium main', () => {
    expect(FUSE_TYPES['class-t'].suitableForLithiumMain).toBe(true);
    expect(FUSE_TYPES['mrbf'].suitableForLithiumMain).toBe(true);
    expect(FUSE_TYPES['mega'].suitableForLithiumMain).toBe(false);
    expect(FUSE_TYPES['blade'].suitableForLithiumMain).toBe(false);
  });
});

describe('AC output voltage', () => {
  const inverter = (acOutputVoltage?: string) => ({
    type: 'multiplus',
    properties: acOutputVoltage ? { acOutputVoltage } : {},
  });

  it('defaults to 120V when nothing is set', () => {
    expect(getInverterACVoltage(inverter())).toBe(120);
  });

  it('reports 240V for a split-phase inverter', () => {
    expect(getInverterACVoltage(inverter('split-120-240'))).toBe(240);
    expect(isSplitPhase(inverter('split-120-240'))).toBe(true);
  });

  it('lets a split-phase inverter feed both 120V and 240V loads', () => {
    const supported = getSupportedACVoltages(inverter('split-120-240'));
    expect(supported).toContain(120);
    expect(supported).toContain(240);
  });

  it('keeps 120V and 230V systems separate', () => {
    expect(getSupportedACVoltages(inverter('120'))).toEqual([110, 120]);
    expect(getSupportedACVoltages(inverter('230'))).toEqual([220, 230, 240]);
  });

  it('reads acVoltage from a plain AC load', () => {
    expect(getACVoltage({ type: 'ac-load', properties: { acVoltage: 240 } })).toBe(240);
    expect(getACVoltage({ type: 'ac-load', properties: {} })).toBe(120);
  });

  it('prefers the source setting over a stray voltage property', () => {
    expect(
      getACVoltage({ type: 'multiplus', properties: { acOutputVoltage: '230', voltage: 24 } })
    ).toBe(230);
  });
});
