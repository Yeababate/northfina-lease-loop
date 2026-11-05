import { describe, expect, it } from 'vitest';
import { divideRoundHalfUp, toScaledInteger } from './rounding';

describe('divideRoundHalfUp', () => {
  it('rounds exactly half up', () => {
    expect(divideRoundHalfUp(7, 2)).toBe(4);
    expect(divideRoundHalfUp(2_736_150, 1000)).toBe(2736); // 2736.15 → 2736
    expect(divideRoundHalfUp(2_736_500, 1000)).toBe(2737); // 2736.5 → 2737
  });

  it('rounds below half down', () => {
    expect(divideRoundHalfUp(5, 3)).toBe(2);
    expect(divideRoundHalfUp(10_730_176_000, 1_000_000)).toBe(10_730);
  });

  it('returns exact quotients unchanged, including zero', () => {
    expect(divideRoundHalfUp(5_835_000, 100)).toBe(58_350);
    expect(divideRoundHalfUp(0, 7)).toBe(0);
  });

  it('throws on inputs that are bugs in the caller', () => {
    expect(() => divideRoundHalfUp(1.5, 2)).toThrow(RangeError);
    expect(() => divideRoundHalfUp(-1, 2)).toThrow(RangeError);
    expect(() => divideRoundHalfUp(1, 0)).toThrow(RangeError);
    expect(() => divideRoundHalfUp(2 ** 53, 2)).toThrow(RangeError);
  });
});

describe('toScaledInteger', () => {
  it('turns factors and percentages into whole units', () => {
    expect(toScaledInteger(0.027584, 1_000_000)).toBe(27_584);
    expect(toScaledInteger(25.5, 10)).toBe(255);
    expect(toScaledInteger(26, 10)).toBe(260);
  });

  it('tolerates binary floating-point noise', () => {
    expect(toScaledInteger(0.1 + 0.2, 10)).toBe(3);
  });

  it('refuses to drop digits', () => {
    expect(() => toScaledInteger(25.55, 10)).toThrow(RangeError);
    expect(() => toScaledInteger(0.0275845, 1_000_000)).toThrow(RangeError);
  });
});
