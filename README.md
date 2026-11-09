## Требования

- Node.js 22+
- Docker, порт 5432 свободен
- Порты 4000 и 5173 свободны

## Команды

```
copy .env.example .env
docker compose up -d
npm install
npm test
npm run dev
```

http://localhost:5173

## Ограничения

- `DATABASE_URL` — Postgres 16, база `saphire`, пользователь и пароль `saphire`, хост `127.0.0.1`, порт `5432`
- `APP_URL` — тот origin, с которого открыт сайт. Редирект Google: `{APP_URL}/api/auth/google/callback`
- `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET` задаются оба. Пока хотя бы один пуст, вход локальный. Когда заданы оба, локальный вход выключен
- Клиент Google: Web application. Scope: `openid email profile`
- `SESSION_SECRET` обязателен при `APP_URL` на https
- Название папки или списка: 1–120 символов. Текст задачи или комментария: 1–500
- `npm test` создаёт и удаляет схему `saphire_test` в этой же базе. Рабочие таблицы не трогает. База должна быть запущена

## VPS

Образ: `saphire.tar`. Сайт и API на порту `8080`. Postgres 16 поднимается отдельно, пользователь, пароль и база `saphire`.

```
docker load -i saphire.tar
docker compose -f docker-compose.prod.yml up -d
```

- `APP_URL` в `.env` — origin в браузере. Редирект Google: `{APP_URL}/api/auth/google/callback`
- `DATABASE_URL` внутри compose указывает на сервис `db`, значение из `.env` для базы не используется
- `SESSION_SECRET` обязателен при `APP_URL` на https
