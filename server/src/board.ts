import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import type { PoolClient } from 'pg';
import { pool, tx } from './db.js';
import { HttpError, UUID, parseOptionalId, parseTitle } from './http.js';
import { seedIfEmpty } from './seed.js';
import { wrap } from './wrap.js';

type NodeKind = 'folder' | 'list';
type ItemKind = 'task' | 'comment';
type Status = 'empty' | 'done' | 'failed';

type NodeRow = {
  id: string;
  parent_id: string | null;
  kind: NodeKind;
  title: string;
  expanded: boolean;
  pos: number;
  updated_at: Date | string;
};

type ItemRow = {
  id: string;
  list_id: string;
  parent_id: string | null;
  kind: ItemKind;
  body: string;
  status: Status;
  pos: number;
};

type Group = { parentId: string | null; orderedIds: string[] };

async function rollParent(client: PoolClient, parentId: string | null, owner: string) {
  if (!parentId) return;
  const kids = await client.query<{ status: Status }>(
    `SELECT status FROM items WHERE parent_id = $1 AND user_id = $2 AND kind = 'task'`,
    [parentId, owner],
  );
  if (!kids.rows.length) return;
  const status = kids.rows[0].status;
  if (!kids.rows.every((row) => row.status === status)) return;
  await client.query(
    `UPDATE items SET status = $1, updated_at = now() WHERE id = $2 AND user_id = $3 AND kind = 'task' AND status IS DISTINCT FROM $1`,
    [status, parentId, owner],
  );
}

function userId(req: Request) {
  const id = req.session?.userId;
  if (!id) throw new HttpError(401, 'Нужен вход');
  return id;
}

function bodyOf(req: Request) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return {};
  return req.body as Record<string, unknown>;
}

function mapNode(row: NodeRow) {
  return {
    id: row.id,
    parentId: row.parent_id,
    kind: row.kind,
    title: row.title,
    expanded: row.expanded,
    position: row.pos,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapItem(row: ItemRow) {
  return {
    id: row.id,
    listId: row.list_id,
    parentId: row.parent_id,
    kind: row.kind,
    body: row.body,
    status: row.status,
    position: row.pos,
  };
}

async function readBoard(owner: string) {
  const nodes = await pool.query<NodeRow>(
    'SELECT id, parent_id, kind, title, expanded, pos, updated_at FROM nodes WHERE user_id = $1 ORDER BY pos',
    [owner],
  );
  const items = await pool.query<ItemRow>(
    'SELECT id, list_id, parent_id, kind, body, status, pos FROM items WHERE user_id = $1 ORDER BY pos',
    [owner],
  );
  return { nodes: nodes.rows.map(mapNode), items: items.rows.map(mapItem) };
}

function parseGroups(value: unknown): Group[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { groups?: unknown }).groups)) {
    throw new HttpError(400, 'Не удалось сохранить');
  }
  const groups = (value as { groups: unknown[] }).groups;
  if (!groups.length || groups.length > 50) throw new HttpError(400, 'Не удалось сохранить');
  let count = 0;
  return groups.map((group) => {
    if (!group || typeof group !== 'object') throw new HttpError(400, 'Не удалось сохранить');
    const raw = group as { parentId?: unknown; orderedIds?: unknown };
    const parentId = parseOptionalId(raw.parentId);
    if (!Array.isArray(raw.orderedIds)) throw new HttpError(400, 'Элемент не найден');
    const orderedIds = raw.orderedIds.map((id) => {
      if (typeof id !== 'string' || !UUID.test(id)) throw new HttpError(400, 'Элемент не найден');
      return id;
    });
    count += orderedIds.length;
    if (count > 2000) throw new HttpError(400, 'Не удалось сохранить');
    return { parentId, orderedIds };
  });
}

function nodeKind(value: unknown): NodeKind {
  if (value === 'folder' || value === 'list') return value;
  throw new HttpError(400, 'Не удалось сохранить');
}

function itemKind(value: unknown): ItemKind {
  if (value === 'task' || value === 'comment') return value;
  throw new HttpError(400, 'Не удалось сохранить');
}

function statusOf(value: unknown): Status {
  if (value === 'empty' || value === 'done' || value === 'failed') return value;
  throw new HttpError(400, 'Не удалось сохранить');
}

function walksToSelf(parentOf: Map<string, string | null>, id: string, parentId: string | null) {
  let current = parentId;
  const seen = new Set<string>();
  while (current) {
    if (current === id) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    current = parentOf.get(current) ?? null;
  }
  return false;
}

