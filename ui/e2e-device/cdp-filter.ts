// A filter between Playwright and Chrome on the phone: Playwright sees only the tabs the suite opens itself (and what
// runs in them: frames, workers), plus the workers of the origin of the run. Every other tab of the person is let go
// at once (detached, never changed), so that the suite neither holds nor waits on it.
//
// Why: `connectOverCDP` attaches to every live tab of the browser. Chrome on Android leaves the detach of a service
// worker inside such a tab unanswered (the installed phone page of the real hub has one), and the connect then waits
// forever. The pages of the person are none of the suite's business anyway.

import { WebSocket, WebSocketServer } from 'ws';

/** One message of the DevTools protocol, as far as the filter reads it. */
export interface CdpMessage {
  id?: number;
  method?: string;
  sessionId?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: unknown;
}

interface TargetInfo {
  targetId: string;
  type: string;
  url: string;
  openerId?: string;
}

/** What one message turns into: the messages for Playwright and those for Chrome. */
export interface Routed {
  toClient: CdpMessage[];
  toChrome: CdpMessage[];
}

/** Ids of the filter's own requests: far above the ones Playwright counts up from 1. */
const OWN_IDS_FROM = 1_000_000_000;

/**
 * The browser session Playwright asks for (`Target.attachToBrowserTarget`, for a CDP session of a page): Chrome on
 * Android drops it at once ("Session with given id not found"), so the filter answers it and sends what goes over it to
 * the browser connection itself, which is the same browser.
 */
const BROWSER_SESSION = 'cdp-filter-browser-session';

/** The decisions of the filter, without the sockets (so that they are tested without a phone). */
export class TargetFilter {
  private readonly origin: string;
  private nextOwnId = OWN_IDS_FROM;
  /** `Target.createTarget` requests of Playwright still without an answer. */
  private readonly creating = new Set<number>();
  private readonly targets = new Set<string>();
  private readonly sessions = new Set<string>();
  /** Blank tabs that showed up while a tab of the suite was being created: whose they are, its answer tells. */
  private readonly held = new Map<string, CdpMessage>();
  /** Requests sent over the browser session: their answers go back on it. */
  private readonly viaBrowser = new Set<number>();
  /** Tabs of the suite Playwright attaches to over the browser session, until Chrome tells of the new session. */
  private readonly attachingViaBrowser = new Set<string>();

  constructor(origin: string) {
    this.origin = origin;
  }

  fromClient(message: CdpMessage): Routed {
    if (message.method === 'Target.attachToBrowserTarget' && message.sessionId === undefined) {
      return { toClient: [{ id: message.id, result: { sessionId: BROWSER_SESSION } }], toChrome: [] };
    }
    if (message.method === 'Target.detachFromTarget' && message.params?.['sessionId'] === BROWSER_SESSION) {
      return { toClient: [{ id: message.id, result: {} }], toChrome: [] };
    }
    if (message.sessionId === BROWSER_SESSION) {
      const { sessionId: _browser, ...rest } = message;
      if (rest.id !== undefined) this.viaBrowser.add(rest.id);
      const target = rest.params?.['targetId'];
      if (rest.method === 'Target.attachToTarget' && typeof target === 'string') this.attachingViaBrowser.add(target);
      return { toClient: [], toChrome: [rest] };
    }
    if (message.method === 'Target.createTarget' && message.sessionId === undefined && message.id !== undefined) {
      this.creating.add(message.id);
    }
    return { toClient: [], toChrome: [message] };
  }

