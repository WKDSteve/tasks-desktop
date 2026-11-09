import { describe, expect, it } from 'vitest';
import { chromeTab, cleanUp, parseFocus, phoneFree } from './android';
import { TargetFilter, type CdpMessage } from './cdp-filter';

const ORIGIN = 'http://127.0.0.1:50123';

function attached(
  sessionId: string,
  targetId: string,
  type: string,
  url: string,
  extra: Partial<CdpMessage> = {},
  info: Record<string, unknown> = {},
): CdpMessage {
  return {
    method: 'Target.attachedToTarget',
    params: {
      sessionId,
      targetInfo: { targetId, type, url, ...info },
      waitingForDebugger: false,
    },
    ...extra,
  };
}

/** A filter with one tab of the suite (target T1, session S1) already created. */
function withOwnTab(): TargetFilter {
  const filter = new TargetFilter(ORIGIN);
  filter.fromClient({
    id: 7,
    method: 'Target.createTarget',
    params: { url: 'about:blank' },
  });
  filter.fromChrome(attached('S1', 'T1', 'page', 'about:blank'));
  filter.fromChrome({ id: 7, result: { targetId: 'T1' } });
  return filter;
}

describe('TargetFilter', () => {
  it('lets a tab of the person go and tells Playwright nothing of it', () => {
    const filter = new TargetFilter(ORIGIN);
    const out = filter.fromChrome(attached('S9', 'T9', 'page', 'https://example.org/'));
    expect(out.toClient).toEqual([]);
    expect(out.toChrome).toEqual([
      {
        id: expect.any(Number),
        method: 'Target.detachFromTarget',
        params: { sessionId: 'S9' },
      },
    ]);
  });

  it('lets a waiting tab of the person run on before it lets it go', () => {
    const filter = new TargetFilter(ORIGIN);
    const event = attached('S9', 'T9', 'page', 'https://example.org/');
    event.params!['waitingForDebugger'] = true;
    const out = filter.fromChrome(event);
    expect(out.toChrome.map((m) => m.method)).toEqual(['Runtime.runIfWaitingForDebugger', 'Target.detachFromTarget']);
    expect(out.toChrome[0]!.sessionId).toBe('S9');
  });

  it('hands over the tab the suite creates, also when it attaches before the answer', () => {
    const filter = new TargetFilter(ORIGIN);
    filter.fromClient({
      id: 7,
      method: 'Target.createTarget',
      params: { url: 'about:blank' },
    });
    expect(filter.fromChrome(attached('S1', 'T1', 'page', 'about:blank'))).toEqual({ toClient: [], toChrome: [] });
    const out = filter.fromChrome({ id: 7, result: { targetId: 'T1' } });
    expect(out.toClient.map((m) => m.method ?? m.id)).toEqual(['Target.attachedToTarget', 7]);
    expect(out.toChrome).toEqual([]);
  });

  it('lets go a blank tab of the person that shows up while the suite creates one', () => {
    const filter = new TargetFilter(ORIGIN);
    filter.fromClient({
      id: 7,
      method: 'Target.createTarget',
      params: { url: 'about:blank' },
    });
    filter.fromChrome(attached('S8', 'T8', 'page', ''));
    filter.fromChrome(attached('S1', 'T1', 'page', 'about:blank'));
    const out = filter.fromChrome({ id: 7, result: { targetId: 'T1' } });
    expect(out.toClient.map((m) => m.params?.['sessionId'] ?? m.id)).toEqual(['S1', 7]);
    expect(out.toChrome).toEqual([
      {
        id: expect.any(Number),
        method: 'Target.detachFromTarget',
        params: { sessionId: 'S8' },
      },
    ]);
  });

  it('passes what happens in a tab of the suite, and its frames and workers', () => {
    const filter = withOwnTab();
    expect(
      filter.fromChrome({
        method: 'Page.loadEventFired',
        sessionId: 'S1',
        params: {},
      }).toClient,
    ).toHaveLength(1);
    const child = attached('S2', 'W2', 'worker', `${ORIGIN}/w.js`, {
      sessionId: 'S1',
    });
    expect(filter.fromChrome(child).toClient).toEqual([child]);
    expect(filter.fromChrome({ id: 3, sessionId: 'S2', result: {} }).toClient).toHaveLength(1);
  });

  it('drops everything of a session it let go, and its own answers', () => {
    const filter = new TargetFilter(ORIGIN);
    const out = filter.fromChrome(attached('S9', 'T9', 'page', 'https://example.org/'));
    expect(
      filter.fromChrome({
        method: 'Page.frameNavigated',
        sessionId: 'S9',
        params: {},
      }).toClient,
    ).toEqual([]);
    expect(filter.fromChrome({ id: out.toChrome[0]!.id!, result: {} }).toClient).toEqual([]);
    expect(
      filter.fromChrome({
        method: 'Target.detachedFromTarget',
        params: { sessionId: 'S9', targetId: 'T9' },
      }).toClient,
    ).toEqual([]);
  });

  it('keeps the worker of the run, lets go the one of the real hub', () => {
    const filter = new TargetFilter(ORIGIN);
    expect(filter.fromChrome(attached('S3', 'W3', 'service_worker', `${ORIGIN}/m/sw.js`)).toClient).toHaveLength(1);
    const real = filter.fromChrome(attached('S4', 'W4', 'service_worker', 'http://127.0.0.1:17615/m/sw.js'));
    expect(real.toClient).toEqual([]);
    expect(real.toChrome[0]!.method).toBe('Target.detachFromTarget');
  });

  it('a page of the origin the suite did not open is not its own (a tab left from another run)', () => {
    const filter = new TargetFilter(ORIGIN);
    expect(filter.fromChrome(attached('S5', 'T5', 'page', `${ORIGIN}/m/`)).toClient).toEqual([]);
  });

  it('hands over a popup of a tab of the suite', () => {
    const filter = withOwnTab();
    const popup = attached('S6', 'T6', 'page', 'https://example.org/', {}, { openerId: 'T1' });
    expect(filter.fromChrome(popup).toClient).toEqual([popup]);
  });

  it('passes the sessions Playwright opens itself (a CDP session of the suite)', () => {
    const filter = withOwnTab();
    expect(filter.fromChrome({ id: 18, result: { sessionId: 'B1' } }).toClient).toHaveLength(1);
    const answer = { id: 19, sessionId: 'B1', result: { sessionId: 'S7' } };
    expect(filter.fromChrome(answer).toClient).toEqual([answer]);
    expect(filter.fromChrome({ id: 20, sessionId: 'S7', result: {} }).toClient).toHaveLength(1);
  });

  it('answers the browser session itself and carries what goes over it (Chrome on Android drops that session)', () => {
    const filter = withOwnTab();
    const attach = filter.fromClient({ id: 18, method: 'Target.attachToBrowserTarget' });
    expect(attach.toChrome).toEqual([]);
    const browserSession = attach.toClient[0]!.result!['sessionId'] as string;
    expect(attach.toClient).toEqual([{ id: 18, result: { sessionId: browserSession } }]);
    const over = filter.fromClient({
      id: 19,
      method: 'Target.attachToTarget',
      params: { targetId: 'T1', flatten: true },
      sessionId: browserSession,
    });
    expect(over.toChrome).toEqual([
      { id: 19, method: 'Target.attachToTarget', params: { targetId: 'T1', flatten: true } },
    ]);
    // Chrome tells of the new session on the top level; for Playwright it belongs to the browser session (on the top
    // level it would be the tab a second time: "Duplicate target").
    const event = attached('S7', 'T1', 'page', 'about:blank');
    expect(filter.fromChrome(event).toClient).toEqual([{ ...event, sessionId: browserSession }]);
    expect(filter.fromChrome({ id: 19, result: { sessionId: 'S7' } }).toClient).toEqual([
      { id: 19, result: { sessionId: 'S7' }, sessionId: browserSession },
    ]);
    expect(filter.fromChrome({ id: 20, sessionId: 'S7', result: {} }).toClient).toHaveLength(1);
    const detach = filter.fromClient({
      id: 21,
      method: 'Target.detachFromTarget',
      params: { sessionId: browserSession },
    });
    expect(detach).toEqual({ toClient: [{ id: 21, result: {} }], toChrome: [] });
  });

  it('passes news of its own targets only', () => {
    const filter = withOwnTab();
    const own = {
      method: 'Target.targetInfoChanged',
      params: {
        targetInfo: { targetId: 'T1', type: 'page', url: `${ORIGIN}/m/` },
      },
    };
    const foreign = {
      method: 'Target.targetInfoChanged',
      params: {
        targetInfo: {
          targetId: 'T9',
          type: 'page',
          url: 'https://example.org/',
        },
      },
    };
    expect(filter.fromChrome(own).toClient).toEqual([own]);
    expect(filter.fromChrome(foreign).toClient).toEqual([]);
    expect(
      filter.fromChrome({
        method: 'Target.targetDestroyed',
        params: { targetId: 'T9' },
      }).toClient,
    ).toEqual([]);
    const detached = {
      method: 'Target.detachedFromTarget',
      params: { sessionId: 'S1', targetId: 'T1' },
    };
    expect(filter.fromChrome(detached).toClient).toEqual([detached]);
    expect(
      filter.fromChrome({
        method: 'Page.loadEventFired',
        sessionId: 'S1',
        params: {},
      }).toClient,
    ).toEqual([]);
  });
});

