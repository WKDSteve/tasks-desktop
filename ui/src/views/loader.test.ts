// The loader of a chunk that remembers it (`loader.ts`): one request however often it is asked, the module at hand
// once it came, a new request after a failure, and the preload that asks when the page is idle and swallows a failure.
import { describe, expect, it } from 'vitest';
import { loader, preload } from './loader';

describe('loader', () => {
  it('asks once, and has the module at hand once it came', async () => {
    let asked = 0;
    const load = loader(() => {
      asked += 1;
      return Promise.resolve({ default: 'view' });
    });
    expect(load.loaded()).toBeUndefined();
    const [a, b] = await Promise.all([load(), load()]);
    expect(a).toBe(b);
    expect(asked).toBe(1);
    expect(load.loaded()).toEqual({ default: 'view' });
    await load();
    expect(asked).toBe(1);
  });

  it('asks again after a chunk that did not come', async () => {
    let gone = true;
    let asked = 0;
    const load = loader(() => {
      asked += 1;
      return gone ? Promise.reject(new TypeError('Failed to fetch dynamically imported module')) : Promise.resolve({ default: 'view' });
    });
    await expect(load()).rejects.toThrow('Failed to fetch');
    expect(load.loaded()).toBeUndefined();
    gone = false;
    await expect(load()).resolves.toEqual({ default: 'view' });
    expect(asked).toBe(2);
  });
});

describe('preload', () => {
  it('asks every loader when the page is idle, not before', async () => {
    let later: (() => void) | undefined;
    const asked: string[] = [];
    const one = loader(() => (asked.push('one'), Promise.resolve(1)));
    const two = loader(() => (asked.push('two'), Promise.resolve(2)));
    preload([one, two], (run) => (later = run));
    expect(asked).toEqual([]);
    later?.();
    expect(asked).toEqual(['one', 'two']);
    await Promise.resolve();
    expect(one.loaded()).toBe(1);
  });

  it('a chunk that does not come is no error of the page', async () => {
    const gone = loader(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')));
    const unhandled: unknown[] = [];
    const listen = (reason: unknown) => unhandled.push(reason);
    // Node's own events (the page code has no Node types): a rejection nobody handled.
    const node = (globalThis as unknown as { process: { on(e: string, f: (r: unknown) => void): void; off(e: string, f: (r: unknown) => void): void } }).process;
    node.on('unhandledRejection', listen);
    try {
      preload([gone], (run) => run());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
      expect(gone.loaded()).toBeUndefined();
    } finally {
      node.off('unhandledRejection', listen);
    }
  });
});
