// The mark of a claim, rendered on the server side of Svelte: a claim of an agent of ai-desktop reads "agent" in the
// look of any claim, and is still named when it ran out; other claims are as they were.
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { TaskEntry } from '../lib/contract';
import ClaimTag from './ClaimTag.svelte';

const since = '2026-01-01T00:00:00Z';
const until = '2099-01-01T00:00:00Z';
const tag = (claim: TaskEntry['claim'], me = 'me@pc') =>
  render(ClaimTag, { props: { task: { claim }, lang: 'en', me } }).body.replace(/<!--.*?-->/g, '');

describe('the mark of a claim', () => {
  it('names an agent of ai-desktop as agent, with its job in the hint and for a screen reader', () => {
    const out = tag({ by: 'ai-desktop:3f9c0a1b2c3d4e5f', since, until, expired: false });
    expect(out).toContain('data-agent="3f9c0a1b2c3d4e5f"');
    expect(out).toContain('data-claim="foreign"');
    expect(out).toContain('⚑ agent</span>');
    expect(out).toContain('An agent of ai-desktop works on it: job 3f9c0a1b2c3d4e5f');
    expect(out).toContain('claimed by an agent of ai-desktop (job 3f9c0a1b2c3d4e5f)');
    // The same look as any claim of somebody else: no class of its own beyond the claim.
    expect(out).toMatch(/class="tag claim[^"]*"/);
    expect(out).not.toContain('ran-out');
  });

  it('keeps a claim of an agent that ran out, quietly, and drops any other claim that ran out', () => {
    const out = tag({ by: 'ai-desktop:j1', since, until: '2026-01-02T00:00:00Z', expired: true });
    expect(out).toContain('data-claim="expired"');
    expect(out).toContain('⚑ agent, run out</span>');
    expect(out).toContain('The claim of the agent of job j1 ran out');
    expect(out).toContain('ran-out');
    expect(tag({ by: 'cdx:abc', since, until: '2026-01-02T00:00:00Z', expired: true })).not.toContain('claim');
  });

  it('shows other claims as before', () => {
    expect(tag({ by: 'cdx:abc', since, until, expired: false })).toContain('⚑ cdx:abc</span>');
    expect(tag({ by: 'me@pc', since, until, expired: false })).toContain('⚑ mine</span>');
    expect(tag(undefined)).toBe('');
  });
});
