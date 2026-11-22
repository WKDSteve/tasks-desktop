// The questions of the reads of the tab "Lernpläne" over all learning paths, from the query of a route: the same rules
// as `server/learn.rs` of the hub (a name, a word of a list, a number in range); what a value means is the engine's.

import { parseRequest } from './search.ts';

type Params = Record<string, unknown>;
type Parsed = Map<string, string> | string;

/** The checks of the hub, given its plain-pair parser (`parseQuery` of `hub.ts`) and its name rules. */
export interface Rules {
  parseQuery(query: string, allowed: readonly string[]): Parsed;
  validAreaName(name: string): boolean;
  validTaskId(id: unknown): id is string;
}

export type LearnRead = 'learn_next' | 'learn_notes' | 'learn_evidence' | 'learn_history' | 'competences';


/** The most bytes of the search text of `learn_notes` (the engine's bound). */
const NOTES_QUERY_MAX = 200;

function area(rules: Rules, q: Map<string, string>, out: Params): string | null {
  const value = q.get('area');
  if (value === undefined) return null;
  if (!rules.validAreaName(value)) return 'area is not a name';
  out['area'] = value;
  return null;
}

function path(rules: Rules, q: Map<string, string>, out: Params): string | null {
  const value = q.get('path');
  if (value === undefined) return null;
  if (!rules.validTaskId(value)) return 'path must be <area>/<slug>';
  out['paths'] = [value];
  return null;
}

function done(q: Map<string, string>, out: Params): string | null {
  const value = q.get('include_done');
  if (value === undefined) return null;
  if (value !== '1') return 'include_done is 1 or absent';
  out['include_done'] = true;
  return null;
}

function number(q: Map<string, string>, key: string, min: number, max: number, why: string, out: Params): string | null {
  const value = q.get(key);
  if (value === undefined) return null;
  const n = /^[0-9]+$/.test(value) ? Number(value) : NaN;
  if (!(n >= min && n <= max)) return why;
  out[key] = n;
  return null;
}

function word(q: Map<string, string>, key: string, words: readonly string[], why: string, out: Params): string | null {
  const value = q.get(key);
  if (value === undefined) return null;
  if (!words.includes(value)) return why;
  out[key] = value;
  return null;
}

function day(q: Map<string, string>, key: string, out: Params): string | null {
  const value = q.get(key);
  if (value === undefined) return null;
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return 'since and until are days, YYYY-MM-DD';
  out[key] = value;
  return null;
}

/** The first refusal of a row of checks, or the parameters. */
function first(out: Params, checks: (string | null)[]): Params | string {
  return checks.find((c) => c !== null) ?? out;
}

/** The search text `q` of `learn_notes` (escaped as `encodeURIComponent` writes it), trimmed; '' when only blanks. */
function searchText(pairs: string[]): string | null | { error: string } {
  if (pairs.length === 0) return null;
  if (pairs.length > 1) return { error: 'q is given twice' };
  const request = parseRequest(pairs[0] as string);
  if (typeof request === 'string') return { error: request };
  if (new TextEncoder().encode(request.text).length > NOTES_QUERY_MAX) return { error: 'q is at most 200 bytes' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(request.text)) return { error: 'q holds a control character' };
  return request.text.trim();
}

/** The engine's question for a read of the tab, or why the query is refused. */
export function learnRequest(rules: Rules, name: LearnRead, query: string): Params | string {
  const out: Params = {};
  switch (name) {
    case 'learn_next': {
      const q = rules.parseQuery(query, ['area', 'path', 'machine', 'n']);
      if (typeof q === 'string') return q;
      return first(out, [
        area(rules, q, out),
        path(rules, q, out),
        word(q, 'machine', ['private', 'workstation', 'wsl'], 'machine is private, workstation or wsl', out),
        number(q, 'n', 1, 20, 'n is 1 to 20', out),
      ]);
    }
    case 'learn_notes': {
      const pairs = query === '' ? [] : query.split('&').filter((p) => p !== '');
      const text = searchText(pairs.filter((p) => p.startsWith('q=')));
      if (text !== null && typeof text === 'object') return text.error;
      const q = rules.parseQuery(pairs.filter((p) => !p.startsWith('q=')).join('&'), ['kind', 'area', 'path', 'include_done', 'limit']);
      if (typeof q === 'string') return q;
      if (text) out['query'] = text;
      return first(out, [
        word(q, 'kind', ['note', 'link', 'image'], 'kind is note, link or image', out),
        area(rules, q, out),
        path(rules, q, out),
        done(q, out),
        number(q, 'limit', 1, 500, 'limit is 1 to 500', out),
      ]);
    }
    case 'learn_evidence': {
      const q = rules.parseQuery(query, ['competence', 'area', 'path', 'include_done']);
      if (typeof q === 'string') return q;
      const competence = q.get('competence');
      if (competence !== undefined) {
        if (!rules.validTaskId(competence)) return 'competence must be <area>/<slug>';
        out['competence'] = competence;
      }
      return first(out, [area(rules, q, out), path(rules, q, out), done(q, out)]);
    }
    case 'learn_history': {
      const q = rules.parseQuery(query, ['since', 'until', 'step', 'area', 'path']);
      if (typeof q === 'string') return q;
      return first(out, [
        day(q, 'since', out),
        day(q, 'until', out),
        word(q, 'step', ['day', 'week', 'month'], 'step is day, week or month', out),
        area(rules, q, out),
        path(rules, q, out),
      ]);
    }
    case 'competences': {
      const q = rules.parseQuery(query, ['area']);
      if (typeof q === 'string') return q;
      return first(out, [area(rules, q, out)]);
    }
  }
}
