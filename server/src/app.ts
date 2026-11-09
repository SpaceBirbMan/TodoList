import express from 'express';
import cookieSession from 'cookie-session';
import { auth } from './auth.js';
import { board } from './board.js';
import { HttpError } from './http.js';

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cookieSession({
  name: 'saphire',
  keys: [process.env.SESSION_SECRET || 'saphire-dev-secret'],
  maxAge: 30 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax',
  secure: (process.env.APP_URL || '').startsWith('https://'),
}));
app.use(express.json({ limit: '1mb' }));
app.use('/api', auth);
app.use('/api', board);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error(error);
  res.status(500).json({ error: 'Не удалось сохранить' });
});
