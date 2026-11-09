import './env.js';
import { Pool, type PoolClient } from 'pg';

const schema = process.env.DB_SCHEMA === 'saphire_test' ? 'saphire_test' : '';
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  options: schema ? `-c search_path=${schema}` : undefined,
});

export type Db = Pool | PoolClient;

export async function waitForDb() {
  let last: unknown;
  for (let i = 0; i < 30; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw last;
}

export async function tx<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY,
      google_sub text UNIQUE NOT NULL,
      email text NOT NULL DEFAULT '',
      name text NOT NULL,
      picture text,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_id uuid REFERENCES nodes(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('folder', 'list')),
      title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
      expanded boolean NOT NULL DEFAULT false,
      pos integer NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS items (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      list_id uuid NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      parent_id uuid REFERENCES items(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('task', 'comment')),
      body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
      status text NOT NULL DEFAULT 'empty' CHECK (status IN ('empty', 'done', 'failed')),
      pos integer NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS nodes_user_parent ON nodes (user_id, parent_id, pos);
    CREATE INDEX IF NOT EXISTS items_list ON items (list_id, pos);
  `);
}
