import { describe, expect, it } from 'vitest';
import { readRoute } from 'appkit-ui/route';
import { routePlace } from './history';
import { routedTask, taskRoute, viewRoute, withTaskRoute } from './route';

describe('the route of a task in a window of its own', () => {
  it('names the task in the fragment and reads it back', () => {
    expect(taskRoute('lib.nvim/alpha')).toBe('#task=lib.nvim%2Falpha');
    for (const id of ['lib.nvim/alpha', 'a b/ä&ö=#?', 'x/y']) expect(routedTask(taskRoute(id))).toBe(id);
    expect(routedTask('task=pub%2Fa')).toBe('pub/a');
    expect(routedTask('#pair=abc&task=pub%2Fa')).toBe('pub/a');
  });

  it('takes no task from another fragment, a broken one, or an id that cannot be one', () => {
    expect(routedTask('')).toBeNull();
    expect(routedTask('#pair=0123')).toBeNull();
    expect(routedTask('#task=')).toBeNull();
    expect(routedTask('#task=%E0%A4%A')).toBeNull();
    expect(routedTask(`#task=${'a'.repeat(301)}`)).toBeNull();
    expect(routedTask('#task=a%0Ab')).toBeNull();
    expect(routedTask('#tasks=pub%2Fa')).toBeNull();
  });

  it('sets the task of a fragment or takes it out, and keeps the rest of it', () => {
    expect(withTaskRoute('#task=pub%2Fa', null)).toBe('');
    expect(withTaskRoute('', null)).toBe('');
    expect(withTaskRoute('#', null)).toBe('');
    expect(withTaskRoute('#other=1&task=pub%2Fa', null)).toBe('#other=1');
    expect(withTaskRoute('#task=pub%2Fa', 'pub/b')).toBe('#task=pub%2Fb');
    expect(withTaskRoute('#other=1', 'pub/a')).toBe('#task=pub%2Fa&other=1');
    expect(withTaskRoute('', 'pub/a')).toBe(taskRoute('pub/a'));
    expect(routedTask(withTaskRoute('#task=pub%2Fa&task=pub%2Fb', 'pub/c'))).toBe('pub/c');
  });
});

describe('the route of a view in a new tab', () => {
  const viewOf = (hash: string) => routePlace(readRoute(hash))?.view ?? null;

  it('names the view in the fragment and the history reads it back, beside a task', () => {
    expect(viewRoute('plan')).toBe('#view=plan');
    expect(viewOf(viewRoute('plan'))).toBe('plan');
    expect(viewOf('#task=a%2Fb&view=done')).toBe('done');
  });

  it('takes no name that is no view, and nothing from another fragment', () => {
    for (const hash of ['#view=<img src=x>', '#view=', '#view=PLAN', '#pair=abc', '']) expect(viewOf(hash)).toBeNull();
  });
});
