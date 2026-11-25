// What the hub of the page judges of a file the page sends, before the engine sees it: the rules of the Rust hub's
// routes `upload` (`server/upload.rs`) and `board` (`server/boards.rs`), mirrored. The engine judges the rest (the
// item, the kind's folder, a name that is taken). Pure: the routes in hub.ts hand the files to the session.

/** The kinds of a file's folder below `assets/` (`KINDS` of the hub). */
export const UPLOAD_KINDS = ['video', 'image', 'screenshot', 'audio'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

/** The largest file the page takes: it lies in memory twice (the page's and the VM's) until it is written. */
export const WEB_UPLOAD_MAX_BYTES = 256 * 1024 * 1024;

/** A file this large is said to be heavy for git (`LARGE_FOR_GIT` of the hub). */
export const LARGE_FOR_GIT = 100 * 1024 * 1024;

const IMAGES = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'heic', 'heif', 'bmp', 'tif', 'tiff', 'svg'];
const SCREENSHOTS = ['png', 'jpg', 'jpeg', 'webp', 'bmp'];
const VIDEOS = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'ogv', '3gp'];
const AUDIOS = ['m4a', 'mp3', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'weba', 'webm', 'mp4', '3gp', 'amr'];
const DOCUMENTS = [
  'pdf', 'txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml',
  'xml', 'ini', 'conf', 'diff', 'patch', 'sql', 'ics', 'vcf', 'eml', 'rtf', 'odt', 'ods', 'odp',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'gz', 'tgz', 'tar', '7z',
];

/** `kind` of the query: none (`undefined`), one of `UPLOAD_KINDS`, or `null` when it is none of them. */
export function uploadKind(value: string | undefined): UploadKind | undefined | null {
  if (value === undefined) return undefined;
  return (UPLOAD_KINDS as readonly string[]).includes(value) ? (value as UploadKind) : null;
}

/** The text of a percent-encoded header (`encodeURIComponent`); what is not an escape stays as it is. */
export function percentDecoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** A name the hub refuses outright: a control or a formatting character, or a `..` part (`refused_name`). */
export function refusedName(name: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/.test(name)) return true;
  return name.split(/[/\\]/).some((part) => part === '..');
}

/** The name the file gets (`clean_name`): its last part, every other character than a letter, digit, `_ . -` a `-`. */
export function cleanName(name: string): string {
  const last = name.split(/[/\\]/).at(-1) ?? name;
  let out = '';
  for (const c of last.trim()) {
    const keep = /[\p{L}\p{N}_.-]/u.test(c);
    const ch = keep ? c : '-';
    if (ch === '.' && out.endsWith('.')) continue;
    out += ch;
  }
  const device = (out.split('.')[0] ?? '').toLowerCase();
  if (/^(com|lpt)\d$/.test(device) || ['con', 'prn', 'aux', 'nul'].includes(device)) return `_${out}`;
  return out;
}

/** Whether the ending of `name` is one the hub takes for `kind` (`extension_allowed`); a name with none is refused. */
export function extensionAllowed(name: string, kind: UploadKind | undefined): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  switch (kind) {
    case 'image':
      return IMAGES.includes(ext);
    case 'screenshot':
      return SCREENSHOTS.includes(ext);
    case 'video':
      return VIDEOS.includes(ext);
    case 'audio':
      return AUDIOS.includes(ext);
    default:
      return [DOCUMENTS, IMAGES, VIDEOS, AUDIOS].some((list) => list.includes(ext));
  }
}

/** The `attach` of an upload (`attach_op` of the hub). */
export function attachOp(id: string, upload: string, name: string, exact: boolean, kind: UploadKind | undefined): Record<string, unknown> {
  return { op: 'attach', id, from: 'upload', upload, name, ...(exact ? { exact: true } : {}), ...(kind ? { kind } : {}) };
}

/** A name of a board (`valid_board_name`): letters, digits, `-` and `_`, starting with a letter or digit, at most 80. */
export function validBoardName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= 80 && /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(name);
}

/** The version of a board (`valid_etag`): `sha256:` and 16 hex digits. */
export function validEtag(etag: unknown): etag is string {
  return typeof etag === 'string' && /^sha256:[0-9a-fA-F]{16}$/.test(etag);
}

/** The body of `board`, judged as the hub judges it; a string says why it is refused (`code: message`). */
export function boardRequest(
  body: string,
  validId: (id: unknown) => id is string,
): { id: string; name: string; ifMatch?: string; ink: string; svg: string } | { code: string; message: string } {
  let map: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
    map = parsed as Record<string, unknown>;
  } catch {
    return { code: 'bad_request', message: 'the body is a JSON object' };
  }
  const unknown = Object.keys(map).find((k) => !['id', 'name', 'if_match', 'ink', 'svg'].includes(k));
  if (unknown !== undefined) return { code: 'bad_request', message: `unknown field ${unknown.slice(0, 40)}` };
  const id = map['id'];
  if (!validId(id)) return { code: 'bad_id', message: 'id must be <area>/<slug>' };
  const name = map['name'];
  if (!validBoardName(name)) return { code: 'bad_name', message: 'name: letters, digits, - and _, at most 80, no dot' };
  const ifMatch = map['if_match'];
  if (ifMatch !== undefined && !validEtag(ifMatch)) return { code: 'bad_if_match', message: 'if_match is the etag of the board' };
  const ink = map['ink'];
  const svg = map['svg'];
  if (typeof ink !== 'string' || typeof svg !== 'string') return { code: 'bad_board', message: 'ink and svg are the texts of the board and its preview' };
  let isObject = false;
  try {
    const parsed: unknown = JSON.parse(ink);
    isObject = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    isObject = false;
  }
  if (!isObject || !svg.trimStart().startsWith('<svg')) return { code: 'bad_board', message: 'ink is the board as a JSON object, svg an SVG of it' };
  return { id, name, ...(ifMatch !== undefined ? { ifMatch: ifMatch as string } : {}), ink, svg };
}
