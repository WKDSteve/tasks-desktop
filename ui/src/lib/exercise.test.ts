import { describe, expect, it } from 'vitest';
import { hasBlock, needsResult, parseExercise, withResult } from './exercise';

const BLOCK = [
  '**Aufgabe:** Lege in `~/cli-uebung` drei Dateien an',
  'und zeige sie mit `ls -l` an.',
  '**Fertig, wenn:** Du kannst sagen, was jede Option zeigt.',
  '**Nachweis:** Füge die Ausgabe von `ls -lh` ein.',
  '**Ergebnis:**',
].join('\n');

describe('parseExercise', () => {
  it('takes the four parts apart, a part running over several lines until the next label', () => {
    expect(parseExercise(BLOCK)).toEqual({
      aufgabe: 'Lege in `~/cli-uebung` drei Dateien an und zeige sie mit `ls -l` an.',
      fertig: 'Du kannst sagen, was jede Option zeigt.',
      nachweis: 'Füge die Ausgabe von `ls -lh` ein.',
      ergebnis: '',
    });
  });
  it('ignores text before the first label, unknown labels and carriage returns', () => {
    const note = 'vorab\r\n**Aufgabe:** a\r\n**Tipp:** x\r\nweiter\r\n**Nachweis:** n';
    expect(parseExercise(note)).toEqual({ aufgabe: 'a', nachweis: 'n' });
  });
  it('gives nothing for a plain note or none', () => {
    expect(parseExercise('Rangfolge merken')).toEqual({});
    expect(parseExercise(undefined)).toEqual({});
    expect(hasBlock('Rangfolge merken')).toBe(false);
    expect(hasBlock(BLOCK)).toBe(true);
  });
});

describe('needsResult', () => {
  it('is true with a proof asked for and no result', () => {
    expect(needsResult(BLOCK)).toBe(true);
    expect(needsResult(BLOCK.replace('**Ergebnis:**', '**Ergebnis:** drwx'))).toBe(false);
  });
  it('is false without a Nachweis line or without a block', () => {
    expect(needsResult('**Aufgabe:** a\n**Ergebnis:**')).toBe(false);
    expect(needsResult('plain')).toBe(false);
  });
});

describe('withResult', () => {
  it('fills an empty result line and keeps every other line', () => {
    expect(withResult(BLOCK, '  total 12  ')).toBe(BLOCK.replace('**Ergebnis:**', '**Ergebnis:** total 12'));
  });
  it('replaces a result with its continuation lines, several lines allowed', () => {
    const had = `${BLOCK} alt\nzweite Zeile`;
    expect(withResult(had, 'neu\nmehr')).toBe(`${BLOCK} neu\nmehr`);
  });
  it('adds the line when the block has none, and clears it with an empty text', () => {
    const without = BLOCK.replace('\n**Ergebnis:**', '');
    expect(withResult(without, 'x')).toBe(`${without}\n**Ergebnis:** x`);
    expect(withResult(`${BLOCK} alt`, '')).toBe(BLOCK);
  });
  it('refuses a note without a block and a text with a control character', () => {
    expect(withResult('plain', 'x')).toBeNull();
    expect(withResult(BLOCK, 'a\u0007b')).toBeNull();
  });
});
