# 人生 — JINSEI

JINSEI is an AI-powered language-learning life simulator set in Japan, China, or Korea. Players can practice Japanese, Mandarin, Korean, or modern Korean mixed with Hanja, choose a learning difficulty, find work and housing, form relationships, and build a persistent story one turn at a time. Every new life opens in a randomly selected, novel-like location rather than an airport.

The application uses Next.js, DeepSeek V4 Flash through OpenRouter, and Supabase Postgres. Accounts are optional: guests save locally in their browser, while registered players can keep and continue multiple lives across devices.

## Requirements

- Node.js 24 (`24.13.1` is specified in `.nvmrc`)
- npm
- An OpenRouter API key
- A Google Cloud Text-to-Speech API key (for optional WaveNet NPC speech)
- A Paddle account and two recurring monthly Prices (for merchant-of-record paid plans)
- A Replicate API token (for the Pictures plan)
- A Supabase project and server-side secret key

## Local setup

```bash
cd jinsei-server
nvm use
npm install
cp .env.example .env
```

Add your OpenRouter API key to `.env`:

```dotenv
OPENROUTER_API_KEY=sk-or-v1-your-key-here
GOOGLE_TTS_API_KEY=your-google-cloud-api-key
PADDLE_API_KEY=pdl_sdbx_your-api-key
PADDLE_WEBHOOK_SECRET=pdl_ntfset_your-webhook-secret
PADDLE_PRICE_UNLIMITED=pri_your_499_monthly_price
PADDLE_PRICE_PICTURES=pri_your_999_monthly_price
REPLICATE_API_TOKEN=r8_your-replicate-token
SUPABASE_URL=https://quchuvmccwtbrnhxdbig.supabase.co
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
| `OPENROUTER_API_KEY` | Yes | — | Server-side key used for generated game turns. |
| `OPENROUTER_MODEL` | No | `deepseek/deepseek-v4-flash` | OpenRouter model used by the turn endpoint. Requests prioritize low-latency providers for faster time to first token. |
| `GOOGLE_TTS_API_KEY` | Yes for speech | — | Server-side Google Cloud key with the Text-to-Speech API enabled. |
| `PADDLE_API_KEY` | Yes for billing | — | Server-side Paddle API key with transaction and customer-portal permissions. |
| `PADDLE_WEBHOOK_SECRET` | Yes for billing | — | Signature secret for `/api/paddle-webhook`. |
| `PADDLE_PRICE_UNLIMITED` | Yes for billing | — | Paddle monthly recurring $4.99 Price ID. |
| `PADDLE_PRICE_PICTURES` | Yes for billing | — | Paddle monthly recurring $9.99 Price ID. |
| `APP_URL` | Yes in production | — | Approved Paddle checkout domain. |
| `REPLICATE_API_TOKEN` | Yes for Pictures | — | Server-side token used only after Pictures-plan authorization. |
| `SUPABASE_URL` | Yes | — | Supabase project API URL. |
| `SUPABASE_SECRET_KEY` | Yes | — | Server-only secret key used for database operations. |
| `PORT` | No | `3000` | Port used by the production server. |
| `COOKIE_SECURE` | No | `false` | Set to `true` when the site is served over HTTPS. |

Never expose `OPENROUTER_API_KEY`, `GOOGLE_TTS_API_KEY`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `REPLICATE_API_TOKEN`, or `SUPABASE_SECRET_KEY` to browser code or commit `.env`. Do not prefix any secret with `NEXT_PUBLIC_`.

## Free and paid plans

Free play includes 20 player turns. The server reserves each turn atomically, so the limit cannot be bypassed by editing browser storage. Guests are tracked with an HTTP-only browser token; creating an account gives a separate free allowance. The arrival narration does not consume a turn.

- **Unlimited — $4.99/month:** unlimited story turns, saved lives, and WaveNet speech.
- **Unlimited + Pictures — $9.99/month:** everything in Unlimited plus one Replicate FLUX Schnell scene image for every verified game turn.

Pictures require a signed-in subscriber. Each image is tied to one saved life and turn, generated with Replicate, then copied to private Supabase Storage so it continues to work when a life is resumed.

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
| `GET` | `/api/save` | List the account's saved lives. |
| `POST` | `/api/save` | Create a new life. |
| `PUT` | `/api/save` | Update one life. |
| `DELETE` | `/api/save?id=…` | Delete one life. |
| `POST` | `/api/turn` | Stream one generated game turn from DeepSeek V4 Flash through OpenRouter. |
| `POST` | `/api/speech` | Speak one NPC line with Google WaveNet; cached before reuse. |
| `GET` | `/api/plan` | Return the current entitlement and free-turn balance. |
| `POST` | `/api/checkout` | Create a Paddle hosted checkout for a paid plan. |
| `POST` | `/api/portal` | Open Paddle's customer portal. |
| `POST` | `/api/paddle-webhook` | Verify Paddle events and update entitlements. |
| `POST` | `/api/image` | Generate the paid plan's verified-turn scene image. |
| `GET` | `/api/generated-image?id=…` | Serve an authorized saved private scene image. |
| `GET` | `/health` | Report server, key, and image status. |

The browser sends conversation content to `/api/turn`, but the server controls the OpenRouter key, model, and output-token limit. OpenRouter's OpenAI-compatible streaming events are forwarded to the browser as server-sent events.

Subscription entitlements are updated only from verified Paddle webhooks. The image route checks the entitlement, ownership of the saved life, and one-image-per-turn rule before calling Replicate.

## Data and authentication

Persistent data is stored in the Supabase project `jinsei` in the Seoul region. The database contains:

- `jinsei_users`: usernames and bcrypt password hashes
- `jinsei_sessions`: random session tokens with 30-day expirations
- `jinsei_lives`: multiple JSONB save records per account
- `jinsei_speech_cache`: opaque WaveNet cache keys and private storage paths
- `jinsei_subscriptions`: Paddle customer, subscription, plan, and current entitlement state
- `jinsei_turn_usage`: server-side free-turn counters
- `jinsei_paddle_events`: idempotent Paddle webhook event records
- `jinsei_image_generations`: one private generated picture per subscriber life/turn

Authentication uses an HTTP-only, same-site cookie named `jinsei_session`. Set `COOKIE_SECURE=true` in HTTPS deployments. Database access occurs only in Next.js route handlers through `SUPABASE_SECRET_KEY`; the browser has no direct table access. All application tables have RLS enabled, and access for Supabase's `anon` and `authenticated` database roles is revoked.

## NPC speech and caching

Every NPC speech panel has a listen control. It sends only the NPC's target-language line to the server, where a per-destination Google WaveNet voice generates MP3 audio: `ja-JP-Wavenet-B`, `cmn-CN-Wavenet-A`, or `ko-KR-Wavenet-B`.

The server hashes the line and voice, then looks up a private `jinsei-speech` Supabase Storage object before requesting Google. A miss is synthesized once, saved to that private bucket, and recorded in `jinsei_speech_cache`; future requests return the stored MP3. The endpoint also limits requests per IP to reduce accidental or abusive spend.

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

- Provide `OPENROUTER_API_KEY` through the platform's secret manager.
- Enable Google Cloud Text-to-Speech, restrict a `GOOGLE_TTS_API_KEY` to that API, and add it through the platform's secret manager.
- In Paddle, create monthly recurring USD Prices for $4.99 and $9.99. Put their IDs in `PADDLE_PRICE_UNLIMITED` and `PADDLE_PRICE_PICTURES`.
- Add `https://your-domain` as an approved checkout domain. Configure a Paddle notification destination at `https://your-domain/api/paddle-webhook` for `subscription.created`, `subscription.updated`, `subscription.canceled`, `subscription.paused`, and `subscription.resumed`; copy its signing secret to `PADDLE_WEBHOOK_SECRET`.
- Paddle's hosted customer portal handles cancellation, payment methods, invoices, and subscription changes. A subscriber changing plans is sent there rather than creating a duplicate subscription.
- Provide `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `REPLICATE_API_TOKEN`, and `APP_URL` through the platform's secret manager.
- Set `COOKIE_SECURE=true` when using HTTPS.
- Configure `SUPABASE_URL` and `SUPABASE_SECRET_KEY` as server-side deployment secrets.
- Avoid buffering `/api/turn` in a reverse proxy, because buffering prevents text from appearing incrementally.
- Use `/health` for readiness checks.

## Troubleshooting

### `/api/turn` reports a missing key

Confirm `.env` contains `OPENROUTER_API_KEY`, then restart the development or production server. Next.js loads environment variables when the server starts.

### Account routes report missing Supabase configuration

Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the deployment environment, then redeploy. Use a secret key from the Supabase project's **Connect** or **API Keys** screen, not a publishable browser key.
