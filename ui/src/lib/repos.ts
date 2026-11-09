// The repo tiles of this device: repos as tiles in groups under titles of one's own, a page of favourites. The hub
// holds the file (`repos.json`, of this device) and answers with `hub.repos`, which never names a path; this works out
// the next order with pure functions and sends it whole (`repos/save`, on the state read). A repo is there once and a
// group names it by id: one tile can stand in several groups, and a new name holds everywhere.

/** One repo as the hub tells it: its name, the last part of its folder, whether it has an image, its area. */
export interface RepoTile {
  name: string;
  label: string;
  image: boolean;
  area: string | null;
}

/** One group: its id, its title and its tiles in order. */
export interface RepoGroup {
  id: string;
  title: string;
  tiles: string[];
}

/** The document `hub.repos`. `problem` says the file of the hub is not usable (an empty page then, with why). */
export interface HubRepos {
  kind: 'hub.repos';
  rev: string;
  repos: Record<string, RepoTile>;
  groups: RepoGroup[];
  problem?: 'invalid';
  message?: string;
}

/** What `repos/save` takes: the groups and the names, on the state read. */
export interface SaveBody {
  rev: string;
  groups: RepoGroup[];
  names: Record<string, string>;
}

const ID = /^[a-z0-9]{8}$/;

const isText = (v: unknown): v is string => typeof v === 'string';

/**
 * Read an answer of the hub as `hub.repos`, refusing what is not one: an unknown field is left, a repo or a group that
 * is not whole is dropped, a tile of a repo that is not there is dropped. Anything that is no document at all is an
 * empty one that says it is broken.
 */
export function parseRepos(value: unknown): HubRepos {
  const broken: HubRepos = { kind: 'hub.repos', rev: '', repos: {}, groups: [], problem: 'invalid' };
  if (typeof value !== 'object' || value === null) return broken;
  const doc = value as Record<string, unknown>;
  if (doc['kind'] !== 'hub.repos' || !isText(doc['rev'])) return broken;
  const repos: Record<string, RepoTile> = {};
  const given = doc['repos'];
  if (typeof given === 'object' && given !== null && !Array.isArray(given)) {
    for (const [id, raw] of Object.entries(given as Record<string, unknown>)) {
      if (!ID.test(id) || typeof raw !== 'object' || raw === null) continue;
      const r = raw as Record<string, unknown>;
      if (!isText(r['name']) || !isText(r['label'])) continue;
      repos[id] = { name: r['name'], label: r['label'], image: r['image'] === true, area: isText(r['area']) ? r['area'] : null };
    }
  }
  const groups: RepoGroup[] = [];
  for (const raw of Array.isArray(doc['groups']) ? doc['groups'] : []) {
    if (typeof raw !== 'object' || raw === null) continue;
    const g = raw as Record<string, unknown>;
    if (!isText(g['id']) || !ID.test(g['id']) || !isText(g['title'])) continue;
    const tiles = (Array.isArray(g['tiles']) ? g['tiles'] : []).filter((t): t is string => isText(t) && t in repos);
    groups.push({ id: g['id'], title: g['title'], tiles: tiles.filter((t, i) => tiles.indexOf(t) === i) });
  }
  const out: HubRepos = { kind: 'hub.repos', rev: doc['rev'], repos, groups };
  if (doc['problem'] === 'invalid') {
    out.problem = 'invalid';
    if (isText(doc['message'])) out.message = doc['message'];
  }
  return out;
}

const copyGroups = (groups: readonly RepoGroup[]): RepoGroup[] => groups.map((g) => ({ ...g, tiles: [...g.tiles] }));

/**
 * The tile `id` taken from the group `from` and put into the group `to` at `index` (the end when it is past it). Within
 * one group it is a new place; into a group that holds it already it only moves there. An unknown group changes nothing.
 */
export function tileMoved(groups: readonly RepoGroup[], id: string, from: string, to: string, index: number): RepoGroup[] {
  const out = copyGroups(groups);
  const source = out.find((g) => g.id === from);
  const target = out.find((g) => g.id === to);
  if (!source || !target || !source.tiles.includes(id)) return out;
  source.tiles = source.tiles.filter((t) => t !== id);
  target.tiles = target.tiles.filter((t) => t !== id);
  const at = Math.max(0, Math.min(index, target.tiles.length));
  target.tiles.splice(at, 0, id);
  return out;
}

/** The tile `id` put into the group `to` as well (at its end), when it is not there. */
export function tileCopied(groups: readonly RepoGroup[], id: string, to: string): RepoGroup[] {
  const out = copyGroups(groups);
  const target = out.find((g) => g.id === to);
  if (target && !target.tiles.includes(id)) target.tiles.push(id);
  return out;
}

/** The tile `id` taken out of the group `from` only (a repo no group holds any more is gone on the hub). */
export function tileTaken(groups: readonly RepoGroup[], id: string, from: string): RepoGroup[] {
  return copyGroups(groups).map((g) => (g.id === from ? { ...g, tiles: g.tiles.filter((t) => t !== id) } : g));
}

/** The repo `id` out of every group: the tile is gone everywhere. */
export function repoRemoved(groups: readonly RepoGroup[], id: string): RepoGroup[] {
  return copyGroups(groups).map((g) => ({ ...g, tiles: g.tiles.filter((t) => t !== id) }));
}

/** A new group at the end, with the id given (made by `newId`). */
export function groupAdded(groups: readonly RepoGroup[], title: string, id: string): RepoGroup[] {
  return [...copyGroups(groups), { id, title: title.trim(), tiles: [] }];
}

/** The title of a group. */
export function groupRenamed(groups: readonly RepoGroup[], id: string, title: string): RepoGroup[] {
  return copyGroups(groups).map((g) => (g.id === id ? { ...g, title: title.trim() } : g));
}

/** A group one place up (`-1`) or down (`1`); at the edge nothing changes. */
export function groupMoved(groups: readonly RepoGroup[], id: string, dir: -1 | 1): RepoGroup[] {
  const out = copyGroups(groups);
  const at = out.findIndex((g) => g.id === id);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= out.length) return out;
  const [group] = out.splice(at, 1);
  out.splice(to, 0, group!);
  return out;
}

/** A group taken away (its tiles stay in the other groups that hold them). */
export function groupRemoved(groups: readonly RepoGroup[], id: string): RepoGroup[] {
  return copyGroups(groups).filter((g) => g.id !== id);
}

/** The letter a tile without an image shows: the first character of its name, upper case. */
export function initial(name: string): string {
  const first = [...name.trim()][0];
  return first ? first.toLocaleUpperCase() : '?';
}

/** A new id of a group: 8 lowercase letters or digits from `random` (bytes; the page gives `crypto.getRandomValues`). */
export function newId(random: (bytes: Uint8Array) => Uint8Array, taken: (id: string) => boolean = () => false): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const bytes = random(new Uint8Array(8));
    const id = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
    if (!taken(id)) return id;
  }
  throw new Error('no free id');
}

/** What the page sends to save `groups` and new `names` on the state of `doc`. */
export function saveBody(doc: HubRepos, groups: readonly RepoGroup[], names: Record<string, string> = {}): SaveBody {
  return { rev: doc.rev, groups: copyGroups(groups), names: { ...names } };
}