describe('phoneFree', () => {
  const home = 'com.android.launcher3';
  const chrome = (activity: string) => ({ pkg: 'com.android.chrome', activity });

  it('takes the phone only when a tab of Chrome, the home screen or nothing is in front', () => {
    expect(phoneFree(chrome('org.chromium.chrome.browser.ChromeTabbedActivity'), home)).toBe(true);
    expect(phoneFree(chrome('com.google.android.apps.chrome.Main'), home)).toBe(true);
    expect(phoneFree({ pkg: home, activity: 'com.android.searchlauncher.SearchLauncher' }, home)).toBe(true);
    expect(phoneFree(null, home)).toBe(true);
    expect(phoneFree({ pkg: 'com.Slack', activity: 'slack.MainActivity' }, home)).toBe(false);
    expect(phoneFree({ pkg: home, activity: 'x.Launcher' }, null)).toBe(false);
  });

  it('an installed web app or a custom tab is an app of the person, though it runs under Chrome', () => {
    expect(phoneFree(chrome('org.chromium.chrome.browser.webapps.SameTaskWebApkActivity'), home)).toBe(false);
    expect(phoneFree(chrome('org.chromium.chrome.browser.customtabs.CustomTabActivity'), home)).toBe(false);
    expect(chromeTab(chrome('org.chromium.chrome.browser.webapps.WebappActivity'))).toBe(false);
    expect(chromeTab(chrome('org.chromium.chrome.browser.ChromeTabbedActivity2'))).toBe(true);
  });
});

