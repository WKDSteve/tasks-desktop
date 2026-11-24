// The detail of a task, its float and the quick capture, rendered on the server side of Svelte over a page that was not
// started: what they offer that needs the machine (the file in the editor, a screenshot to attach, a window of its
// own), and how the fields of the detail are laid out. The clicks, the editing and the places on the screen are looked
// at in the browser tests (e2e/floats.spec.ts).
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { Hub } from '../lib/api';
import { App, type Env } from '../lib/app.svelte';
import { task } from '../lib/fixtures';
import Capture from './Capture.svelte';
import PendingAttachments from './PendingAttachments.svelte';
import Detail from './Detail.svelte';
import DoneDialog from './DoneDialog.svelte';
import TaskDialog from './TaskDialog.svelte';

/** A page that was not started; `web` makes it the web variant, as `main.web.ts` does. */
function page(web: boolean, capabilities: string[] | null = null, more: Partial<Env> = {}): App {
  const none = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  const env: Env = {
    hub: {} as unknown as Hub,
    cache: { load: async () => null, save: async () => undefined, clear: async () => undefined },
    session: none,
    prefs: none,
    preferredLanguages: ['en'],
    now: () => 0,
    fetchFn: (async () => new Response('', { status: 503 })) as typeof fetch,
    sleep: async () => undefined,
    out: { save: () => true, copy: async () => true, print: () => true },
    ...(web ? { mode: 'web' as const } : {}),
    ...more,
  };
  const app = new App(env);
  app.tasks = [task('pub/a')];
  app.selectedId = 'pub/a';
  app.capabilities = capabilities;
  return app;
}
const strip = (body: string) => body.replace(/<!--.*?-->/g, '');
const detail = (app: App) => strip(render(Detail, { props: { app } }).body);
const capture = (app: App) => strip(render(Capture, { props: { app } }).body);
const float = (app: App) => strip(render(TaskDialog, { props: { app } }).body);
const pending = (app: App) => strip(render(PendingAttachments, { props: { app } }).body);

describe('the place of the AI functions in the detail', () => {
  it('is there only where ai-desktop is found and "Show AI functions" is on', () => {
    const app = page(false);
    expect(detail(app)).not.toContain('data-testid="ai-actions"');
    app.aiDesktop = { installed: true, running: false };
    expect(detail(app)).toContain('data-testid="ai-actions"');
    app.setAiWanted(false);
    expect(detail(app)).not.toContain('data-testid="ai-actions"');
    app.setAiWanted(true);
    app.aiDesktop = { installed: false, running: false };
    expect(detail(app)).not.toContain('data-testid="ai-actions"');
  });

  it('holds the button "Hand to an agent", like the buttons beside it, off with its reason while several tasks are marked', () => {
    const app = page(false);
    app.aiDesktop = { installed: false, running: true };
    const out = detail(app);
    expect(out).toMatch(/<button type="button" class="open-editor[^"]*" data-hint="Hands this task to ai-desktop[^"]*">Hand to an agent \.\.\.<\/button>/);
    app.marks = ['pub/a', 'pub/b'];
    expect(detail(app)).toMatch(/data-hint="Only one task at a time goes to an agent[^"]*" disabled="">Hand to an agent/);
  });

  it('offers "Prepare the decision" only for a task that waits for a decision, and only with the AI functions', () => {
    const app = page(false);
    app.tasks = [task('pub/a', { status: 'decision' })];
    expect(detail(app)).not.toContain('Prepare the decision');
    app.aiDesktop = { installed: true, running: true };
    expect(detail(app)).toMatch(/<button type="button" class="open-editor[^"]*" data-hint="An agent of ai-desktop prepares this decision[^"]*">Prepare the decision \.\.\.<\/button>/);
    app.tasks = [task('pub/a', { status: 'open' })];
    expect(detail(app)).not.toContain('Prepare the decision');
  });
});

