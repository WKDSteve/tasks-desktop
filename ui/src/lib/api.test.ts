import { describe, expect, it } from 'vitest';
import { Hub, learnQuery } from './api';

/** A fetch that answers each call with the next response, after the next gate. */
function scripted(steps: { status: number; gate?: Promise<void> }[], sent: (auth: string | null) => void): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    sent(new Headers(init?.headers).get('Authorization'));
    const step = steps.shift() ?? { status: 200 };
    if (step.gate) await step.gate;
    return new Response('{}', { status: step.status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

describe('the hub client and a refusal', () => {
  it('tells the page the session is gone when the token that was sent is the one it holds', async () => {
    const hub = new Hub(scripted([{ status: 401 }], () => undefined));
    hub.setToken('old');
    let told = 0;
    hub.onUnauthorized = () => (told += 1);
    await expect(hub.areas()).rejects.toBeDefined();
    expect(told).toBe(1);
  });

  it('ignores a late refusal of a question asked with a token that is no longer the one held', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const seen: (string | null)[] = [];
    const hub = new Hub(scripted([{ status: 401, gate }], (a) => seen.push(a)));
    hub.setToken('old');
    let told = 0;
    hub.onUnauthorized = () => (told += 1);
    const late = hub.areas().catch(() => undefined);
    // The page got a fresh session while the old question was on its way.
    hub.setToken('fresh');
    release();
    await late;
    expect(seen).toEqual(['Bearer old']);
    expect(told).toBe(0);
  });
});

describe('the finished tasks', () => {
  it('asks for the CI states as words joined by dots: a query value of the hub is plain text, without a comma', async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: unknown) => {
      urls.push(String(url));
      const doc = { kind: 'tasks.finished', total: 0, offset: 0, limit: 1, items: [], undated: 0 };
      return new Response(JSON.stringify(doc), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const hub = new Hub(fetchFn);
    await hub.finished({ ci: ['pending', 'red'], limit: 1 });
    await hub.finished({ area: 'lib.nvim', plan: 'a/p', since: '2026-01-01' });
    expect(urls).toEqual(['/api/tasks/finished?ci=pending.red&limit=1', '/api/tasks/finished?area=lib.nvim&plan=a/p&since=2026-01-01']);
    // what the hub refuses as not plain: no character outside letters, digits and . _ - /
    expect(urls[0]).toMatch(/^[^?]*\?([A-Za-z0-9._/-]+=[A-Za-z0-9._/-]+&?)+$/);
  });
});

describe('the reads of the tab Lernpläne', () => {
  it('escape the search text as a whole and keep the slash of an id, a flag as 1, nothing for an empty value', () => {
    expect(learnQuery({})).toBe('');
    expect(learnQuery({ q: 'a/b & c?', kind: 'note', path: 'lib.nvim/lua', include_done: true, limit: 50 })).toBe(
      '?q=a%2Fb%20%26%20c%3F&kind=note&path=lib.nvim/lua&include_done=1&limit=50',
    );
    expect(learnQuery({ q: '', include_done: false, area: undefined })).toBe('');
  });

  it('ask the routes of their name', async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: unknown) => {
      urls.push(String(url));
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const hub = new Hub(fetchFn);
    await hub.learnNext({ machine: 'wsl', n: 3 });
    await hub.learnNotes({ q: 'shell' });
    await hub.learnEvidence();
    await hub.learnHistory({ step: 'week' });
    await hub.competences({ area: 'ALL' });
    await hub.pathsWithLevels();
    expect(urls).toEqual([
      '/api/tasks/learn_next?machine=wsl&n=3',
      '/api/tasks/learn_notes?q=shell',
      '/api/tasks/learn_evidence',
      '/api/tasks/learn_history?step=week',
      '/api/tasks/competences?area=ALL',
      '/api/tasks/paths?levels=1',
    ]);
  });
});

describe('the order of the list', () => {
  it('asks the hub once and gives the ids in the order the engine named them', async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: unknown) => {
      urls.push(String(url));
      const doc = { kind: 'tasks.order', sort: 'roi', total: 3, ids: ['a/3', 'a/1', 'a/2'], incomplete: [] };
      return new Response(JSON.stringify(doc), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const hub = new Hub(fetchFn);
    expect((await hub.order('roi')).ids).toEqual(['a/3', 'a/1', 'a/2']);
    expect(urls).toEqual(['/api/tasks/order?sort=roi']);
  });

  it('passes a refusal of the hub on', async () => {
    const hub = new Hub((async () => new Response('{}', { status: 400 })) as typeof fetch);
    await expect(hub.order('roi')).rejects.toBeDefined();
  });
});

describe('what the hub says about itself', () => {
  const answering = (doc: unknown): typeof fetch =>
    (async () => new Response(JSON.stringify(doc), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

  it('takes the mode of the web variant over, and has none when the hub names none', async () => {
    const web = await new Hub(answering({ version: '1', os: 'web', arch: 'wasm', mode: 'web', engine: { nvim: 'web+Lua5.4' } })).about();
    expect(web.mode).toBe('web');
    expect(web.engine?.nvim).toBe('web+Lua5.4');
    expect((await new Hub(answering({ version: '1', os: 'windows', arch: 'x86_64' })).about()).mode).toBeNull();
    expect((await new Hub(answering({ version: '1', mode: 3 })).about()).mode).toBeNull();
  });
});

describe('the images of a container', () => {
  it('asks for a file with a space or a letter of any language percent-encoded, its folders as they are', async () => {
    const urls: string[] = [];
    const hub = new Hub((async (url: unknown) => {
      urls.push(String(url));
      return new Response('png', { status: 200, headers: { 'Content-Type': 'image/png' } });
    }) as typeof fetch);
    expect(await hub.asset('task', 'a/t', 'assets/mein bild.png')).not.toBeNull();
    await hub.asset('path', 'a/p', 'assets/images/übersicht.svg');
    expect(urls.map((u) => u.slice(u.indexOf('/api/')))).toEqual([
      '/api/tasks/asset?kind=task&id=a/t&file=assets/mein%20bild.png',
      '/api/tasks/asset?kind=path&id=a/p&file=assets/images/%C3%BCbersicht.svg',
    ]);
  });
});
