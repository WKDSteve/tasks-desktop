// The minutes: a typed line read into entries by its shortcut, the lines of `## Protokoll` read back with their time and
// kind, a plain line turned into another kind, the shortcuts and the drafts as this browser keeps them.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHORTCUTS,
  captureOp,
  capturesOf,
  convertOps,
  draftsOf,
  minutesHeading,
  minutesOf,
  parseShortcuts,
} from './minutes';

describe('capturesOf', () => {
  it('reads the kind from the shortcut at the start, in any case', () => {
    expect(capturesOf('A: Folien schicken')).toEqual([{ kind: 'task', text: 'Folien schicken' }]);
    expect(capturesOf('b: Release am Montag')).toEqual([{ kind: 'decision', text: 'Release am Montag' }]);
    expect(capturesOf('F: Wer testet')).toEqual([{ kind: 'question', text: 'Wer testet' }]);
    expect(capturesOf('Nur eine Notiz')).toEqual([{ kind: 'text', text: 'Nur eine Notiz' }]);
  });

  it('makes a question of a line that ends with a question mark', () => {
    expect(capturesOf('Gibt es schon einen Termin?')).toEqual([{ kind: 'question', text: 'Gibt es schon einen Termin?' }]);
  });

  it('gives a task for each part of a checklist, and keeps the mark of an important line', () => {
    expect(capturesOf('[] Raum; Beamer ;; Kaffee')).toEqual([
      { kind: 'task', text: 'Raum' },
      { kind: 'task', text: 'Beamer' },
      { kind: 'task', text: 'Kaffee' },
    ]);
    expect(capturesOf('! Budget ist gestrichen')).toEqual([{ kind: 'text', text: '! Budget ist gestrichen' }]);
  });

  it('gives nothing for an empty line or a shortcut alone, and one line for several typed ones', () => {
    expect(capturesOf('   ')).toEqual([]);
    expect(capturesOf('A:')).toEqual([]);
    expect(capturesOf('[]')).toEqual([]);
    expect(capturesOf('eins\nzwei')).toEqual([{ kind: 'text', text: 'eins zwei' }]);
  });

  it('takes the shortcuts the person chose', () => {
    const s = parseShortcuts(JSON.stringify({ task: 'TODO', decision: '=>' }));
    expect(capturesOf('todo Bericht', s)).toEqual([{ kind: 'task', text: 'Bericht' }]);
    expect(capturesOf('=> so machen wir es', s)).toEqual([{ kind: 'decision', text: 'so machen wir es' }]);
    expect(capturesOf('A: kein Kürzel mehr', s)).toEqual([{ kind: 'text', text: 'A: kein Kürzel mehr' }]);
  });
});

describe('parseShortcuts', () => {
  it('falls back to the defaults for what is broken, empty, too long, has a space or is taken twice', () => {
    expect(parseShortcuts(null)).toEqual(DEFAULT_SHORTCUTS);
    expect(parseShortcuts('{not json')).toEqual(DEFAULT_SHORTCUTS);
    expect(parseShortcuts(JSON.stringify({ task: '', decision: 'way-too-long', question: 'a b' }))).toEqual(DEFAULT_SHORTCUTS);
    // two kinds never share a word
    expect(parseShortcuts(JSON.stringify({ task: 'X:', decision: 'x:' }))).toEqual({ ...DEFAULT_SHORTCUTS, task: 'X:' });
    expect(parseShortcuts(JSON.stringify({ task: 'B:' }))).toEqual(DEFAULT_SHORTCUTS);
  });
});

describe('captureOp', () => {
  it('is an append without if_match, with the time when given', () => {
    expect(captureOp('pub/m', { kind: 'task', text: 'Mail' }, '10:05')).toEqual({
      op: 'meeting_capture',
      id: 'pub/m',
      entry: { kind: 'task', text: 'Mail', at: '10:05' },
    });
    expect(captureOp('pub/m', { kind: 'photo', text: '', asset: 'assets/images/a.png' })).toEqual({
      op: 'meeting_capture',
      id: 'pub/m',
      entry: { kind: 'photo', asset: 'assets/images/a.png' },
    });
  });
});

const BODY = [
  'Kurz.',
  '',
  '## Protokoll',
  '',
  '- 10:05 Aufgabe: Mail an Kim',
  '- 09:40 Folie fehlt',
  '- 10:05 Beschluss: Release Montag',
  '- 10:07 ! Budget gestrichen',
  '- 10:09 ![Tafel](assets/images/tafel.png)',
  '- 10:10 [Audio: note.m4a](assets/audio/note.m4a)',
  '- 10:11 Frage: Wer testet?',
  '',
  '## Beschlüsse',
  '',
  '- Release Montag',
  '',
].join('\n');

