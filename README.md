# 人生 (JINSEI)

A Next.js App Router application for the JINSEI Japanese-language life simulator.

## Development

```bash
npm install
cp .env.example .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production

```bash
npm run build
npm start
```

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | yes | Server-side OpenAI API key |
| `OPENAI_MODEL` | no | Defaults to `gpt-5.6` |
| `PORT` | no | Defaults to `3000` |
| `COOKIE_SECURE` | no | Set to `true` when serving over HTTPS |

Image generation is currently disabled. `REPLICATE_API_TOKEN` is not used.

## Architecture

- `app/page.js` renders the game through Next.js while preserving the existing UI behavior.
- `public/index.html` contains the compatibility UI stylesheet, markup, and browser game logic.
- `app/api/[endpoint]/route.js` handles accounts, saves, OpenAI streaming turns, and the disabled image endpoint.
- `app/health/route.js` exposes the deployment health check.
- `lib/server-state.js` owns SQLite setup, sessions, and shared authentication helpers.
- `data/jinsei.db` stores users, sessions, and one save per user.

The browser never receives the OpenAI key and cannot choose the model or output-token limit.

## Reset a password

```bash
node scripts/reset-password.js <username> <new-password>
```