describe('the fields of the detail', () => {
  it('give the title a line of its own, and the summary several lines', () => {
    const app = page(false);
    app.tasks = [task('pub/a', { summary: 'A summary' })];
    const out = detail(app);
    expect(out).toMatch(/<label class="line[^"]*"[^>]*><span[^>]*>Title<\/span>\s*<input/);
    expect(out).toMatch(/<label class="line[^"]*"[^>]*><span[^>]*>Summary<\/span>\s*<textarea[^>]*class="summary[^"]*"[^>]*rows="3"/);
    expect(out).toContain('>A summary</textarea>');
    // The choices from a few values share lines among themselves, not with the title.
    expect(out).toMatch(/<div class="picks[^"]*"><label/);
  });

  it('give the plan and the phase a line each, chosen from a list, not a cell among the choices', () => {
    const app = page(false);
    app.tasks = [task('pub/a', { plan: 'a-plan', phase: 'a-phase' })];
    const out = detail(app);
    const picks = out.slice(out.indexOf('<div class="picks'), out.indexOf('</div>', out.indexOf('<div class="picks')));
    expect(picks).not.toContain('>Plan</span>');
    expect(picks).not.toContain('>Phase</span>');
    // A plan that is not among the engine's plans is shown as written.
    expect(out).toMatch(/<div class="line pickfield[^"]*"><span[^>]*>Plan<\/span>\s*<button type="button"[^>]*data-field="plan"[^>]*aria-haspopup="listbox"[^>]*><span[^>]*>a-plan<\/span>/);
    expect(out).toMatch(/<div class="line pickfield[^"]*"><span[^>]*>Phase<\/span>\s*<button type="button"[^>]*data-field="phase"[^>]*><span[^>]*>a-phase<\/span>/);
    // Not a field to type a plan id into any more.
    expect(out).not.toContain('<input type="text" value="a-plan"');
  });

  it('end with the large Done button, after everything else of the card', () => {
    const out = detail(page(false));
    expect(out).toMatch(/<div class="finish-row[^"]*"><button type="button" class="finish[^"]*"[^>]*><span class="finish-icon[^"]*" aria-hidden="true">✓<\/span> Done<\/button>/);
    expect(out).not.toContain('Finish ...');
    expect(out.indexOf('class="finish-row')).toBeGreaterThan(out.indexOf('pub/ROADMAP/tasks/a.md'));
  });

  it('call it Erledigt in German', () => {
    const app = page(false);
    app.setLang('de');
    const out = detail(app);
    expect(out).toContain('✓</span> Erledigt</button>');
    expect(out).not.toContain('Erledigen');
  });
});

describe('a routine in the detail', () => {
  it('shows the interval and where the next round counts from', () => {
    const app = page(false, ['repeat']);
    app.tasks = [task('pub/a', { repeat: '8w', repeat_from: 'due' })];
    const out = detail(app);
    expect(out).toMatch(/<span[^>]*>Repeats<\/span>\s*<input type="text" value="8w"[^>]*data-field="repeat"/);
    expect(out).toMatch(/<select[^>]*data-field="repeat_from"/);
    expect(out).toMatch(/<option value="due"[^>]*selected[^>]*>its due date<\/option>/);
    // The engine's default needs no word, and `done` is not offered beside it as a second way of saying it.
    expect(out).toContain('the day it is finished (default)</option>');
    expect(out).not.toContain('<option value="done"');
  });

  it('offers the interval to a task that is no routine yet, but not where it counts from', () => {
    const out = detail(page(false, ['repeat']));
    expect(out).toMatch(/<input type="text" value=""[^>]*data-field="repeat"/);
    expect(out).not.toContain('data-field="repeat_from"');
  });

  it('is not offered where the engine has no routines, unless the file carries one', () => {
    const app = page(false, ['attach']);
    expect(detail(app)).not.toContain('data-field="repeat"');
    app.tasks = [task('pub/a', { repeat: '2w', repeat_from: 'done' })];
    const out = detail(app);
    expect(out).toContain('data-field="repeat"');
    expect(out).toMatch(/<option value="done"[^>]*selected[^>]*>the day it is finished<\/option>/);
  });

  it('says in the finish dialog when the next round is due', () => {
    const app = page(false, ['repeat']);
    app.finishing = { id: 'pub/a', preview: { kind: 'tasks.donepreview', id: 'pub/a', to: 'Backlog/TASKS', next_round: { due: '2027-01-05' } } as never };
    const out = strip(render(DoneDialog, { props: { app } }).body);
    expect(out).toContain('<li>A routine: the next round starts, due 2027-01-05.</li>');
    app.finishing = { id: 'pub/a', preview: { kind: 'tasks.donepreview', id: 'pub/a', to: 'Backlog/TASKS' } as never };
    expect(strip(render(DoneDialog, { props: { app } }).body)).not.toContain('next round');
  });
});

