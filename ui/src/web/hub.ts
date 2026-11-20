// The hub of the web variant: the routes of crates/tasks-hub/src/server/routes.rs, answered in the page by the engine
// in the worker, behind the `fetch` the API client already takes (ui/src/lib/api.ts). The components do not know
// whether a server or this answers.
//
// What the Rust hub checks before it asks the engine is checked here the same way (the query is plain, an id is
// `<area>/<slug>`, an area is a name, a sort is one of the engine's words), and an engine refusal keeps its code and message
// and gets the same HTTP status. Left out on purpose: the session (there is no server and no token), the event stream
// (the page reads again on focus), and everything that opens something on the machine. A write (`ops`) is checked the
// way the Rust hub checks it and then handed to `deps.ops`, which asks the engine and writes the folder; a hub without
// that answers every write with a refusal.

import { INTENT_MAX_BYTES } from '../lib/intent.ts';
import type { CallResult } from './engine.ts';
import { parseQuery as parseSearchQuery, parseRequest, readCorpus, search as searchCorpus, type Corpus } from './search.ts';

/** How a request of `ops` ended (`VaultSession.ops`). */
export type OpsOutcome =
  /** The engine's `tasks.result`, and what it changed is in the folder. */
  | { kind: 'done'; text: string }
  /** The engine refused the request as a whole (a code of the contract); nothing was written. */
  | { kind: 'refused'; result: CallResult }
  /** The folder changed on disk since it was read: nothing was written, the page shows the disk state again. */
  | { kind: 'conflict'; message: string }
  /** The folder could not be written (or not safely): `code` is `io` or `rollback_incomplete`. */
  | { kind: 'failed'; code: string; message: string };

export interface HubDeps {
  /** One method of the engine over the vault in the worker, as `engine.call` answers it. */
  call(method: string, request: string | null): Promise<CallResult>;
  /** The write path: the validated JSON of a request of `ops` in, how it ended out. Without it every write is refused. */
  ops?(request: string): Promise<OpsOutcome>;
  /** Resolves when no write or re-read of the folder is under way: a read waits for it, so it never sees half of one. */
  idle?(): Promise<void>;
  /** The version of this build (the page's `package.json`) and its build id, for `about`. */
  version: string;
  build: string | null;
  /** The commits of `engine.lock`, for `about`. */
  pinned: { engine: string | null; lib: string | null };
  /** The class an area is shown with (`areas.json`, fail-closed); an area the file does not name is unclassified. */
  classes?: (area: string) => DataClass;
  /** Called by `POST rescan`: the page asks to read the folder again. */
  rescan?: () => Promise<void>;
  /** The bytes of text the search reads at most (`MAX_INDEX_BYTES` of web/search.ts when left out); smaller in a test. */
  maxIndexBytes?: number;
  /**
   * The bytes of an image file of the folder (`path` relative to the vault, checked by the hub before), read from the
   * folder itself (the VM holds only the text files); `missing` when there is no such file, `too_large` over
   * `maxBytes`. Without it every asset is missing.
   */
  asset?(path: string, maxBytes: number): Promise<AssetRead>;
}

/** What reading an asset gave (`HubDeps.asset`). */
export type AssetRead = { bytes: Uint8Array } | 'missing' | 'too_large';

/** The largest picture and the largest drawing handed on (`crate::assets` of the hub). */
export const MAX_ASSET_RASTER_BYTES = 20 * 1024 * 1024;
export const MAX_ASSET_SVG_BYTES = 2 * 1024 * 1024;

const ASSET_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

/** The media type of an image asset by its kind (`assets::content_type`), or null. */
export function assetContentType(file: string): string | null {
  const dot = file.lastIndexOf('.');
  if (dot < 0) return null;
  return ASSET_TYPES[file.slice(dot + 1).toLowerCase()] ?? null;
}

/** A plain path below `assets/` of an image kind (`assets::valid_asset_path`): no `..`, no root, no drive. */
export function validAssetPath(file: string): boolean {
  if (!file.startsWith('assets/') || file.length > 512) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\\:\u0000-\u001f\u007f]/.test(file)) return false;
  if (file.split('/').some((part) => part === '' || part === '.' || part === '..')) return false;
  return assetContentType(file) !== null;
}

/** The kinds of container whose assets the hub hands on (`assets::Owner`). */
export const ASSET_OWNERS = ['task', 'plan', 'project', 'path', 'meeting'] as const;
export type AssetOwner = (typeof ASSET_OWNERS)[number];

/** The query of `asset`, as the hub reads it (`asset_request`), or why it is refused. */
export function assetRequest(q: Map<string, string>): { kind: AssetOwner; id: string; file: string } | string {
  const kind = q.get('kind');
  if (!ASSET_OWNERS.includes(kind as AssetOwner)) return 'kind is task, plan, project, path or meeting';
  const id = q.get('id');
  if (!validTaskId(id)) return 'id must be <area>/<slug>';
  const file = q.get('file');
  if (file === undefined || !validAssetPath(file)) return 'file is an image below assets/';
  return { kind: kind as AssetOwner, id, file };
}

