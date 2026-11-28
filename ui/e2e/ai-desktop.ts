import { mkdirSync, writeFileSync } from 'node:fs';
import type { IncomingHttpHeaders } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { removeTree } from '../web/tmp.mjs';

/**
 * ai-desktop as a double for the hub of the run: its `hub.json` and `control.secret` in the config folder the hub is
 * given (`AI_DESKTOP_CONFIG_DIR`, see `env` in hub.ts), a server that answers `/health` and `/jobs` and keeps what came.
 * This process stands in for its pid, so the record counts as running. `config` is the config folder of the run.
 */
export async function aiDesktopDoubleIn(config: string, jobs: (body: Record<string, unknown>, path: string) => { status: number; body: unknown }) {
  const dir = join(config, '..', 'ai-desktop');
  mkdirSync(dir, { recursive: true });
  const secret = 'ab'.repeat(32);
  const instance = 'e2e-instance';
  const seen: { path: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }[] = [];
  const server = createServer((req, res) => {
    let text = '';
    req.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
    req.on('end', () => {
      const body = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
      seen.push({ path: req.url ?? '', headers: req.headers, body });
      const answer = req.url === '/health' ? { status: 200, body: { app: 'ai-desktop', version: '0.1.0', instance } } : jobs(body, req.url ?? '');
      res.writeHead(answer.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as AddressInfo).port;
  writeFileSync(join(dir, 'hub.json'), JSON.stringify({ app: 'ai-desktop', port, pid: process.pid, version: '0.1.0', instance }));
  writeFileSync(join(dir, 'control.secret'), `${secret}\n`);
  return {
    port,
    secret,
    seen,
    close: async () => {
      removeTree(dir);
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