describe('a ladder and a routine that waits for a finish', () => {
  it('takes a ladder in the field Repeats and says the round the task is at', () => {
    const app = page(false, ['repeat', 'repeat_steps']);
    app.tasks = [task('pub/a', { repeat: '1w,4w,12w', repeat_step: 2 })];
    const out = detail(app);
    expect(out).toMatch(/<span[^>]*>Repeats ?<small data-repeat-round[^>]*>\(round 2 of 3\)<\/small><\/span>\s*<input type="text" value="1w,4w,12w"/);
    // Without `repeat_step` the ladder is at its first round; a single interval has no rounds to tell.
    app.tasks = [task('pub/a', { repeat: '1w,4w' })];
    expect(detail(app)).toContain('(round 1 of 2)');
    app.tasks = [task('pub/a', { repeat: '4w' })];
    expect(detail(app)).not.toContain('data-repeat-round');
  });

  it('shows what a routine waits for, with a way to it, until it has a due date', () => {
    const app = page(false, ['repeat', 'repeat_steps', 'paths']);
    app.tasks = [task('pub/a', { repeat: '1w,4w', repeat_after: 'pub/b' }), task('pub/b', { status: 'doing' })];
    let out = detail(app);
    expect(out).toContain('<h3>Starts once this is finished</h3>');
    expect(out).toMatch(/<p data-repeat-after[^>]*>\s*<button type="button" class="link[^"]*"><code[^>]*>pub\/b<\/code><\/button>/);
    expect(out).toContain('once this is finished, its first round is due 1w later.');
    // A point of a path: not a task of the list, so the link goes to the view of the paths.
    app.tasks = [task('pub/a', { repeat: '2w', repeat_after: 'pub/path#k1' })];
    out = detail(app);
    expect(out).toMatch(/<button type="button" class="link[^"]*"><code[^>]*>pub\/path#k1<\/code><\/button>/);
    // Without the view of the paths it is named, not linked.
    app.capabilities = ['repeat', 'repeat_steps'];
    expect(detail(app)).toMatch(/<p data-repeat-after[^>]*>\s*<code[^>]*>pub\/path#k1<\/code>/);
    // Started: the finish wrote its due date, nothing waits any more.
    app.tasks = [task('pub/a', { repeat: '2w', repeat_after: 'pub/path#k1', due: '2027-01-05' })];
    expect(detail(app)).not.toContain('data-repeat-after');
  });

  it('says in the finish dialog that the last round of a ladder ends the routine, instead of a next round', () => {
    const app = page(false, ['repeat', 'repeat_steps']);
    app.tasks = [task('pub/a', { repeat: '1w,4w,12w', repeat_step: 3 })];
    app.finishing = { id: 'pub/a', preview: { kind: 'tasks.donepreview', id: 'pub/a', to: 'Backlog/TASKS', ends_routine: true } as never };
    const out = strip(render(DoneDialog, { props: { app } }).body);
    expect(out).toMatch(/<li data-ends-routine[^>]*>\s*The last round of the routine \(1w, 4w, 12w\): it ends, no further round comes\.\s*<\/li>/);
    expect(out).not.toContain('next round starts');
  });
});

describe('the history and the end of a routine', () => {
  const doc = (more: Record<string, unknown>) =>
    ({ kind: 'tasks.task', task: task('pub/a', { repeat: '4w' }), body: '', body_truncated: false, steps: [], questions: [], ...more }) as never;

  it('lists the finished rounds, newest first, with the day, the due date, how it ended and the commits', () => {
    const app = page(false, ['repeat', 'rounds']);
    app.tasks = [task('pub/a', { repeat: '4w' })];
    app.detail = {
      state: 'ok',
      id: 'pub/a',
      doc: doc({
        rounds: [
          { id: 'pub/a-2026-02-01', done: '2026-02-02', due: '2026-02-01', status: 'done', commits: ['repo@abc1234', 'other@def5678'] },
          { id: 'pub/a', due: '2026-01-04', status: 'done', done_in: 'repo@0001111' },
        ],
      }),
    };
    const out = detail(app);
    expect(out).toContain('<h3>Earlier rounds</h3>');
    // Each part stands apart: a blank on both sides of the dot.
    expect(out).toMatch(/<li data-round="pub\/a-2026-02-01"[^>]*>\s*finished 2026-02-02 · due 2026-02-01 · done · <code[^>]*>repo@abc1234, other@def5678<\/code>/);
    expect(out).toMatch(/<li data-round="pub\/a"[^>]*>\s*finished \(no date\) · due 2026-01-04 · done · <code[^>]*>repo@0001111<\/code>/);
    expect(out.indexOf('pub/a-2026-02-01')).toBeLessThan(out.indexOf('data-round="pub/a"'));
    expect(out).not.toContain('Older rounds are not listed.');
    app.detail = { state: 'ok', id: 'pub/a', doc: doc({ rounds: [{ id: 'pub/a' }], rounds_truncated: true }) };
    expect(detail(app)).toContain('Older rounds are not listed.');
  });

  it('says that no round is finished yet, and shows no history for a task that is no routine', () => {
    const app = page(false, ['repeat', 'rounds']);
    app.tasks = [task('pub/a', { repeat: '4w' })];
    app.detail = { state: 'ok', id: 'pub/a', doc: doc({ rounds: [] }) };
    expect(detail(app)).toContain('No round of this routine has been finished yet.');
    app.tasks = [task('pub/a')];
    app.detail = { state: 'ok', id: 'pub/a', doc: doc({ task: task('pub/a') }) };
    expect(detail(app)).not.toContain('Earlier rounds');
  });

  it('warns beside Discard that discarding a routine ends it', () => {
    const app = page(false, ['append_note', 'ops']);
    app.tasks = [task('pub/a', { repeat: '4w' })];
    app.detail = { state: 'ok', id: 'pub/a', doc: doc({}) };
    expect(detail(app)).toContain('a routine: discarding it ends it, no further round comes');
    app.tasks = [task('pub/a')];
    expect(detail(app)).not.toContain('discarding it ends it');
  });
});

describe('the float of a task', () => {
  function peeking(view: 'list' | 'plan', more: Partial<Env> = {}): App {
    const app = page(false, null, more);
    app.view = view;
    app.peeking = true;
    return app;
  }

  it('has a handle to move it and offers "Show in the list" only over the other views', () => {
    const overList = float(peeking('list'));
    expect(overList).toContain('aria-label="Move or resize the window"');
    expect(overList).toContain('data-float-move');
    expect(overList).toContain('data-float-handle');
    expect(overList).not.toContain('Show in the list');
    expect(float(peeking('plan'))).toContain('Show in the list');
  });

  it('offers to detach the task where the page can open a window', () => {
    expect(float(peeking('list', { openWindow: () => true }))).toContain('aria-label="Open in a window of its own"');
    expect(float(peeking('list'))).not.toContain('Open in a window of its own');
  });
});

describe('the file of a task in the detail', () => {
  it('is offered to open in the editor where a hub runs', () => {
    const out = detail(page(false));
    expect(out).toContain('pub/ROADMAP/tasks/a.md');
    expect(out).toContain('Open in Neovim');
  });

  it('is shown but not offered to open in the web variant, which has no editor to start', () => {
    const out = detail(page(true));
    expect(out).toContain('pub/ROADMAP/tasks/a.md');
    expect(out).not.toContain('Neovim');
  });
});

describe('a screenshot to attach', () => {
  it('is offered in the detail and the capture where a hub runs and the engine can attach', () => {
    const out = detail(page(false, ['attach']));
    // Three buttons: a file at once, a choice for a video, a choice for an image (with the clipboard of the hub in it).
    expect(out).toContain('Attach to this task');
    expect(out).toContain('Attach file');
    for (const entry of ['Upload a video', 'Record a video', 'Upload an image', 'Take a photo', 'Take a screenshot', 'From the clipboard of the hub']) {
      expect(out).toContain(entry);
    }
    // Drawn outside a browser nothing can be taken: the entries say so instead of being left out.
    expect(out).toContain('This browser cannot do it here.');
    // The capture loads the part when it can be used (outside the main chunk); the part offers files and the screenshot.
    expect(pending(page(false, ['attach']))).toContain('Attach a screenshot');
    expect(pending(page(false, ['attach']))).toContain('Files from this computer');
  });

  it('is not offered where the engine cannot attach', () => {
    expect(detail(page(false, []))).not.toContain('Attach to this task');
    expect(capture(page(false, []))).not.toContain('Attach a screenshot');
    expect(pending(page(false, []))).not.toContain('Attach a screenshot');
  });

  it('is not offered in the web variant even when the engine says it can: there is no clipboard or screenshot folder of a machine to take it from', () => {
    expect(detail(page(true, ['attach']))).not.toContain('Attach to this task');
    expect(capture(page(true, ['attach']))).not.toContain('Attach a screenshot');
    expect(pending(page(true, ['attach']))).not.toContain('Attach a screenshot');
    expect(page(true, ['attach']).canAttach).toBe(false);
  });
});

describe('the test sheets of a task', () => {
  const BODY = [
    'Check it by eye.',
    '',
    '<!-- testing:sheets:begin -->',
    '## Test sheets',
    '',
    '- **Web sheet** (`web.sheet`, `ui.nvim/TESTS/sheets/web.sheet.lua`): automated part green, waiting for your judgement',
    '  - Judge:',
    '    - [ ] The border is drawn',
    '- **Red sheet** (`red.sheet`, `ui.nvim/TESTS/sheets/red.sheet.lua`): red',
    '<!-- testing:sheets:states web.sheet=inbox red.sheet=red -->',
    '<!-- testing:sheets:end -->',
    '',
  ].join('\n');
  const doc = (body: string) =>
    ({ kind: 'tasks.task', task: task('pub/a'), body, body_truncated: false, steps: [], questions: [] }) as never;

  it('lists the sheets the last report wrote into the task, with their state, and runs none', () => {
    for (const web of [true, false]) {
      const app = page(web);
      app.detail = { state: 'ok', id: 'pub/a', doc: doc(BODY) };
      const out = detail(app);
      expect(out).toContain('<h3>Test sheets</h3>');
      expect(out).toMatch(/<span class="sheet-title[^"]*">Web sheet<\/span>\s*<code[^>]*>web\.sheet<\/code>\s*<span class="muted[^"]*">green, waiting for your judgement<\/span>/);
      expect(out).toMatch(/<span class="sheet-title[^"]*">Red sheet<\/span>\s*<code[^>]*>red\.sheet<\/code>\s*<span class="muted[^"]*">red<\/span>/);
      expect(out).not.toContain('Run the test sheet');
      // Only the web variant says where a run goes: the page of the hub has it at hand.
      expect(out.includes('is run from tasks mobile or from the hub on the PC')).toBe(web);
    }
  });

  it('shows a state it does not know as written, also one that is a name of every object', () => {
    const app = page(true);
    const odd = BODY.replace('web.sheet=inbox red.sheet=red', 'web.sheet=constructor red.sheet=toString');
    app.detail = { state: 'ok', id: 'pub/a', doc: doc(odd) };
    const out = detail(app);
    expect(out).toMatch(/>web\.sheet<\/code>\s*<span class="muted[^"]*">constructor<\/span>/);
    expect(out).toMatch(/>red\.sheet<\/code>\s*<span class="muted[^"]*">toString<\/span>/);
  });

  it('shows no section for a task without the block of a report', () => {
    const app = page(true);
    app.detail = { state: 'ok', id: 'pub/a', doc: doc('Just text.') };
    expect(detail(app)).not.toContain('Test sheets');
  });
});