/** The answer headers of an asset: its type, sealed like a meeting's preview (`sealed` of the hub). */
function sealedAsset(bytes: Uint8Array, type: string): Response {
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'no-store',
    },
  });
}

export type DataClass = 'public' | 'internal' | 'private' | 'unclassified';

const NS = '/api/tasks/';
/** The one session of a page in the web variant: a word, not a secret. */
export const SESSION = 'web-session';
const SORTS = [
  'default',
  'prio-effort',
  'severity',
  'frecency',
  'roi',
  'due',
  'created-desc',
  'created-asc',
  'updated-desc',
  'updated-asc',
  'remind',
  'title',
];
const MAX_AREA_NAME = 128;
const ESTIMATE_MAX = 1000;
const JSON_TYPE = { 'Content-Type': 'application/json' };

function respond(status: number, body: string, etag?: string | null): Response {
  const headers: Record<string, string> = { ...JSON_TYPE };
  if (etag) headers['ETag'] = `"${etag}"`;
  return new Response(body, { status, headers });
}

function errorBody(status: number, code: string, message: string): Response {
  return respond(status, JSON.stringify({ error: { code, message } }));
}

/** The folder name rule of `config::valid_area_name`. */
export function validAreaName(name: string): boolean {
  if (name === '' || [...name].length > MAX_AREA_NAME) return false;
  if (name.startsWith('.') || name.endsWith(' ') || name.endsWith('.')) return false;
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u001f\u007f-\u009f/\\,:*?"<>|]/.test(name);
}

/** `<area>/<slug>`: two plain names. The engine says whether the task is there. */
export function validTaskId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  const cut = id.indexOf('/');
  if (cut < 0) return false;
  const area = id.slice(0, cut);
  const slug = id.slice(cut + 1);
  const plain = /^[A-Za-z0-9._-]*$/;
  return validAreaName(area) && plain.test(area) && slug !== '' && slug.length <= 128 && !slug.startsWith('.') && plain.test(slug);
}

/** The longest line of the quick capture (the engine's `meeting_parse` and the hub take no more). */
export const MEETING_LINE_MAX_BYTES = 1000;

/** Is `text` a line the quick capture reads: not blank, at most 1000 bytes, no control character? */
export function meetingLine(text: string): boolean {
  return text.trim() !== '' && new TextEncoder().encode(text).length <= MEETING_LINE_MAX_BYTES && !/\p{Cc}/u.test(text);
}

/**
 * Is `text` a day of the calendar, `YYYY-MM-DD` (`schedule::day_of` of the hub)? `Date.parse` is no judge: it takes
 * `2026-02-30` and rolls it over to March.
 */
