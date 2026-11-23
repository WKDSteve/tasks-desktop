import { describe, expect, it } from 'vitest';
import { hasBlock, needsResult, parseExercise } from './exercise';

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