async function touchList(client: PoolClient, listId: string) {
  await client.query(`UPDATE nodes SET updated_at = now() WHERE id = $1 AND kind = 'list'`, [listId]);
}

function copiedTitle(title: string) {
  const suffix = ' копия';
  if (title.length + suffix.length <= 120) return `${title}${suffix}`;
  return `${title.slice(0, 120 - suffix.length).trim()}${suffix}`;
}

export const board = Router();

board.get('/board', wrap(async (req, res) => {
  const owner = userId(req);
  await seedIfEmpty(owner);
  res.json(await readBoard(owner));
}));

board.post('/nodes', wrap(async (req, res) => {
  const owner = userId(req);
  const body = bodyOf(req);
  const kind = nodeKind(body.kind);
  const title = parseTitle(body.title, 120, 'Название не может быть пустым', 'Название длиннее 120 символов');
  const parentId = parseOptionalId(body.parentId);
  const afterId = parseOptionalId(body.afterId);
  const createdId = await tx(async (client) => {
    if (parentId) {
      const parent = await client.query<{ kind: string }>('SELECT kind FROM nodes WHERE id = $1 AND user_id = $2', [parentId, owner]);
      if (parent.rows[0]?.kind !== 'folder') throw new HttpError(400, 'Папка не найдена');
      await client.query(`UPDATE nodes SET expanded = true WHERE id = $1`, [parentId]);
    }
    let pos = 0;
    if (afterId) {
      const after = await client.query<{ parent_id: string | null; pos: number }>(
        'SELECT parent_id, pos FROM nodes WHERE id = $1 AND user_id = $2',
        [afterId, owner],
      );
      if (!after.rows[0] || (after.rows[0].parent_id ?? null) !== parentId) throw new HttpError(400, 'Элемент не найден');
      pos = after.rows[0].pos + 1;
      await client.query(
        `UPDATE nodes SET pos = pos + 1 WHERE user_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND pos > $3`,
        [owner, parentId, after.rows[0].pos],
      );
    } else {
      const max = await client.query<{ pos: number }>(
        `SELECT COALESCE(MAX(pos), -1) + 1 AS pos FROM nodes WHERE user_id = $1 AND parent_id IS NOT DISTINCT FROM $2`,
        [owner, parentId],
      );
      pos = max.rows[0].pos;
    }
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO nodes (id, user_id, parent_id, kind, title, expanded, pos) VALUES ($1, $2, $3, $4, $5, false, $6)`,
      [id, owner, parentId, kind, title, pos],
    );
    return id;
  });
  res.json({ ...(await readBoard(owner)), createdId });
}));

board.patch('/nodes/:id', wrap(async (req, res) => {
  const owner = userId(req);
  const id = parseTitleSafeId(req.params.id);
  const body = bodyOf(req);
  const hasTitle = body.title !== undefined;
  const hasExpanded = body.expanded !== undefined;
  if (!hasTitle && !hasExpanded) throw new HttpError(400, 'Не удалось сохранить');
  await tx(async (client) => {
    const current = await client.query<{ kind: NodeKind }>('SELECT kind FROM nodes WHERE id = $1 AND user_id = $2', [id, owner]);
    if (!current.rows[0]) throw new HttpError(400, 'Элемент не найден');
    if (hasTitle) {
      const title = parseTitle(body.title, 120, 'Название не может быть пустым', 'Название длиннее 120 символов');
      await client.query(
        `UPDATE nodes SET title = $1, updated_at = CASE WHEN kind = 'list' THEN now() ELSE updated_at END WHERE id = $2 AND user_id = $3`,
        [title, id, owner],
      );
    }
    if (hasExpanded) {
      if (typeof body.expanded !== 'boolean') throw new HttpError(400, 'Не удалось сохранить');
      if (current.rows[0].kind === 'folder') {
        await client.query('UPDATE nodes SET expanded = $1 WHERE id = $2 AND user_id = $3', [body.expanded, id, owner]);
      }
    }
  });
  res.json(await readBoard(owner));
}));

board.delete('/nodes/:id', wrap(async (req, res) => {
  const owner = userId(req);
  const id = parseTitleSafeId(req.params.id);
  const removed = await pool.query('DELETE FROM nodes WHERE id = $1 AND user_id = $2', [id, owner]);
  if (!removed.rowCount) throw new HttpError(400, 'Элемент не найден');
  res.json(await readBoard(owner));
}));

board.post('/nodes/:id/copy', wrap(async (req, res) => {
  const owner = userId(req);
  const id = parseTitleSafeId(req.params.id);
  const createdId = await tx(async (client) => {
    const nodes = await client.query<NodeRow>('SELECT id, parent_id, kind, title, expanded, pos, updated_at FROM nodes WHERE user_id = $1', [owner]);
    const items = await client.query<ItemRow>('SELECT id, list_id, parent_id, kind, body, status, pos FROM items WHERE user_id = $1', [owner]);
    const byId = new Map(nodes.rows.map((row) => [row.id, row]));
    const root = byId.get(id);
    if (!root) throw new HttpError(400, 'Элемент не найден');
    const children = new Map<string, NodeRow[]>();
    for (const row of nodes.rows) {
      if (!row.parent_id) continue;
      const list = children.get(row.parent_id) ?? [];
      list.push(row);
      children.set(row.parent_id, list);
    }
    const order: NodeRow[] = [];
    const walk = (node: NodeRow) => {
      order.push(node);
      for (const child of (children.get(node.id) ?? []).slice().sort((a, b) => a.pos - b.pos)) walk(child);
    };
    walk(root);
    const map = new Map(order.map((row) => [row.id, crypto.randomUUID()]));
    await client.query(
      `UPDATE nodes SET pos = pos + 1 WHERE user_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND pos > $3`,
      [owner, root.parent_id, root.pos],
    );
    for (const row of order) {
      const parent = row.id === root.id ? root.parent_id : map.get(row.parent_id || '') ?? null;
      await client.query(
        `INSERT INTO nodes (id, user_id, parent_id, kind, title, expanded, pos)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          map.get(row.id),
          owner,
          parent,
          row.kind,
          row.id === root.id ? copiedTitle(row.title) : row.title,
          row.expanded,
          row.id === root.id ? root.pos + 1 : row.pos,
        ],
      );
    }
    const listIds = new Set(order.filter((row) => row.kind === 'list').map((row) => row.id));
    const related = items.rows.filter((row) => listIds.has(row.list_id));
    const itemById = new Map(related.map((row) => [row.id, row]));
    const depth = (row: ItemRow) => {
      let value = 0;
      let current: ItemRow | undefined = row;
      const seen = new Set<string>();
      while (current?.parent_id && !seen.has(current.id)) {
        seen.add(current.id);
        value += 1;
        current = itemById.get(current.parent_id);
      }
      return value;
    };
    const itemMap = new Map<string, string>();
    for (const row of related.slice().sort((a, b) => depth(a) - depth(b))) {
      const copyId = crypto.randomUUID();
      itemMap.set(row.id, copyId);
      await client.query(
        `INSERT INTO items (id, user_id, list_id, parent_id, kind, body, status, pos)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [copyId, owner, map.get(row.list_id), row.parent_id ? itemMap.get(row.parent_id) ?? null : null, row.kind, row.body, row.status, row.pos],
      );
    }
    return map.get(root.id) || null;
  });
  res.json({ ...(await readBoard(owner)), createdId });
}));

board.post('/nodes/layout', wrap(async (req, res) => {
  const owner = userId(req);
  const groups = parseGroups(req.body);
  await tx(async (client) => {
    const nodes = await client.query<NodeRow>('SELECT id, parent_id, kind, title, expanded, pos, updated_at FROM nodes WHERE user_id = $1', [owner]);
    const byId = new Map(nodes.rows.map((row) => [row.id, row]));
    const parentOf = new Map(nodes.rows.map((row) => [row.id, row.parent_id]));
    const seen = new Set<string>();
    for (const group of groups) {
      for (const id of group.orderedIds) {
        if (seen.has(id) || !byId.has(id)) throw new HttpError(400, 'Элемент не найден');
        seen.add(id);
        parentOf.set(id, group.parentId);
      }
    }
    for (const parentId of parentOf.values()) {
      if (!parentId) continue;
      if (byId.get(parentId)?.kind !== 'folder') throw new HttpError(400, 'Папка не найдена');
    }
    for (const [id, parentId] of parentOf) {
      if (walksToSelf(parentOf, id, parentId)) throw new HttpError(400, 'Папку нельзя вложить саму в себя');
    }
    for (const group of groups) {
      for (let index = 0; index < group.orderedIds.length; index++) {
        await client.query('UPDATE nodes SET parent_id = $1, pos = $2 WHERE id = $3 AND user_id = $4', [
          group.parentId,
          index,
          group.orderedIds[index],
          owner,
        ]);
      }
      if (group.parentId) {
        await client.query(`UPDATE nodes SET expanded = true WHERE id = $1 AND user_id = $2 AND kind = 'folder'`, [group.parentId, owner]);
      }
    }
  });
  res.json(await readBoard(owner));
}));

board.post('/nodes/sort', wrap(async (req, res) => {
  const owner = userId(req);
  const parentId = parseOptionalId(bodyOf(req).parentId);
  await tx(async (client) => {
    if (parentId) {
      const parent = await client.query<{ kind: string }>('SELECT kind FROM nodes WHERE id = $1 AND user_id = $2', [parentId, owner]);
      if (parent.rows[0]?.kind !== 'folder') throw new HttpError(400, 'Папка не найдена');
    }
    const body = bodyOf(req);
    const by = body.by === 'time' ? 'time' : 'alpha';
    const dir = body.dir === 'desc' ? 'desc' : 'asc';
    const kids = await client.query<{ id: string; title: string; pos: number; updated_at: Date | string }>(
      'SELECT id, title, pos, updated_at FROM nodes WHERE user_id = $1 AND parent_id IS NOT DISTINCT FROM $2',
      [owner, parentId],
    );
    const ordered = kids.rows.slice().sort((a, b) => {
      const time = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      const title = a.title.localeCompare(b.title, 'ru', { sensitivity: 'base' });
      const raw = by === 'time' ? (time || title) : (title || time);
      return (dir === 'desc' ? -raw : raw) || a.pos - b.pos;
    });
    for (let index = 0; index < ordered.length; index++) {
      await client.query('UPDATE nodes SET pos = $1 WHERE id = $2 AND user_id = $3', [index, ordered[index].id, owner]);
    }
  });
  res.json(await readBoard(owner));
}));

board.post('/items', wrap(async (req, res) => {
  const owner = userId(req);
  const body = bodyOf(req);
  const listId = parseTitleSafeId(typeof body.listId === 'string' ? body.listId : '');
  const parentId = parseOptionalId(body.parentId);
  const afterId = parseOptionalId(body.afterId);
  const kind = itemKind(body.kind);
  const text = parseTitle(body.body, 500, 'Текст не может быть пустым', 'Текст длиннее 500 символов');
  const createdId = await tx(async (client) => {
    const list = await client.query<{ kind: string }>('SELECT kind FROM nodes WHERE id = $1 AND user_id = $2', [listId, owner]);
    if (list.rows[0]?.kind !== 'list') throw new HttpError(400, 'Список не найден');
    if (parentId) {
      if (kind !== 'task') throw new HttpError(400, 'Комментарий остаётся в корне списка');
      const parent = await client.query<ItemRow>(
        'SELECT id, list_id, parent_id, kind, body, status, pos FROM items WHERE id = $1 AND user_id = $2',
        [parentId, owner],
      );
      const row = parent.rows[0];
      if (!row || row.list_id !== listId || row.kind !== 'task' || row.parent_id) {
        throw new HttpError(400, 'Подзадача остаётся на одном уровне');
      }
    }
    let pos = 0;
    if (afterId) {
      const after = await client.query<{ parent_id: string | null; pos: number; list_id: string }>(
        'SELECT parent_id, pos, list_id FROM items WHERE id = $1 AND user_id = $2',
        [afterId, owner],
      );
      const row = after.rows[0];
      if (!row || row.list_id !== listId || (row.parent_id ?? null) !== parentId) throw new HttpError(400, 'Элемент не найден');
      pos = row.pos + 1;
      await client.query(
        `UPDATE items SET pos = pos + 1 WHERE list_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND pos > $3`,
        [listId, parentId, row.pos],
      );
    } else {
      const max = await client.query<{ pos: number }>(
        `SELECT COALESCE(MAX(pos), -1) + 1 AS pos FROM items WHERE list_id = $1 AND parent_id IS NOT DISTINCT FROM $2`,
        [listId, parentId],
      );
      pos = max.rows[0].pos;
    }
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO items (id, user_id, list_id, parent_id, kind, body, status, pos) VALUES ($1, $2, $3, $4, $5, $6, 'empty', $7)`,
      [id, owner, listId, parentId, kind, text, pos],
    );
    await touchList(client, listId);
    return id;
  });
  res.json({ ...(await readBoard(owner)), createdId });
}));

