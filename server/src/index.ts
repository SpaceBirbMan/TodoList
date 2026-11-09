import './env.js';
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { app } from './app.js';
import { migrate, waitForDb } from './db.js';

const clientDist = process.env.CLIENT_DIST;
if (clientDist && existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist, { index: false }));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      res.status(404).json({ error: 'Не найдено' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const port = Number(process.env.PORT || 4000);
await waitForDb();
await migrate();
app.listen(port, '0.0.0.0', () => {
  console.log(`Saphire API http://127.0.0.1:${port}`);
});