describe('parseFocus', () => {
  it('reads the app and activity of the focused window', () => {
    const out = '  mCurrentFocus=Window{11bad61 u0 com.android.chrome/com.google.android.apps.chrome.Main}\n';
    expect(parseFocus(out)).toEqual({ pkg: 'com.android.chrome', activity: 'com.google.android.apps.chrome.Main' });
  });

  it('a focused window without an app (shade, lock screen, popup) is not free', () => {
    const shade = parseFocus('  mCurrentFocus=Window{4ab77d6 u0 NotificationShade}\n');
    expect(shade).toEqual({ pkg: 'NotificationShade', activity: '' });
    expect(phoneFree(shade, 'com.android.launcher3')).toBe(false);
    expect(phoneFree(parseFocus('mCurrentFocus=Window{1 u0 PopupWindow:5d3c0f2}'), 'com.android.launcher3')).toBe(
      false,
    );
  });

  it('no focus at all is null', () => {
    expect(parseFocus('  mCurrentFocus=null\n')).toBeNull();
    expect(parseFocus('')).toBeNull();
  });
});

describe('cleanUp', () => {
  it('runs every step when one fails and throws the first error', async () => {
    const ran: string[] = [];
    const first = new Error('cable');
    await expect(
      cleanUp([
        () => ran.push('a'),
        () => {
          throw first;
        },
        async () => ran.push('c'),
        () => {
          throw new Error('later');
        },
      ]),
    ).rejects.toBe(first);
    expect(ran).toEqual(['a', 'c']);
  });
});
