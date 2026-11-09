import crypto from 'node:crypto';
import { Router } from 'express';
import { pool } from './db.js';
import { appUrl, googleConfigured } from './env.js';
import { HttpError } from './http.js';
import { wrap } from './wrap.js';

export const auth = Router();

async function publicUser(userId: string) {
  const { rows } = await pool.query<{ id: string; name: string; email: string; picture: string | null }>(
    'SELECT id, name, email, picture FROM users WHERE id = $1',
    [userId],
  );
  return rows[0] ?? null;
}

auth.get('/auth/session', wrap(async (req, res) => {
  const user = req.session?.userId ? await publicUser(req.session.userId) : null;
  if (!user && req.session) req.session.userId = undefined;
  res.json({ user, google: googleConfigured() });
}));

auth.post('/auth/dev', wrap(async (req, res) => {
  if (googleConfigured()) throw new HttpError(404, 'Локальный вход выключен');
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (id, google_sub, email, name)
     VALUES ($1, 'dev-local', 'local@saphire', 'Локальный сеанс')
     ON CONFLICT (google_sub) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [crypto.randomUUID()],
  );
  if (req.session) req.session.userId = rows[0].id;
  res.json({ user: await publicUser(rows[0].id) });
}));

auth.get('/auth/google', wrap(async (req, res) => {
  if (!googleConfigured()) throw new HttpError(503, 'Вход через Google не настроен');
  const state = crypto.randomBytes(16).toString('hex');
  if (req.session) req.session.oauthState = state;
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID || '');
  url.searchParams.set('redirect_uri', `${appUrl()}/api/auth/google/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  res.redirect(url.toString());
}));

auth.get('/auth/google/callback', wrap(async (req, res) => {
  const fail = () => res.redirect(`${appUrl()}/?auth=failed`);
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  if (!code || !state || !req.session || state !== req.session.oauthState || !googleConfigured()) {
    fail();
    return;
  }
  req.session.oauthState = undefined;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: `${appUrl()}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    fail();
    return;
  }
  const token = await tokenRes.json() as { access_token?: string };
  if (!token.access_token) {
    fail();
    return;
  }
  const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!infoRes.ok) {
    fail();
    return;
  }
  const info = await infoRes.json() as { sub?: string; email?: string; name?: string; picture?: string };
  if (!info.sub) {
    fail();
    return;
  }
  const name = (info.name || info.email || 'Аккаунт').slice(0, 120);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (id, google_sub, email, name, picture)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (google_sub) DO UPDATE
       SET email = EXCLUDED.email, name = EXCLUDED.name, picture = EXCLUDED.picture
     RETURNING id`,
    [crypto.randomUUID(), info.sub, info.email || '', name, info.picture || null],
  );
  req.session.userId = rows[0].id;
  res.redirect(appUrl());
}));

auth.post('/auth/logout', wrap(async (req, res) => {
  req.session = null;
  res.json({ ok: true });
}));
