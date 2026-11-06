import { describe, expect, it } from 'vitest';
import { scrollAmount } from './scrollKeys';

describe('the keys that scroll a task', () => {
  it('go a line with the arrows and most of the box with the page keys', () => {
    expect(scrollAmount('ArrowDown', 500)).toBe(40);
    expect(scrollAmount('ArrowUp', 500)).toBe(-40);
    expect(scrollAmount('PageDown', 500)).toBe(450);
    expect(scrollAmount('PageUp', 500)).toBe(-450);
  });
  it('are no other keys', () => {
    expect(scrollAmount('j', 500)).toBeNull();
    expect(scrollAmount('Enter', 500)).toBeNull();
  });
});