export function isDay(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(y, mo - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d;
}

/** The question of `meetings` from its query, as the hub asks it (`meetings_request`), or why it is refused. */
export function meetingsParams(q: Map<string, string>): Record<string, unknown> | string {
  const params: Record<string, unknown> = {};
  for (const key of ['since', 'until'] as const) {
    const day = q.get(key);
    if (day === undefined) continue;
    if (!isDay(day)) return 'since and until are days, YYYY-MM-DD';
    params[key] = day;
  }
  const area = q.get('area');
  if (area !== undefined) {
    if (!validAreaName(area)) return 'area is not a name';
    params['area'] = area;
  }
  const status = q.get('status');
  if (status !== undefined) {
    if (!['planned', 'done', 'cancelled'].includes(status)) return 'status is planned, done or cancelled';
    params['status'] = [status];
  }
  const task = q.get('task');
  if (task !== undefined) {
    if (!validTaskId(task)) return 'task must be <area>/<slug>';
    params['task'] = task;
  }
  const limit = q.get('limit');
  if (limit !== undefined) {
    if (!/^[0-9]{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 100) return 'limit is 1 to 100';
    params['limit'] = Number(limit);
  }
  const offset = q.get('offset');
  if (offset !== undefined) {
    if (!/^[0-9]{1,6}$/.test(offset) || Number(offset) > 100000) return 'offset is a number from 0';
    params['offset'] = Number(offset);
  }
  return params;
}

/** A query of plain pairs, or the reason it is not (`parse_query` of appkit-hub). */
export function parseQuery(query: string, allowed: readonly string[]): Map<string, string> | string {
  const out = new Map<string, string>();
  if (query === '') return out;
  for (const pair of query.split('&')) {
    const cut = pair.indexOf('=');
    if (cut < 0) return 'a query part has no value';
    const key = pair.slice(0, cut);
    const value = pair.slice(cut + 1);
    if (!allowed.includes(key)) return 'unknown query parameter';
    if (!/^[A-Za-z0-9._/-]{1,128}$/.test(value)) return 'a query value is not plain text';
    if (out.has(key)) return 'a query parameter is given twice';
    out.set(key, value);
  }
  return out;
}

const STATUS_OF_CODE: Record<string, number> = {
  invalid_argument: 400,
  unsupported_schema: 400,
  not_found: 404,
  conflict: 409,
  exists: 409,
  forbidden: 403,
  locked: 503,
};

/** An engine refusal, as `engine_failure` of the Rust hub tells it: the code and a short plain message. */
export function failureResponse(result: CallResult): Response {
  let doc: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(result.text);
    if (typeof parsed === 'object' && parsed !== null) doc = parsed as Record<string, unknown>;
  } catch {
    // an answer that is not JSON is told as a failed engine below
  }
  const raw = typeof doc['code'] === 'string' ? doc['code'] : result.code ?? '';
  const status = STATUS_OF_CODE[raw] ?? 502;
  const codeOk = /^[a-z_]{1,48}$/.test(raw);
  // eslint-disable-next-line no-control-regex
  const message = (typeof doc['message'] === 'string' ? doc['message'] : '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 512);
  const retryable = doc['retryable'] === true;
  return respond(status, JSON.stringify({ error: { code: codeOk ? raw : 'engine_failed', message, retryable } }));
}

/** The tag of a snapshot: its digest, when that is plain (`plain_digest` of the store). */
function etagOf(text: string): string | null {
  try {
    const digest = (JSON.parse(text) as { digest?: unknown }).digest;
    return typeof digest === 'string' && /^[A-Za-z0-9:]{1,128}$/.test(digest) ? digest : null;
  } catch {
    return null;
  }
}

function etagMatches(header: string, etag: string): boolean {
  const quoted = `"${etag}"`;
  return header.split(',').some((c) => {
    const t = c.trim();
    return t === '*' || (t.startsWith('W/') ? t.slice(2) : t) === quoted;
  });
}

type CheckState =
  | { state: 'idle' }
  | { state: 'done'; id: number; result: unknown }
  | { state: 'failed'; id: number; error: { code: string; message: string } };

export interface WebHub {
  fetch: typeof fetch;
  /**
   * Tell every open event stream that the vault may have changed: the page reads again (a `resync` event). With
   * `classes` the data classes changed too (a `classes` event, which the Rust hub never sends): the page also asks for
   * the areas again, and with them the classes its cache and its exports rest on.
   */
  notify(change?: { classes?: boolean }): void;
  /** End every open event stream. */
  close(): void;
}

export function createWebHub(deps: HubDeps): WebHub {
  const classes = deps.classes ?? (() => 'unclassified' as const);
  let check: CheckState = { state: 'idle' };
  let checkId = 0;
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const text = new TextEncoder();

  /** `GET events`: what the Rust hub sends over SSE, without a server. `hello` first, then `resync` on `notify`. */
  function events(signal?: AbortSignal | null): Response {
    let mine: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        mine = controller;
        streams.add(controller);
        controller.enqueue(text.encode('event: hello\ndata: {}\n\n'));
        // A request that is aborted ends its stream, as a real connection does: the reader sees an AbortError.
        signal?.addEventListener(
          'abort',
          () => {
            streams.delete(controller);
            try {
              controller.error(new DOMException('The request was aborted', 'AbortError'));
            } catch {
              // already closed
            }
          },
          { once: true },
        );
      },
      cancel() {
        if (mine) streams.delete(mine);
      },
    });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } });
  }

  async function engine(method: string, params?: Record<string, unknown>): Promise<CallResult | Response> {
    let result: CallResult;
    try {
      // A read never sees half of a write: it waits until the write (or the re-read after a failed one) is over.
      await deps.idle?.();
      result = await deps.call(method, params ? JSON.stringify({ params }) : null);
    } catch {
      return errorBody(502, 'engine_failed', 'the engine could not answer');
    }
    return result.code !== null ? failureResponse(result) : result;
  }

  /** Ask the engine and pass its document on unchanged. */
  async function passOn(method: string, params?: Record<string, unknown>): Promise<Response> {
    const r = await engine(method, params);
    return r instanceof Response ? r : respond(200, r.text);
  }

  /**
   * The file of a container in its folder form, relative to the vault (`container_file` of the hub); null when it has
   * no folder or is not there; a Response when the engine failed.
   */
  async function containerFile(kind: AssetOwner, id: string): Promise<string | null | Response> {
    const [area, slug] = id.split('/') as [string, string];
    if (kind === 'plan') return `${area}/ROADMAP/plans/${slug}/${slug}.md`;
    if (kind === 'project') return `${area}/ROADMAP/projects/${slug}/${slug}.md`;
    const r = await engine(kind, { id });
    if (r instanceof Response) return r.status === 404 ? null : r;
    let entry: Record<string, unknown> | undefined;
    try {
      entry = (JSON.parse(r.text) as Record<string, Record<string, unknown> | undefined>)[kind];
    } catch {
      return null;
    }
    if (!entry || entry['id'] !== id || entry['folder'] !== true || typeof entry['file'] !== 'string') return null;
    const file = entry['file'];
    // The engine's path, held to plain parts like any other (`plain_relative` of the hub).
    // eslint-disable-next-line no-control-regex
    if (/[\\:\u0000-\u001f\u007f]/.test(file) || file.split('/').some((p) => p === '' || p === '.' || p === '..')) return null;
    return file;
  }

  const noQuery = (query: string): Response | null =>
    query === '' ? null : errorBody(400, 'bad_query', 'this route takes no query');

  const idRequired = (q: Map<string, string>): string | Response => {
    const id = q.get('id');
    return validTaskId(id) ? id : errorBody(400, 'bad_id', 'id must be <area>/<slug>');
  };

  async function get(name: string, query: string, headers: Headers, signal?: AbortSignal | null): Promise<Response> {
    switch (name) {
      case 'hello': {
        const r = await engine('hello');
        const caps = r instanceof Response ? null : (JSON.parse(r.text) as { capabilities?: string[] }).capabilities ?? null;
        return respond(
          200,
          JSON.stringify({
            instance: 'web',
            version: deps.version,
            engine: { ready: !(r instanceof Response), problem: r instanceof Response ? 'engine_failed' : null, capabilities: caps },
          }),
        );
      }
      case 'snapshot': {
        const refused = noQuery(query);
        if (refused) return refused;
        const r = await engine('snapshot');
        if (r instanceof Response) return r;
        const etag = etagOf(r.text);
        const seen = headers.get('if-none-match');
        if (etag && seen && etagMatches(seen, etag)) return new Response(null, { status: 304, headers: { ETag: `"${etag}"` } });
        return respond(200, r.text, etag);
      }
      case 'task': {
        const q = parseQuery(query, ['id']);
        if (typeof q === 'string') return errorBody(400, 'bad_query', q);
        const id = idRequired(q);
        return typeof id === 'string' ? passOn('task', { id }) : id;
      }
      case 'meetings': {
        // The meetings of a window of days (`GET /api/tasks/meetings`), judged as the hub judges the query.
        const q = parseQuery(query, ['since', 'until', 'area', 'status', 'task', 'limit', 'offset']);
        if (typeof q === 'string') return errorBody(400, 'bad_query', q);
        const params = meetingsParams(q);
        return typeof params === 'string' ? errorBody(400, 'bad_query', params) : passOn('meetings', params);
      }
      case 'meeting': {
        const q = parseQuery(query, ['id']);
        if (typeof q === 'string') return errorBody(400, 'bad_query', q);
        const id = idRequired(q);
        return typeof id === 'string' ? passOn('meeting', { id }) : id;
      }
      case 'next': {
        const q = parseQuery(query, ['n', 'actor', 'area']);
        if (typeof q === 'string') return errorBody(400, 'bad_query', q);
        const params: Record<string, unknown> = {};
        const n = q.get('n');
        if (n !== undefined) {
          if (!/^[0-9]+$/.test(n) || Number(n) > 10) return errorBody(400, 'bad_query', 'n is 0 to 10');
          params['n'] = Number(n);
        }
        const actor = q.get('actor');
        if (actor !== undefined) params['actor'] = actor;
        const area = q.get('area');
        if (area !== undefined) {
          if (!validAreaName(area)) return errorBody(400, 'bad_query', 'area is not a name');
          params['area'] = area;
        }
        return passOn('next', params);
      }
      case 'about': {
        const refused = noQuery(query);
        if (refused) return refused;
        const r = await engine('hello');
        const engineDoc = r instanceof Response ? null : (JSON.parse(r.text) as { engine?: unknown }).engine ?? null;
        return respond(
          200,
          JSON.stringify({
            app: 'tasks-desktop',
            version: deps.version,
            build: deps.build,
            os: 'web',
            arch: 'wasm',
            mode: 'web',
            engine: engineDoc,
            engine_problem: r instanceof Response ? 'engine_failed' : null,
            pinned: deps.pinned,
          }),
        );
      }
      case 'areas': {
        const refused = noQuery(query);
        if (refused) return refused;
        const r = await engine('areas');
        if (r instanceof Response) return r;
        let doc: { areas?: Array<Record<string, unknown>> };
        try {
          doc = JSON.parse(r.text);
        } catch {
          return errorBody(502, 'engine_failed', 'the engine could not answer');
        }
        const out: Array<Record<string, unknown>> = [];
        const unclassified: string[] = [];
        const priv: string[] = [];
        for (const area of doc.areas ?? []) {
          const name = area['name'];
          if (typeof name !== 'string') continue;
          const shown = classes(name);
          if (shown === 'unclassified') unclassified.push(name);
          else if (shown === 'private') priv.push(name);
          out.push({ ...area, data_class: shown });
        }
        return respond(200, JSON.stringify({ schema: 1, kind: 'hub.areas', areas: out, unclassified, private: priv }));
      }
      case 'done_preview': {
        const q = parseQuery(query, ['id']);
        if (typeof q === 'string') return errorBody(400, 'bad_query', q);
        const id = idRequired(q);
        return typeof id === 'string' ? passOn('done_preview', { id }) : id;
      }
      case 'finished': {
        const q = parseQuery(query, ['area', 'plan', 'since', 'until', 'limit', 'offset']);
        if (typeof q === 'string') return errorBody(400, 'bad_query', q);
        const params: Record<string, unknown> = {};
        for (const key of ['area', 'plan', 'since', 'until']) {
          const v = q.get(key);
          if (v !== undefined) params[key] = v;
        }
        for (const key of ['limit', 'offset']) {
          const v = q.get(key);
          if (v === undefined) continue;
          if (!/^[0-9]+$/.test(v) || Number(v) > 0xffffffff) {
            return errorBody(400, 'bad_query', 'limit and offset are whole numbers');
          }
          params[key] = Number(v);
        }
        return passOn('finished', params);
      }
      case 'history': {
        const q = parseQuery(query, ['area', 'since', 'until', 'resolution']);
        if (typeof q === 'string') return errorBody(400, 'bad_query', q);
        const area = q.get('area');
        if (area !== undefined && !validAreaName(area)) return errorBody(400, 'bad_query', 'area is not a name');
        const params: Record<string, unknown> = {};
        for (const key of ['area', 'since', 'until', 'resolution']) {
          const v = q.get(key);
          if (v !== undefined) params[key] = v;
        }
        return passOn('history', params);
      }
      case 'waits': {
        const q = parseQuery(query, ['area']);
        if (typeof q === 'string') return errorBody(400, 'bad_query', q);
        const area = q.get('area');
        if (area !== undefined && !validAreaName(area)) return errorBody(400, 'bad_query', 'area is not a name');
        return passOn('waits', area === undefined ? {} : { area });
      }
      case 'links':
      case 'plan_compare':
      case 'groupings':
      case 'views':
      case 'lists': {
        const refused = noQuery(query);
        return refused ?? passOn(name);
      }
      case 'enums': {
        const refused = noQuery(query);
        if (refused) return refused;
        const r = await engine('hello');
        if (r instanceof Response) return r;
        const enums = (JSON.parse(r.text) as { enums?: unknown }).enums;
        if (typeof enums !== 'object' || enums === null || Array.isArray(enums)) {
          return errorBody(502, 'engine_failed', 'the engine named no ranges of fields');
        }
        return respond(200, JSON.stringify({ kind: 'hub.enums', enums }));
      }
      case 'order': {
        const q = parseQuery(query, ['sort', 'area']);
        if (typeof q === 'string') return errorBody(400, 'bad_query', q);
        const params: Record<string, unknown> = {};
        const sort = q.get('sort');
        if (sort !== undefined) {
          if (!SORTS.includes(sort)) {
            return errorBody(400, 'bad_sort', 'sort must be default, prio-effort, severity, frecency or roi');
          }
          params['sort'] = sort;
        }
        const area = q.get('area');
        if (area !== undefined) {
          if (!validAreaName(area)) return errorBody(400, 'bad_query', 'area is not a name');
          params['area'] = area;
        }
        return passOn('order', params);
      }
      case 'paths': {
        // The open learning paths with their progress (`tasks.paths`), asked each time as the hub does.
        const q = parseQuery(query, ['area']);
        if (typeof q === 'string') return errorBody(400, 'bad_query', q);
        const area = q.get('area');
        if (area !== undefined && !validAreaName(area)) return errorBody(400, 'bad_query', 'area is not a name');
        return passOn('paths', area !== undefined ? { area } : {});
      }
      case 'asset': {
        // An image below `assets/` of a container's folder (`GET /api/tasks/asset` of the hub): the folder comes from
        // the engine's `file` (task, path, meeting) or the layout (plan, project), never from the page.
        const q = parseQuery(query, ['kind', 'id', 'file']);
        if (typeof q === 'string') return errorBody(400, 'bad_query', q);
        const request = assetRequest(q);
        if (typeof request === 'string') return errorBody(400, 'bad_query', request);
        const container = await containerFile(request.kind, request.id);
        if (container instanceof Response) return container;
        const missing = errorBody(404, 'no_asset', 'the container has no such image');
        if (container === null || !deps.asset) return missing;
        const type = assetContentType(request.file) as string;
        const limit = type === 'image/svg+xml' ? MAX_ASSET_SVG_BYTES : MAX_ASSET_RASTER_BYTES;
        const folder = container.slice(0, container.lastIndexOf('/'));
        const read = await deps.asset(`${folder}/${request.file}`, limit).catch(() => 'missing' as const);
        if (read === 'too_large') return errorBody(413, 'too_large', 'the image is larger than the page is given');
        if (read === 'missing') return missing;
        return sealedAsset(read.bytes, type);
      }
      case 'path': {
        // One learning path with its tree (`tasks.path`).
        const q = parseQuery(query, ['id']);
        if (typeof q === 'string') return errorBody(400, 'bad_query', q);
        const id = idRequired(q);
        return typeof id === 'string' ? passOn('path', { id }) : id;
      }
      case 'plan_for': {
        const q = parseQuery(query, ['id', 'direction']);
        if (typeof q === 'string') return errorBody(400, 'bad_query', q);
        const id = idRequired(q);
        if (typeof id !== 'string') return id;
        const direction = q.get('direction') ?? 'needs';
        if (direction !== 'needs' && direction !== 'unlocks') {
          return errorBody(400, 'bad_direction', 'direction must be needs or unlocks');
        }
        return passOn('plan_for', { id, direction });
      }
      case 'check': {
        const refused = noQuery(query);
        return refused ?? respond(200, JSON.stringify({ job: check }));
      }
      case 'search': {
        return search(query);
      }
      case 'events': {
        const refused = noQuery(query);
        return refused ?? events(signal);
      }
      default:
        return errorBody(404, 'not_found', 'no such route');
    }
  }

  /**
   * The texts of the tasks, read once with the engine's `bodies` and kept until the vault is read again (`notify`,
   * which drops them: a reading that is still under way then serves only the searches that asked before).
   */
  let corpus: Promise<Corpus> | null = null;

  function texts(): Promise<Corpus> {
    if (corpus) return corpus;
    const reading = readCorpus(async (params) => {
      const r = await engine('bodies', params);
      if (r instanceof Response) throw new Error('the engine did not hand over the texts');
      return r.text;
    }, deps.maxIndexBytes);
    corpus = reading;
    // A failed reading is tried again on the next search; one that failed after the vault was read again leaves the
    // newer reading alone.
    reading.catch(() => {
      if (corpus === reading) corpus = null;
    });
    return reading;
  }

  function forgetTexts(): void {
    corpus = null;
  }

  /**
   * `GET search`: the tasks whose text holds every word of the query, best first, each with a piece of the text around
   * the match, as the Rust hub answers it (web/search.ts). While the texts cannot be read, `status` says so.
   */
  async function search(query: string): Promise<Response> {
    const request = parseRequest(query);
    if (typeof request === 'string') return errorBody(400, 'bad_query', request);
    const q = parseSearchQuery(request.text);
    if (typeof q === 'string') return errorBody(400, 'bad_query', q);
    let found: Corpus;
    try {
      found = await texts();
    } catch {
      return respond(
        200,
        JSON.stringify({ schema: 1, kind: 'hub.search', status: 'failed', indexed: 0, partial: false, total: 0, hits: [] }),
      );
    }
    const outcome = searchCorpus(found, q, request.limit);
    return respond(
      200,
      JSON.stringify({
        schema: 1,
        kind: 'hub.search',
        status: 'ready',
        indexed: found.entries.length,
        partial: found.partial,
        total: outcome.total,
        hits: outcome.hits,
      }),
    );
  }

  /**
   * `POST ops`: the form of the request is judged as the Rust hub judges it, the rules of the tasks are the engine's.
   * A request that ended with a changed folder tells the open streams (a `resync` event) and drops the texts of the
   * search; a dry run changes nothing and tells nobody.
   */
  async function ops(body: string): Promise<Response> {
    if (!deps.ops) {
      return errorBody(405, 'read_only', 'this page cannot write: change tasks in Neovim or the app');
    }
    const request = checkOpsRequest(body);
    if (typeof request === 'string') return errorBody(400, 'bad_request', request);
    // The clipboard and the screenshot folders of the machine are out of reach of a page.
    if (request.ops.some((op) => op['op'] === 'attach')) {
      return errorBody(400, 'not_available', 'attach reads the clipboard of the machine, which this page cannot do');
    }
    const dry = request.value['dry_run'] === true;
    let outcome: OpsOutcome;
    try {
      outcome = await deps.ops(JSON.stringify(request.value));
    } catch {
      // The write may have been carried out in part: the page reads again either way.
      if (!dry) changed();
      return errorBody(502, 'engine_failed', 'the write could not be carried out; read the vault again');
    }
    switch (outcome.kind) {
      case 'done': {
        if (!dry && wrote(outcome.text)) changed();
        return respond(200, outcome.text);
      }
      case 'refused':
        return failureResponse(outcome.result);
      case 'conflict':
        changed();
        return respond(409, JSON.stringify({ error: { code: 'conflict', message: clipMessage(outcome.message), retryable: true } }));
      case 'failed': {
        changed();
        const code = plainCode(outcome.code);
        return respond(
          STATUS_OF_CODE[code] ?? 502,
          JSON.stringify({ error: { code, message: clipMessage(outcome.message), retryable: false } }),
        );
      }
    }
  }

  /** The vault is not what the texts of the search and the page's list were read from. */
  function changed(): void {
    forgetTexts();
    tell('event: resync\ndata: {}\n\n');
  }

  async function post(name: string, body: string): Promise<Response> {
    switch (name) {
      case 'intent': {
        // "Paste an intent" (`wkd-intent/1`), as the hub's route: the text is measured before it is parsed, must be
        // one JSON object, and the engine in this page checks the rest and says what it would do. Never with `yes`.
        let text: unknown;
        try {
          const parsed: unknown = JSON.parse(body);
          const map = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
          if (map === null || Object.keys(map).some((k) => k !== 'text')) throw new Error('not the request');
          text = map['text'];
        } catch {
          return errorBody(400, 'bad_request', 'the body is { "text" }');
        }
        if (typeof text !== 'string') return errorBody(400, 'bad_intent', 'text: the intent as text');
        if (new TextEncoder().encode(text).length > INTENT_MAX_BYTES) return errorBody(400, 'intent_too_large', 'the intent is larger than 64 KiB');
        let intent: unknown;
        try {
          intent = JSON.parse(text);
        } catch {
          intent = null;
        }
        if (typeof intent !== 'object' || intent === null || Array.isArray(intent)) return errorBody(400, 'bad_intent', 'the intent is not one JSON object');
        return passOn('intent', { intent });
      }
      case 'meeting_parse': {
        // The quick capture of a meeting, as the hub's route: one line, read by the engine into a proposal.
        let text: unknown;
        try {
          const parsed: unknown = JSON.parse(body);
          const map = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
          if (map === null || Object.keys(map).some((k) => k !== 'text')) throw new Error('not the request');
          text = map['text'];
        } catch {
          return errorBody(400, 'bad_request', 'the body is { "text" }');
        }
        if (typeof text !== 'string') return errorBody(400, 'bad_text', 'text: the line of the quick capture');
        if (!meetingLine(text)) return errorBody(400, 'bad_text', 'text is one line of at most 1000 bytes');
        return passOn('meeting_parse', { text });
      }
      case 'estimate': {
        const request = checkEstimateRequest(body);
        if (typeof request === 'string') return errorBody(400, 'bad_request', request);
        return passOn('estimate', request);
      }
      case 'check': {
        let map: Record<string, unknown>;
        try {
          const parsed: unknown = body === '' ? {} : JSON.parse(body);
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
          map = parsed as Record<string, unknown>;
        } catch {
          return errorBody(400, 'bad_request', 'the body is not a JSON object');
        }
        const unknown = Object.keys(map).find((k) => k !== 'stale' && k !== 'area');
        if (unknown !== undefined) return errorBody(400, 'bad_request', `unknown field ${unknown.slice(0, 40)} in the request`);
        const params: Record<string, unknown> = {};
        if ('stale' in map) {
          if (map['stale'] !== 'refs') return errorBody(400, 'bad_request', 'stale must be refs');
          params['stale'] = 'refs';
        }
        if ('area' in map) {
          if (typeof map['area'] !== 'string' || !validAreaName(map['area'])) {
            return errorBody(400, 'bad_request', 'area must be the name of an area');
          }
          params['area'] = map['area'];
        }
        const id = ++checkId;
        const r = await engine('check', Object.keys(params).length ? params : undefined);
        if (r instanceof Response) {
          const doc = (await r.json()) as { error: { code: string; message: string } };
          check = { state: 'failed', id, error: { code: doc.error.code, message: doc.error.message } };
        } else {
          check = { state: 'done', id, result: JSON.parse(r.text) };
        }
        return respond(200, JSON.stringify({ job: check }));
      }
      case 'rescan': {
        await deps.rescan?.();
        return respond(200, '{}');
      }
      case 'ops':
        return ops(body);
      default:
        return errorBody(404, 'not_available', 'this route does not exist in the web variant');
    }
  }

  const web: typeof fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const url = new URL(href, 'http://web.invalid');
    // The page trades a pairing code for a session before it asks for anything. There is no server to pair with and
    // nothing to protect from another page here, so any code is traded for the one session of this page.
    if (url.pathname === '/auth/exchange') {
      return method === 'POST' ? respond(200, JSON.stringify({ token: SESSION })) : errorBody(405, 'method_not_allowed', 'POST');
    }
    if (!url.pathname.startsWith(NS)) return errorBody(404, 'not_found', 'no such route');
    const name = url.pathname.slice(NS.length);
    const query = url.search.startsWith('?') ? url.search.slice(1) : '';
    const headers = new Headers(init?.headers);
    if (method === 'GET') return get(name, query, headers, init?.signal);
    if (method === 'POST') {
      const body = typeof init?.body === 'string' ? init.body : '';
      return post(name, body);
    }
    return errorBody(405, 'method_not_allowed', 'GET or POST');
  };
  const tell = (message: string): void => {
    for (const controller of [...streams]) {
      try {
        controller.enqueue(text.encode(message));
      } catch {
        streams.delete(controller);
      }
    }
  };
  return {
    fetch: web,
    notify: (change) => {
      // The vault was read again: the texts of the search are those of before.
      forgetTexts();
      tell(change?.classes ? 'event: classes\ndata: {}\n\n' : 'event: resync\ndata: {}\n\n');
    },
    close: () => {
      for (const controller of [...streams]) {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
      streams.clear();
    },
  };
}

