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

function credentials(body: unknown) {
  const record = body && typeof body === 'object' ? body as { login?: unknown; password?: unknown } : {};
  const login = typeof record.login === 'string' ? record.login.trim() : '';
  const password = typeof record.password === 'string' ? record.password : '';
  if (!/^[\p{L}\p{N}_.-]{1,40}$/u.test(login)) throw new HttpError(400, 'Логин: 1–40 символов, без пробелов');
  if (password.length < 6 || password.length > 72) throw new HttpError(400, 'Пароль: от 6 до 72 символов');
  return { login, password };
}

function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function passwordMatches(password: string, stored: string | null) {
  if (!stored) return false;
  const [kind, saltB64, hashB64] = stored.split('$');
  if (kind !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function openSession(req: { session?: { userId?: string } }, userId: string) {
  if (req.session) req.session.userId = userId;
}

auth.post('/auth/register', wrap(async (req, res) => {
  const { login, password } = credentials(req.body);
  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (id, google_sub, login, password_hash, email, name)
       VALUES ($1, $2, $3, $4, '', $3)
       RETURNING id`,
      [crypto.randomUUID(), `local:${login}`, login, hashPassword(password)],
    );
    openSession(req, rows[0].id);
    res.json({ user: await publicUser(rows[0].id) });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      throw new HttpError(409, 'Такой логин уже есть');
    }
    throw error;
  }
}));

auth.post('/auth/login', wrap(async (req, res) => {
  const { login, password } = credentials(req.body);
  const { rows } = await pool.query<{ id: string; password_hash: string | null }>(
    'SELECT id, password_hash FROM users WHERE login = $1',
    [login],
  );
  const user = rows[0];
  if (!user || !passwordMatches(password, user.password_hash)) {
    throw new HttpError(401, 'Неверный логин или пароль');
  }
  openSession(req, user.id);
  res.json({ user: await publicUser(user.id) });
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
