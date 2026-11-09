import crypto from 'node:crypto';
import { tx } from './db.js';

type SeedNode = {
  key: string;
  parent: string | null;
  kind: 'folder' | 'list';
  title: string;
  expanded: boolean;
  pos: number;
};

type SeedItem = {
  key?: string;
  list: string;
  parent: string | null;
  kind: 'task' | 'comment';
  body: string;
  status: 'empty' | 'done' | 'failed';
  pos: number;
};

const nodes: SeedNode[] = [
  { key: 'f1', parent: null, kind: 'folder', title: 'Folder 1', expanded: false, pos: 0 },
  { key: 'f2', parent: null, kind: 'folder', title: 'Folder 2', expanded: false, pos: 1 },
  { key: 'f3', parent: null, kind: 'folder', title: 'Folder 3', expanded: false, pos: 2 },
  { key: 'f4', parent: null, kind: 'folder', title: 'Folder 4', expanded: true, pos: 3 },
  { key: 'f5', parent: 'f1', kind: 'folder', title: 'Folder 5', expanded: false, pos: 0 },
  { key: 'l7', parent: 'f5', kind: 'list', title: 'List 7', expanded: false, pos: 0 },
  { key: 'l5', parent: 'f4', kind: 'list', title: 'List 5', expanded: false, pos: 0 },
  { key: 'l1', parent: 'f4', kind: 'list', title: 'List 1', expanded: false, pos: 1 },
  { key: 'l2', parent: 'f4', kind: 'list', title: 'List 2', expanded: false, pos: 2 },
  { key: 'l3', parent: 'f4', kind: 'list', title: 'List 3', expanded: false, pos: 3 },
  { key: 'l4', parent: 'f4', kind: 'list', title: 'List 4', expanded: false, pos: 4 },
];

const items: SeedItem[] = [
  { list: 'l7', parent: null, kind: 'task', body: 'Task', status: 'empty', pos: 0 },
  { list: 'l5', parent: null, kind: 'task', body: 'Task', status: 'done', pos: 0 },
  { list: 'l2', parent: null, kind: 'task', body: 'Task 1', status: 'done', pos: 0 },
  { list: 'l2', parent: null, kind: 'task', body: 'Task 2', status: 'failed', pos: 1 },
  { key: 't3', list: 'l2', parent: null, kind: 'task', body: 'Task 3', status: 'empty', pos: 2 },
  { list: 'l2', parent: 't3', kind: 'task', body: 'Subtask 1', status: 'done', pos: 0 },
  { list: 'l2', parent: 't3', kind: 'task', body: 'Subtask 2', status: 'empty', pos: 1 },
  { list: 'l2', parent: 't3', kind: 'task', body: 'Subtask 3', status: 'empty', pos: 2 },
  { list: 'l2', parent: null, kind: 'task', body: 'Task 4', status: 'empty', pos: 3 },
  { list: 'l2', parent: null, kind: 'task', body: 'Task 5', status: 'empty', pos: 4 },
  { list: 'l2', parent: null, kind: 'task', body: 'Task 6', status: 'empty', pos: 5 },
  { list: 'l3', parent: null, kind: 'task', body: 'Task', status: 'empty', pos: 0 },
  { list: 'l3', parent: null, kind: 'comment', body: 'Comment', status: 'empty', pos: 1 },
  { list: 'l4', parent: null, kind: 'task', body: 'Task', status: 'empty', pos: 0 },
];

export async function seedIfEmpty(userId: string) {
  await tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [userId]);
    const existing = await client.query('SELECT 1 FROM nodes WHERE user_id = $1 LIMIT 1', [userId]);
    if (existing.rows.length) return;

    const nodeIds = new Map<string, string>();
    for (const node of nodes) {
      const id = crypto.randomUUID();
      nodeIds.set(node.key, id);
      await client.query(
        `INSERT INTO nodes (id, user_id, parent_id, kind, title, expanded, pos)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, userId, node.parent ? nodeIds.get(node.parent) : null, node.kind, node.title, node.expanded, node.pos],
      );
    }

    const itemIds = new Map<string, string>();
    for (const item of items) {
      const id = crypto.randomUUID();
      if (item.key) itemIds.set(item.key, id);
      await client.query(
        `INSERT INTO items (id, user_id, list_id, parent_id, kind, body, status, pos)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          userId,
          nodeIds.get(item.list),
          item.parent ? itemIds.get(item.parent) : null,
          item.kind,
          item.body,
          item.status,
          item.pos,
        ],
      );
    }
  });
}
