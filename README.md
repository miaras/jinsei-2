# 人生 — JINSEI

JINSEI is an AI-powered life simulator about arriving in Japan with limited money, limited Japanese, and no established life. Players communicate in Japanese or rōmaji, find work and housing, form relationships, and build a persistent story one turn at a time.

The application uses Next.js, the OpenAI Responses API, and a local SQLite database. Accounts are optional: guests save locally in their browser, while registered players can continue the same life across devices.

## Requirements

- Node.js 24 (`24.13.1` is specified in `.nvmrc`)
- npm
- An OpenAI API key

The native SQLite dependency must be installed with the same major Node.js version used to run the server. If you use `nvm`, selecting the included Node 24 version before installing avoids native-module ABI errors.

## Local setup

```bash
cd jinsei-server
nvm use
npm install
cp .env.example .env
```

Add your OpenAI API key to `.env`:

```dotenv
OPENAI_API_KEY=sk-your-key-here
```

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | Yes | — | Server-side key used for generated game turns. |
| `OPENAI_MODEL` | No | `gpt-5.6` | OpenAI model used by the turn endpoint. |
| `PORT` | No | `3000` | Port used by the production server. |
| `COOKIE_SECURE` | No | `false` | Set to `true` when the site is served over HTTPS. |

Never expose `OPENAI_API_KEY` to browser code or commit `.env`.

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
└── server-state.js           SQLite, sessions, and authentication helpers
public/
└── index.html                Existing game UI and browser-side game logic
scripts/
└── reset-password.js         Administrative password-reset utility
data/
└── jinsei.db                 Runtime SQLite database
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
| `POST` | `/api/turn` | Stream one generated game turn from OpenAI. |
| `POST` | `/api/image` | Disabled; returns HTTP `503`. |
| `GET` | `/health` | Report server, key, and image status. |

The browser sends conversation content to `/api/turn`, but the server controls the OpenAI key, model, and output-token limit. OpenAI streaming events are forwarded to the browser as server-sent events.

Guest turns are limited per IP as a basic cost safeguard. Registered users are not subject to that guest limit.

## Data and authentication

SQLite data is stored in `data/jinsei.db`. The application creates the database and tables automatically.

The database contains:

- `users`: usernames and bcrypt password hashes
- `sessions`: random session tokens with 30-day expirations
- `saves`: one JSON save slot per account

Authentication uses an HTTP-only, same-site cookie named `jinsei_session`. Set `COOKIE_SECURE=true` in HTTPS deployments.

The `data/` directory is ignored by Git. Back it up and mount it on persistent storage in production; ephemeral filesystems will lose accounts and saves when the deployment restarts.

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

- Provide `OPENAI_API_KEY` through the platform's secret manager.
- Set `COOKIE_SECURE=true` when using HTTPS.
- Persist the `data/` directory across deploys and restarts.
- Avoid buffering `/api/turn` in a reverse proxy, because buffering prevents text from appearing incrementally.
- Use `/health` for readiness checks.

## Troubleshooting

### `better_sqlite3.node` was compiled against a different Node.js version

Select Node 24 and rebuild the native dependency:

```bash
nvm use
npm rebuild better-sqlite3
```

If the problem remains, reinstall dependencies from the lockfile under Node 24:

```bash
npm ci
```

### `/api/turn` reports a missing key

Confirm `.env` contains `OPENAI_API_KEY`, then restart the development or production server. Next.js loads environment variables when the server starts.

### Accounts disappear after deployment

The deployment is probably using an ephemeral filesystem. Configure a persistent volume for the `data/` directory.