/** The form and size of a question of `estimate`, before the engine is asked (`check_estimate_request`). */
export function checkEstimateRequest(body: string): Record<string, unknown> | string {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return 'the body is not JSON';
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'the request must be a JSON object';
  const map = value as Record<string, unknown>;
  const bad = Object.keys(map).find((k) => k !== 'ids' && k !== 'assume');
  if (bad !== undefined) return `unknown field ${bad.slice(0, 40)} in the request`;
  if ('ids' in map) {
    const ids = map['ids'];
    if (!Array.isArray(ids)) return 'ids must be a list';
    if (ids.length > ESTIMATE_MAX) return `ids holds at most ${ESTIMATE_MAX} ids`;
    if (!ids.every((id) => validTaskId(id))) return 'every id must be <area>/<slug>';
  }
  if ('assume' in map) {
    const list = map['assume'];
    if (!Array.isArray(list)) return 'assume must be a list';
    if (list.length > ESTIMATE_MAX) return `assume holds at most ${ESTIMATE_MAX} entries`;
    for (let i = 0; i < list.length; i++) {
      const at = i + 1;
      const entry: unknown = list[i];
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return `assume[${at}] must be an object`;
      const e = entry as Record<string, unknown>;
      const key = Object.keys(e).find((k) => k !== 'id' && k !== 'effort' && k !== 'value');
      if (key !== undefined) return `assume[${at}]: unknown field ${key.slice(0, 40)}`;
      if (!validTaskId(e['id'])) return `assume[${at}].id must be <area>/<slug>`;
      if ('effort' in e) {
        const eff = e['effort'];
        if (typeof eff !== 'string' || eff === '' || eff.length > 12 || !/^[\x00-\x7f]*$/.test(eff)) {
          return `assume[${at}].effort must be a short word`;
        }
      }
      if ('value' in e && !Number.isSafeInteger(e['value'])) return `assume[${at}].value must be a whole number`;
    }
  }
  return map;
}