  fromChrome(message: CdpMessage): Routed {
    const out: Routed = { toClient: [], toChrome: [] };
    if (message.sessionId !== undefined && !this.sessions.has(message.sessionId)) return out;
    if (message.id !== undefined) {
      if (message.id >= OWN_IDS_FROM) return out;
      const viaBrowser = message.sessionId === undefined && this.viaBrowser.delete(message.id);
      // A session Playwright opened itself (`Target.attachToTarget` for a CDP session of the suite): what comes on it
      // is the suite's.
      const opened = message.result?.['sessionId'];
      if (typeof opened === 'string') this.sessions.add(opened);
      if (message.sessionId === undefined && this.creating.delete(message.id)) {
        const created = message.result?.['targetId'];
        if (typeof created === 'string') {
          this.targets.add(created);
          const event = this.held.get(created);
          if (event) {
            this.held.delete(created);
            this.allow(event, out);
          }
        }
        if (this.creating.size === 0) for (const event of this.held.values()) this.release(event, out);
        if (this.creating.size === 0) this.held.clear();
      }
      out.toClient.push(viaBrowser ? { ...message, sessionId: BROWSER_SESSION } : message);
      return out;
    }
    switch (message.method) {
      case 'Target.attachedToTarget': {
        const info = message.params?.['targetInfo'] as TargetInfo;
        // Chrome tells of a session asked for over the browser session on the top level: for Playwright it belongs
        // to the browser session (on the top level it would be the tab a second time, "Duplicate target").
        if (
          message.sessionId === undefined &&
          this.targets.has(info.targetId) &&
          this.attachingViaBrowser.delete(info.targetId)
        ) {
          this.sessions.add(message.params?.['sessionId'] as string);
          out.toClient.push({ ...message, sessionId: BROWSER_SESSION });
          return out;
        }
        if (this.ours(info, message)) this.allow(message, out);
        else if (info.type === 'page' && (info.url === '' || info.url === 'about:blank') && this.creating.size > 0) {
          this.held.set(info.targetId, message);
        } else this.release(message, out);
        return out;
      }
      case 'Target.detachedFromTarget': {
        const session = message.params?.['sessionId'] as string;
        if (this.sessions.delete(session)) out.toClient.push(message);
        return out;
      }
      default: {
        const info = message.params?.['targetInfo'] as TargetInfo | undefined;
        const target = info?.targetId ?? (message.params?.['targetId'] as string | undefined);
        if (target === undefined || this.targets.has(target)) out.toClient.push(message);
        return out;
      }
    }
  }

  /** Whether a target that attaches is the suite's: a tab it created, a part of one of its tabs, its origin's worker. */
  private ours(info: TargetInfo, message: CdpMessage): boolean {
    if (message.sessionId !== undefined) return true;
    if (this.targets.has(info.targetId)) return true;
    if (info.openerId !== undefined && this.targets.has(info.openerId)) return true;
    return info.type !== 'page' && sameOrigin(info.url, this.origin);
  }

  private allow(event: CdpMessage, out: Routed): void {
    const info = event.params?.['targetInfo'] as TargetInfo;
    this.targets.add(info.targetId);
    this.sessions.add(event.params?.['sessionId'] as string);
    out.toClient.push(event);
  }

  /** Lets a tab of the person go: it runs on if it waited for the debugger, and the session ends. */
  private release(event: CdpMessage, out: Routed): void {
    const session = event.params?.['sessionId'] as string;
    if (event.params?.['waitingForDebugger'] === true) {
      out.toChrome.push({
        id: this.nextOwnId++,
        method: 'Runtime.runIfWaitingForDebugger',
        sessionId: session,
      });
    }
    const detach: CdpMessage = {
      id: this.nextOwnId++,
      method: 'Target.detachFromTarget',
      params: { sessionId: session },
    };
    if (event.sessionId !== undefined) detach.sessionId = event.sessionId;
    out.toChrome.push(detach);
  }
}

function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** A running filter: Playwright connects to `endpoint` instead of to Chrome. */
export interface FilterProxy {
  endpoint: string;
  close(): Promise<void>;
}

/** Starts the filter on a free port of the loopback in front of `upstream` (Chrome's browser websocket). */
export function startFilter(upstream: string, origin: string): Promise<FilterProxy> {
  return new Promise((resolve, reject) => {
    const server = new WebSocketServer({
      host: '127.0.0.1',
      port: 0,
      perMessageDeflate: false,
    });
    server.once('error', reject);
    server.on('connection', (client) => {
      const filter = new TargetFilter(origin);
      const chrome = new WebSocket(upstream, {
        perMessageDeflate: false,
        maxPayload: 256 * 1024 * 1024,
      });
      const early: string[] = [];
      const toChrome = (messages: CdpMessage[]): void => {
        for (const m of messages) chrome.send(JSON.stringify(m));
      };
      const route = (routed: Routed): void => {
        for (const m of routed.toClient) client.send(JSON.stringify(m));
        toChrome(routed.toChrome);
      };
      client.on('message', (data) => {
        const text = String(data);
        if (chrome.readyState === WebSocket.OPEN) route(filter.fromClient(JSON.parse(text) as CdpMessage));
        else early.push(text);
      });
      chrome.on('open', () => {
        for (const text of early.splice(0)) route(filter.fromClient(JSON.parse(text) as CdpMessage));
      });
      chrome.on('message', (data) => route(filter.fromChrome(JSON.parse(String(data)) as CdpMessage)));
      const end = (): void => {
        client.close();
        chrome.close();
      };
      client.on('close', end);
      chrome.on('close', end);
      chrome.on('error', end);
      client.on('error', end);
    });
    server.once('listening', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        endpoint: `ws://127.0.0.1:${port}/devtools/browser`,
        close: () =>
          new Promise<void>((done) => {
            for (const c of server.clients) c.terminate();
            server.close(() => done());
          }),
      });
    });
  });
}
