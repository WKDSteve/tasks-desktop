import { describe, expect, it } from 'vitest';
import { decimalText, percentText } from './numbers';

describe('numbers in the language of the page', () => {
  it('a percent: German puts a (no-break) space before the sign, English none', () => {
    expect(percentText('de', 0.75).replace(/\s/g, ' ')).toBe('75 %');
    expect(percentText('en', 0.75)).toBe('75%');
    expect(percentText('en', 0.666)).toBe('67%');
  });

  it('a decimal: comma in German, point in English, at most two places', () => {
    expect(decimalText('de', 1.5)).toBe('1,5');
    expect(decimalText('en', 1.5)).toBe('1.5');
    expect(decimalText('en', 1.2345)).toBe('1.23');
    expect(decimalText('de', 1234.5)).toBe('1.234,5');
  });
});