/** The operations a page may ask for (`OPS_ALLOWED` of the Rust hub). */
export const OPS_ALLOWED = [
  'set',
  'new',
  'reorder',
  'done',
  'move_area',
  'plan_new',
  'project_new',
  'plan_set',
  'project_set',
  'plan_close',
  'project_close',
  'tick_step',
  'answer',
  'add_steps',
  'append_note',
  'reopen',
  'set_body',
  'view_save',
  'view_delete',
  'attach',
  // the learning paths: the state (and XP) of a point, a point made a task and taken back, a reward granted
  'node_set',
  'promote',
  'unpromote',
  'path_reward',
  'history_record',
];
const OPS_FIELDS = ['schema', 'client_op_id', 'dry_run', 'ops'];
/** The most operations in one request (the engine's limit). */
export const OPS_MAX = 100;

/**
 * The form and the size of a request of `ops`, before the engine is asked: what is plainly not one is refused here, the
 * rules of the tasks are the engine's (`check_ops_request`). Returns the request, or the reason it is refused.
 */
export function checkOpsRequest(body: string): { value: Record<string, unknown>; ops: Array<Record<string, unknown>> } | string {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return 'the body is not JSON';
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'the request must be a JSON object';
  const map = value as Record<string, unknown>;
  // The Rust hub names the first unknown key in the order of its (sorted) map.
  const unknown = Object.keys(map)
    .sort()
    .find((k) => !OPS_FIELDS.includes(k));
  if (unknown !== undefined) return `unknown field ${unknown.slice(0, 40)} in the request`;
  const ops = map['ops'];
  if (!Array.isArray(ops)) return 'ops must be a list';
  if (ops.length === 0 || ops.length > OPS_MAX) return `ops holds 1 to ${OPS_MAX} operations`;
  const named: Array<Record<string, unknown>> = [];
  for (let i = 0; i < ops.length; i++) {
    const op: unknown = ops[i];
    const name = typeof op === 'object' && op !== null && !Array.isArray(op) ? (op as Record<string, unknown>)['op'] : undefined;
    if (typeof name !== 'string') return `ops[${i + 1}] has no op`;
    if (!OPS_ALLOWED.includes(name)) return `ops[${i + 1}]: unknown operation`;
    named.push(op as Record<string, unknown>);
  }
  if (named.filter((op) => op['op'] === 'attach').length > 1) return 'at most one attach in a request';
  if ('client_op_id' in map) {
    const id = map['client_op_id'];
    if (typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(id)) {
      return 'client_op_id is 1 to 64 letters, digits and . _ : -';
    }
  }
  if ('dry_run' in map && typeof map['dry_run'] !== 'boolean') return 'dry_run must be true or false';
  return { value: map, ops: named };
}

/** Whether an answer of `ops` says that a file was written (some entry names changed ids). Unreadable: assume so. */
function wrote(text: string): boolean {
  try {
    const results = (JSON.parse(text) as { results?: unknown }).results;
    if (!Array.isArray(results)) return true;
    return results.some((e) => Array.isArray((e as { changed_ids?: unknown }).changed_ids) && (e as { changed_ids: unknown[] }).changed_ids.length > 0);
  } catch {
    return true;
  }
}

/** One short line without control characters, as the engine's messages are told. */
function clipMessage(message: string): string {
  // eslint-disable-next-line no-control-regex
  return message.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 512);
}

function plainCode(code: string): string {
  return /^[a-z_]{1,48}$/.test(code) ? code : 'engine_failed';
}