board.patch('/items/:id', wrap(async (req, res) => {
  const owner = userId(req);
  const id = parseTitleSafeId(req.params.id);
  const body = bodyOf(req);
  if (body.body === undefined && body.status === undefined) throw new HttpError(400, 'Не удалось сохранить');
  await tx(async (client) => {
    const current = await client.query<ItemRow>(
      'SELECT id, list_id, parent_id, kind, body, status, pos FROM items WHERE id = $1 AND user_id = $2',
      [id, owner],
    );
    const row = current.rows[0];
    if (!row) throw new HttpError(400, 'Элемент не найден');
    if (body.body !== undefined) {
      const text = parseTitle(body.body, 500, 'Текст не может быть пустым', 'Текст длиннее 500 символов');
      await client.query('UPDATE items SET body = $1, updated_at = now() WHERE id = $2', [text, id]);
    }
    if (body.status !== undefined && row.kind === 'task') {
      const status = statusOf(body.status);
      await client.query(
        `WITH RECURSIVE tree AS (
           SELECT id FROM items WHERE id = $1 AND user_id = $2
           UNION ALL
           SELECT child.id FROM items child JOIN tree ON child.parent_id = tree.id
         )
         UPDATE items SET status = $3, updated_at = now()
         WHERE id IN (SELECT id FROM tree) AND kind = 'task'`,
        [id, owner, status],
      );
      await rollParent(client, row.parent_id, owner);
    }
    await touchList(client, row.list_id);
  });
  res.json(await readBoard(owner));
}));

