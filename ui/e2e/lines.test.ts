import { describe, expect, it } from 'vitest';
import { completeLines } from './lines';

describe('completeLines', () => {
  it('leaves a line that is still being written for the next look', () => {
    const whole = '--open-at\tE:/repos/docmap-e2e\tlua/a.lua:3-9\n';
    const half = '--open-at\tE:/repos/doc';
    expect(completeLines(whole + half)).toEqual(['--open-at\tE:/repos/docmap-e2e\tlua/a.lua:3-9']);
    // Each line it gives is one the writer finished: all its fields are there.
    expect(completeLines(whole + half).map((l) => l.split('\t').length)).toEqual([3]);
    expect(completeLines(`${whole}${half}map-e2e\tlua/b.lua:1-1\n`)).toHaveLength(2);
  });

  it('gives nothing for an empty log or one whose first line is not finished', () => {
    expect(completeLines('')).toEqual([]);
    expect(completeLines('reveal C:/pa')).toEqual([]);
  });

  it('skips empty lines and the carriage return of a line', () => {
    expect(completeLines('x\r\n\ny\n')).toEqual(['x', 'y']);
  });
});