describe('minutesOf', () => {
  it('reads every line with its time and kind, in the order of time (one minute in the order written)', () => {
    const lines = minutesOf(BODY);
    expect(lines.map((l) => [l.at, l.kind, l.text, l.marked])).toEqual([
      ['09:40', 'text', 'Folie fehlt', false],
      ['10:05', 'task', 'Mail an Kim', false],
      ['10:05', 'decision', 'Release Montag', false],
      ['10:07', 'text', 'Budget gestrichen', true],
      ['10:09', 'image', 'Tafel', false],
      ['10:10', 'audio', 'note.m4a', false],
      ['10:11', 'question', 'Wer testet?', false],
    ]);
    expect(lines[4]?.asset).toBe('assets/images/tafel.png');
    expect(lines[0]?.n).toBe(2);
  });

  it('reads the English minutes, and nothing without them', () => {
    const en = '## Minutes\n\n- 08:00 Task: Send slides\n- 08:01 Decision: Ship\n';
    expect(minutesHeading(en)).toBe('Minutes');
    expect(minutesOf(en).map((l) => l.kind)).toEqual(['task', 'decision']);
    expect(minutesOf('## Agenda\n\n- [ ] x\n')).toEqual([]);
  });
});

describe('convertOps', () => {
  it('takes the line out of the minutes and captures it again as the other kind with its time, in one request', () => {
    const line = minutesOf(BODY).find((l) => l.text === 'Folie fehlt');
    expect(line).toBeDefined();
    const ops = convertOps('pub/m', BODY, line!, 'task', 'sha256:x');
    expect(ops).toEqual([
      {
        op: 'set_section',
        id: 'pub/m',
        heading: '## Protokoll',
        text: [
          '- 10:05 Aufgabe: Mail an Kim',
          '- 10:05 Beschluss: Release Montag',
          '- 10:07 ! Budget gestrichen',
          '- 10:09 ![Tafel](assets/images/tafel.png)',
          '- 10:10 [Audio: note.m4a](assets/audio/note.m4a)',
          '- 10:11 Frage: Wer testet?',
        ].join('\n'),
        if_match: 'sha256:x',
      },
      { op: 'meeting_capture', id: 'pub/m', entry: { kind: 'task', text: 'Folie fehlt', at: '09:40' } },
    ]);
  });

  it('keeps the comments of the minutes, which the page does not show, when it writes them back', () => {
    const body = '## Protokoll\n\n<!-- a note of mine -->\n- 09:40 Folie fehlt\n- 09:41 Weiter\n';
    const line = minutesOf(body).find((l) => l.text === 'Folie fehlt')!;
    const ops = convertOps('pub/m', body, line, 'task', undefined);
    expect(ops?.[0]).toMatchObject({ op: 'set_section', text: '<!-- a note of mine -->\n- 09:41 Weiter' });
  });

  it('turns only a plain line, and nothing when the line is no longer there as read', () => {
    const lines = minutesOf(BODY);
    expect(convertOps('pub/m', BODY, lines.find((l) => l.kind === 'task')!, 'decision', undefined)).toBeNull();
    expect(convertOps('pub/m', BODY, lines.find((l) => l.marked)!, 'task', undefined)).toBeNull();
    const plain = lines.find((l) => l.text === 'Folie fehlt')!;
    expect(convertOps('pub/m', BODY.replace('Folie fehlt', 'Folie da'), plain, 'task', undefined)).toBeNull();
  });
});

describe('draftsOf', () => {
  it('keeps what reads as drafts of a meeting id, and drops the rest', () => {
    const raw = JSON.stringify({
      'pub/m': [
        { kind: 'task', text: 'Mail', at: '10:00' },
        { kind: 'photo', text: 'x', at: '10:00' },
        { kind: 'text', text: 'ohne Zeit' },
      ],
      'no-id': [{ kind: 'text', text: 'x', at: '10:00' }],
      'pub/empty': [],
    });
    expect(draftsOf(raw)).toEqual({ 'pub/m': [{ kind: 'task', text: 'Mail', at: '10:00' }] });
    expect(draftsOf('[1,2]')).toEqual({});
    expect(draftsOf('{broken')).toEqual({});
  });
});