board.delete('/items/:id', wrap(async (req, res) => {
  const owner = userId(req);
  const id = parseTitleSafeId(req.params.id);
  await tx(async (client) => {
    const current = await client.query<{ list_id: string; parent_id: string | null }>('SELECT list_id, parent_id FROM items WHERE id = $1 AND user_id = $2', [id, owner]);
    if (!current.rows[0]) throw new HttpError(400, 'Элемент не найден');
    await client.query('DELETE FROM items WHERE id = $1 AND user_id = $2', [id, owner]);
    await rollParent(client, current.rows[0].parent_id, owner);
    await touchList(client, current.rows[0].list_id);
  });
  res.json(await readBoard(owner));
}));

board.post('/items/layout', wrap(async (req, res) => {
  const owner = userId(req);
  const groups = parseGroups(req.body);
  await tx(async (client) => {
    const items = await client.query<ItemRow>('SELECT id, list_id, parent_id, kind, body, status, pos FROM items WHERE user_id = $1', [owner]);
    const byId = new Map(items.rows.map((row) => [row.id, row]));
    const parentOf = new Map(items.rows.map((row) => [row.id, row.parent_id]));
    const seen = new Set<string>();
    for (const group of groups) {
      for (const id of group.orderedIds) {
        if (seen.has(id) || !byId.has(id)) throw new HttpError(400, 'Элемент не найден');
        seen.add(id);
        parentOf.set(id, group.parentId);
      }
    }
    const lists = new Set([...seen].map((id) => byId.get(id)?.list_id));
    if (lists.size !== 1) throw new HttpError(400, 'Не удалось сохранить');
    for (const [id, parentId] of parentOf) {
      const row = byId.get(id);
      if (!row || !seen.has(id)) continue;
      if (!parentId) {
        if (row.kind === 'comment' || row.kind === 'task') continue;
      }
      if (row.kind !== 'task') throw new HttpError(400, 'Комментарий остаётся в корне списка');
      const parent = parentId ? byId.get(parentId) : undefined;
      if (!parent || parent.kind !== 'task' || parent.list_id !== row.list_id || parentOf.get(parent.id)) {
        throw new HttpError(400, 'Подзадача остаётся на одном уровне');
      }
      const hasChild = [...parentOf.entries()].some(([child, parent]) => parent === id && child !== id);
      if (hasChild) throw new HttpError(400, 'Подзадача остаётся на одном уровне');
    }
    for (const group of groups) {
      for (let index = 0; index < group.orderedIds.length; index++) {
        await client.query('UPDATE items SET parent_id = $1, pos = $2, updated_at = now() WHERE id = $3 AND user_id = $4', [
          group.parentId,
          index,
          group.orderedIds[index],
          owner,
        ]);
      }
    }
    const listId = [...lists][0];
    if (listId) await touchList(client, listId);
  });
  res.json(await readBoard(owner));
}));

function parseTitleSafeId(value: string) {
  if (!UUID.test(value)) throw new HttpError(400, 'Элемент не найден');
  return value;
}
