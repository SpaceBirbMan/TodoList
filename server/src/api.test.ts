import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import pg from 'pg';

await import('./env.js');
process.env.DB_SCHEMA = 'saphire_test';

const url = process.env.DATABASE_URL || 'postgres://saphire:saphire@127.0.0.1:5432/saphire';
const admin = new pg.Pool({ connectionString: url });
await admin.query('DROP SCHEMA IF EXISTS saphire_test CASCADE');
await admin.query('CREATE SCHEMA saphire_test');
await admin.end();

const { app } = await import('./app.js');
const { migrate, pool } = await import('./db.js');
await migrate();

type Board = {
  nodes: { id: string; parentId: string | null; kind: string; title: string; position: number }[];
  items: { id: string; listId: string; parentId: string | null; kind: string; body: string; status: string }[];
  createdId?: string;
};

let server: Server | undefined;
let base = '';

function cookies() {
  const jar = new Map<string, string>();
  return {
    take(res: Response) {
      for (const line of res.headers.getSetCookie()) {
        const pair = line.split(';', 1)[0];
        const cut = pair.indexOf('=');
        jar.set(pair.slice(0, cut), pair.slice(cut + 1));
      }
    },
    header() {
      return [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
    },
  };
}

async function call(path: string, jar: ReturnType<typeof cookies>, init?: { method?: string; body?: unknown }) {
  const res = await fetch(base + path, {
    method: init?.method ?? 'GET',
    headers: { 'content-type': 'application/json', cookie: jar.header() },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  jar.take(res);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) as Board & { error?: string; user?: { name: string } } : null };
}

before(async () => {
  const started = app.listen(0, '127.0.0.1');
  server = started;
  await new Promise<void>((resolve) => started.once('listening', () => resolve()));
  const address = started.address();
  if (!address || typeof address === 'string') throw new Error('port');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  const started = server;
  if (started) await new Promise<void>((resolve, reject) => started.close((error) => error ? reject(error) : resolve()));
  await pool.end();
  const cleanup = new pg.Pool({ connectionString: url });
  await cleanup.query('DROP SCHEMA IF EXISTS saphire_test CASCADE');
  await cleanup.end();
});

describe('база', { concurrency: 1 }, () => {
  const jar = cookies();

  it('без входа доска закрыта', async () => {
    const res = await call('/api/board', cookies());
    assert.equal(res.status, 401);
  });

  it('локальный вход создаёт пользователя и демо-доску', async () => {
    const login = await call('/api/auth/dev', jar, { method: 'POST', body: {} });
    assert.equal(login.status, 200);
    assert.equal(login.body?.user?.name, 'Локальный сеанс');
    const board = await call('/api/board', jar);
    assert.equal(board.status, 200);
    assert.ok(board.body?.nodes.some((node) => node.title === 'List 2'));
  });

  it('статус родителя записывается подзадачам', async () => {
    const board = await call('/api/board', jar);
    const list = board.body?.nodes.find((node) => node.title === 'List 1');
    assert.ok(list);
    const parent = await call('/api/items', jar, { method: 'POST', body: { listId: list.id, kind: 'task', body: 'Родитель' } });
    assert.equal(parent.status, 200);
    const child = await call('/api/items', jar, {
      method: 'POST',
      body: { listId: list.id, parentId: parent.body?.createdId, kind: 'task', body: 'Подзадача' },
    });
    const updated = await call(`/api/items/${parent.body?.createdId}`, jar, { method: 'PATCH', body: { status: 'failed' } });
    const rows = updated.body?.items.filter((item) => item.id === parent.body?.createdId || item.id === child.body?.createdId) ?? [];
    assert.deepEqual(rows.map((item) => item.status).sort(), ['failed', 'failed']);
  });

  it('сортировка по алфавиту пишется в pos и повторно разворачивается', async () => {
    const board = await call('/api/board', jar);
    const folder = board.body?.nodes.find((node) => node.title === 'Folder 4');
    assert.ok(folder);
    const down = await call('/api/nodes/sort', jar, { method: 'POST', body: { parentId: folder.id, by: 'alpha', dir: 'desc' } });
    const titles = (down.body?.nodes ?? [])
      .filter((node) => node.parentId === folder.id)
      .sort((a, b) => a.position - b.position)
      .map((node) => node.title);
    const sorted = [...titles].sort((a, b) => b.localeCompare(a, 'ru'));
    assert.deepEqual(titles, sorted);
    const up = await call('/api/nodes/sort', jar, { method: 'POST', body: { parentId: folder.id, by: 'alpha', dir: 'asc' } });
    const back = (up.body?.nodes ?? [])
      .filter((node) => node.parentId === folder.id)
      .sort((a, b) => a.position - b.position)
      .map((node) => node.title);
    assert.deepEqual(back, [...titles].sort((a, b) => a.localeCompare(b, 'ru')));
  });

  it('папку нельзя вложить саму в себя', async () => {
    const board = await call('/api/board', jar);
    const folder = board.body?.nodes.find((node) => node.title === 'Folder 2');
    assert.ok(folder);
    const res = await call('/api/nodes/layout', jar, {
      method: 'POST',
      body: { groups: [{ parentId: folder.id, orderedIds: [folder.id] }] },
    });
    assert.equal(res.status, 400);
    assert.match(res.body?.error ?? '', /саму в себя/);
  });

  it('пустое название не сохраняется', async () => {
    const res = await call('/api/nodes', jar, { method: 'POST', body: { kind: 'list', title: '   ' } });
    assert.equal(res.status, 400);
  });
});
