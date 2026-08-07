# 人生 — JINSEI

JINSEI is an AI-powered life simulator about arriving in Japan with limited money, limited Japanese, and no established life. Players communicate in Japanese or rōmaji, find work and housing, form relationships, and build a persistent story one turn at a time.

The application uses Next.js, Claude Haiku via Anthropic's Messages API, and Supabase Postgres. Accounts are optional: guests save locally in their browser, while registered players can continue the same life across devices.

## Requirements

- Node.js 24 (`24.13.1` is specified in `.nvmrc`)
- npm
- An Anthropic API key
- A Supabase project and server-side secret key

## Local setup

```bash
cd jinsei-server
nvm use
npm install
cp .env.example .env
```

Add your Anthropic API key to `.env`:

```dotenv
ANTHROPIC_API_KEY=sk-ant-your-key-here
SUPABASE_URL=https://jotioxgrharwfndnxoir.supabase.co
SUPABASE_SECRET_KEY=sb_secret_your-secret-key-here
```

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | Yes | — | Server-side key used for generated game turns. |
| `ANTHROPIC_MODEL` | No | `claude-haiku-4-5-20251001` | Claude model used by the turn endpoint. |
| `SUPABASE_URL` | Yes | — | Supabase project API URL. |
| `SUPABASE_SECRET_KEY` | Yes | — | Server-only secret key used for database operations. |
| `PORT` | No | `3000` | Port used by the production server. |
| `COOKIE_SECURE` | No | `false` | Set to `true` when the site is served over HTTPS. |

Never expose `ANTHROPIC_API_KEY` or `SUPABASE_SECRET_KEY` to browser code or commit `.env`. In particular, do not prefix the Supabase secret with `NEXT_PUBLIC_`.

Image generation is currently disabled. The `/api/image` endpoint returns HTTP `503`, and `REPLICATE_API_TOKEN` is not used.

## Commands

```bash
npm run dev      # development server with hot reload
npm run build    # optimized production build
npm start        # run the production build
```

To run the production version locally:

```bash
npm run build
npm start
```

## Application structure

```text
app/
├── api/[endpoint]/route.js   Account, save, turn, and image routes
├── health/route.js           Deployment health check
├── globals.css               Next.js global styles
├── layout.js                 Root layout and metadata
└── page.js                   Game page entry point
lib/
└── server-state.js           Supabase client, sessions, and authentication helpers
public/
└── index.html                Existing game UI and browser-side game logic
scripts/
└── reset-password.js         Administrative password-reset utility
```

`app/page.js` currently loads the established game interface from `public/index.html`. This compatibility layer keeps the original interaction and visual behavior while Next.js owns rendering, API routing, configuration, and production builds.

## API routes

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/register` | Create an account and session. |
| `POST` | `/api/login` | Authenticate and create a session. |
| `POST` | `/api/logout` | Delete the current session. |
| `GET` | `/api/me` | Return the signed-in player. |
| `GET` | `/api/save` | Load the account's saved life. |
| `PUT` | `/api/save` | Create or replace the account's saved life. |
| `DELETE` | `/api/save` | Delete the account's saved life. |
| `POST` | `/api/turn` | Stream one generated game turn from Claude Haiku. |
| `POST` | `/api/image` | Disabled; returns HTTP `503`. |
| `GET` | `/health` | Report server, key, and image status. |

The browser sends conversation content to `/api/turn`, but the server controls the Anthropic key, model, and output-token limit. Anthropic streaming events are forwarded to the browser as server-sent events.

Guest turns are limited per IP as a basic cost safeguard. Registered users are not subject to that guest limit.

## Data and authentication

Persistent data is stored in the Supabase project `jinsei` in the Seoul region. The database contains:

- `jinsei_users`: usernames and bcrypt password hashes
- `jinsei_sessions`: random session tokens with 30-day expirations
- `jinsei_saves`: one JSONB save slot per account

Authentication uses an HTTP-only, same-site cookie named `jinsei_session`. Set `COOKIE_SECURE=true` in HTTPS deployments. Database access occurs only in Next.js route handlers through `SUPABASE_SECRET_KEY`; the browser has no direct table access. All three tables have RLS enabled, and access for Supabase's `anon` and `authenticated` database roles is revoked.

## Resetting a password

Run the utility from the project directory:

```bash
node scripts/reset-password.js <username> <new-password>
```

The new password must contain at least eight characters. Resetting a password also deletes the user's active sessions.

## Deployment

Build and run JINSEI anywhere that supports Node.js 24 and persistent filesystem storage:

```bash
npm ci
npm run build
npm start
```

For production deployments:

- Provide `ANTHROPIC_API_KEY` through the platform's secret manager.
- Set `COOKIE_SECURE=true` when using HTTPS.
- Configure `SUPABASE_URL` and `SUPABASE_SECRET_KEY` as server-side deployment secrets.
- Avoid buffering `/api/turn` in a reverse proxy, because buffering prevents text from appearing incrementally.
- Use `/health` for readiness checks.

## Troubleshooting

### `/api/turn` reports a missing key

Confirm `.env` contains `ANTHROPIC_API_KEY`, then restart the development or production server. Next.js loads environment variables when the server starts.

### Account routes report missing Supabase configuration

Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the deployment environment, then redeploy. Use a secret key from the Supabase project's **Connect** or **API Keys** screen, not a publishable browser key.
