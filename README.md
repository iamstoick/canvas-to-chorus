# Canvas to Chorus

Upload an artwork, ask up to five questions about it, then get an analysis, original lyrics,
and a recommended musical style. Built from [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

**Stack:** React 18 + Vite · Node 22 + Express · PostgreSQL 16 (Drizzle ORM) · Docker Compose.
npm workspaces (`packages/shared`, `apps/api`, `apps/web`).

**Model providers** (switchable per browser in *Model settings*):

| Provider | Default model | Needs |
|---|---|---|
| **Claude CLI Proxy** — default in Docker | `haiku` (`sonnet` / `opus`) | `npm run claude-proxy` running on the host. The API in Docker calls it at `http://host.docker.internal:3099`. |
| Claude CLI (direct) — default on the host | `haiku` (`sonnet` / `opus`) | Claude Code installed and logged in on the machine running the API. Only when the backend runs **outside Docker**. |
| Anthropic Claude (API) | `claude-opus-5` | `ANTHROPIC_API_KEY` on the server |
| Ollama (local) | `qwen3:latest` | Ollama on the host. Needs a **vision** model (`ollama pull qwen2.5vl`, or `gemma3`, `llava`, `llama3.2-vision`). Text-only models such as `qwen3` are rejected with a clear error. |

Default provider when `DEFAULT_PROVIDER` is unset: Anthropic if `ANTHROPIC_API_KEY` is present, else
Claude CLI (direct) if the binary resolves and the API is not in Docker, else Claude CLI Proxy in Docker,
else Ollama. The settings screen has a
**Test connection** button that checks the CLI path/version, API key, or Ollama reachability + model +
vision support.

## Run in Docker with the Claude CLI Proxy (recommended)

Docker cannot see your local `claude` login, so a tiny dependency-free script on the host exposes the
CLI over HTTP. Two terminals:

```bash
# terminal 1 (host): the proxy, listens on 127.0.0.1:3099
npm run claude-proxy

# terminal 2: the app
cp .env.example .env         # set DB_PASSWORD
docker compose up --build    # web on http://localhost:${WEB_PORT:-8080}
```

In *Model settings* choose **Claude CLI Proxy** (auto-selected in Docker), a model, and press **Test
connection**. Base URL defaults to `http://host.docker.internal:3099`; CLI Path is only needed if the
proxy host cannot find the binary. Proxy options: `CLAUDE_PROXY_PORT`, `CLAUDE_PROXY_HOST`
(use `0.0.0.0` on Linux, where `host-gateway` cannot reach loopback), and `CLAUDE_PROXY_TOKEN` (set the
same value in `.env` for the API). The proxy only exposes `GET /health` and `POST /run`, runs the CLI
restricted to the Read tool in a scratch directory, and deletes the image afterwards.

## Run on the host with the Claude CLI (direct)

The direct provider shells out to `claude -p` with your local login, so the API must run on the host:

```bash
npm install
npm run dev:db                 # Postgres in Docker, exposed on localhost:5432
cp .env.example .env           # DATABASE_URL already points at localhost:5432
set -a && . ./.env && set +a
npm run db:migrate
npm run dev                    # API :3000 + Vite :5173 (proxies /api)
open http://localhost:5173
```

Pick **Claude CLI (direct)** in *Model settings* (auto-selected when the CLI is found), choose
`haiku` / `sonnet` / `opus`, and use **Test connection**. Leave *CLI Path* blank unless the server
cannot find the binary (then e.g. `/Users/you/.local/bin/claude`).

## Run fully in Docker (Anthropic API or Ollama)

```bash
cp .env.example .env         # set DB_PASSWORD; add ANTHROPIC_API_KEY only if you want Claude
docker compose up --build    # web on http://localhost:${WEB_PORT:-8080}
```

Migrations run automatically when the `api` container starts.

Dev mode with hot reload (Vite on :5173, API on :3000, Postgres on :5432):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

## Run locally without Docker

```bash
npm install
docker compose up -d db                   # or any Postgres 16
cp .env.example .env && set -a && . ./.env && set +a
npm run db:migrate
npm run dev                               # api :3000 + web :5173 (proxying /api)
```

## Deploy to Vercel

**Recommended: one project, repo root.** `vercel.json` at the repo root builds everything, serves the
React app from `apps/web/dist`, and runs the Express API as one serverless function (`api/index.js`)
behind `/api/*`. Same domain, so the session cookie just works.

1. Vercel → Add New → Project → import this repo. Leave **Root Directory empty**. Framework Preset *Other*.
   Build Command and Output Directory come from `vercel.json`.
2. Storage → Create → **Neon** (Postgres) and **Blob**. Vercel injects `DATABASE_URL`, `DATABASE_URL_UNPOOLED`
   and `BLOB_READ_WRITE_TOKEN`.
3. Environment variables: `ANTHROPIC_API_KEY` (the only provider that works from Vercel; it is the default
   there), optionally `ANTHROPIC_MODEL`, `RETENTION_DAYS`, `CRON_SECRET` (for the daily retention cron).
4. Settings → Deployment Protection → Vercel Authentication → *Disabled* (or previews only), otherwise
   visitors are redirected to a Vercel login.
5. Apply the schema once from your machine, then copy data if you want it:

   ```bash
   DATABASE_URL="<DATABASE_URL_UNPOOLED>" npm run db:migrate
   docker compose exec -T db pg_dump -U app --data-only --no-owner --exclude-schema=drizzle artlyrics \
     | psql "<DATABASE_URL_UNPOOLED>"
   ```

Open the project domain: the UI is at `/`, health at `/api/health`. `maxDuration` is 300 s (lower to 60 on
plans without Fluid Compute). Vercel caps request bodies at 4.5 MB, so uploads above that fail before
reaching the app.

If you already created a project with Root Directory `apps/api`, change Root Directory to empty in
Settings → General and redeploy. Its environment variables carry over.

**Alternative: two projects.** `apps/api/vercel.json` and `apps/web/vercel.json` still support deploying
the API (Root Directory `apps/api`) and the UI (Root Directory `apps/web`, Vite preset) separately. Set the
API domain in the web rewrite. The `prebuild` scripts build `packages/shared` first in either layout.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Build shared, then run API (tsx watch) and Vite together |
| `npm run dev:db` | Start only Postgres in Docker, exposed on `localhost:5432` |
| `npm run claude-proxy` | Run the host-side Claude CLI proxy (`scripts/claude-proxy.js`) |
| `npm run build` | Build shared, API, and web |
| `npm test` | Vitest across all workspaces |
| `npm run typecheck` | `tsc --noEmit` across all workspaces |
| `npm run db:generate -- --name <name>` | Generate a Drizzle migration from `apps/api/src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations from `apps/api/drizzle` |

## API

All routes are under `/api` and scoped to an anonymous `httpOnly` session cookie.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/artworks` | multipart `file` (image) **or** `frames[]` + `poster` + `originalName`/`mimeType`/`durationSeconds` (video). JPEG/PNG/WebP/GIF, 10 MB per file, magic-byte check, EXIF stripped. The browser downscales images and samples videos into frames first, so nothing heavy is uploaded |
| `GET` | `/artworks/:id/frames/:n` | one sampled video frame |
| `GET` | `/artworks` | all artworks in the caller's session with question/composition/song counts |
| `GET` | `/artworks/:id` | artwork + questions + analyses (newest first) + suggested questions |
| `GET` | `/artworks/:id/image` | serves the stored image |
| `DELETE` | `/artworks/:id` | removes the artwork, its rows, and its file |
| `POST` | `/artworks/:id/questions` | `{ question }`; vision Q&A; `409 question_limit` after five |
| `POST` | `/artworks/:id/compose` | `{ genre?, styleNotes? }`; analysis + lyrics + style as one structured-output call; each call adds a version. Empty genre = the artwork decides |
| `POST` | `/analyses/:id/songs` | `{ model?, instrumental? }`; starts a Suno generation from that analysis's lyrics + style |
| `GET` | `/songs/:id` | song status + tracks; refreshes from Suno while running, then copies MP3s into storage |
| `GET` | `/songs/:id/tracks/:n/audio` | our stored copy of a take (`audio/mpeg`, supports `Range`) |
| `POST` | `/songs/callback?token=…` | Suno completion webhook (token derived from the API key) |
| `GET` | `/settings` | this session's provider settings (env defaults if none saved) |
| `PUT` | `/settings` | `{ provider, model, baseUrl? }` |
| `POST` | `/settings/test` | connectivity + model + vision check for the submitted settings |
| `GET` | `/admin/status` | whether `ADMIN_TOKEN` is configured |
| `GET` | `/admin/sessions` | every session with activity counts (Bearer `ADMIN_TOKEN`) |
| `GET` | `/admin/sessions/:id/artworks` | that session's artworks (Bearer `ADMIN_TOKEN`) |
| `POST` | `/admin/sessions/:id/switch` | sets this browser's session cookie to that session (Bearer `ADMIN_TOKEN`) |
| `GET` | `/health` | `{ ok, db }` |

Errors use one envelope: `{ "error": { "code", "message" } }`.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `DEFAULT_PROVIDER` | auto (see above) | `claude-cli`, `anthropic`, or `ollama` for sessions with no saved settings |
| `CLAUDE_PROXY_URL` | `http://host.docker.internal:3099` in Docker, else `http://localhost:3099` | Where the API finds the proxy |
| `CLAUDE_PROXY_TOKEN` | – | Shared secret sent as `Authorization: Bearer` |
| `CLAUDE_CLI_PATH` | auto-resolve (`PATH`, `~/.local/bin/claude`, …) | Path to the `claude` binary |
| `CLAUDE_CLI_MODEL` | `haiku` | `haiku`, `sonnet`, `opus`, or a full model id |
| `CLAUDE_CLI_TIMEOUT_MS` | `600000` | Per-call timeout |
| `OLLAMA_BASE_URL` | `http://localhost:11434` (`http://host.docker.internal:11434` in compose) | Ollama endpoint |
| `OLLAMA_MODEL` | `qwen3:latest` | Default Ollama model |
| `OLLAMA_TIMEOUT_MS` | `600000` | Per-request timeout for local models |
| `ANTHROPIC_API_KEY` | – | Required only for the Anthropic provider |
| `ANTHROPIC_MODEL` | `claude-opus-5` | Default Anthropic model |
| `DATABASE_URL` | – | Postgres connection string |
| `UPLOAD_DIR` | `./data/uploads` | Where original images are stored |
| `RETENTION_DAYS` | `30` | Delete artworks older than this (0 disables) |
| `DB_POOL_MAX` | `10` (`2` on Vercel) | Postgres pool size per process |
| `BLOB_READ_WRITE_TOKEN` | – | When set, artworks are stored in Vercel Blob instead of `UPLOAD_DIR` |
| `CRON_SECRET` | – | Bearer token required by `GET /api/jobs/retention` |
| `ADMIN_TOKEN` | – | Enables the **Sessions** page and `/api/admin/*` |
| `SUNO_API_KEY` | – | Enables the "Generate the song" card via sunoapi.org |
| `SUNO_MODEL` | `V4_5` | Default Suno model (`V4`, `V4_5`, `V4_5PLUS`, `V5`, `V5_5`) |
| `PUBLIC_BASE_URL` | derived from the request | Public origin for Suno's callback URL |
| `RATE_UPLOADS_PER_HOUR` | `20` | Per-session upload limit |
| `RATE_MODEL_CALLS_PER_HOUR` | `60` | Per-session limit on question + compose calls |
| `DISABLE_REFUSAL_FALLBACKS` | – | Set `1` to turn off server-side refusal fallbacks |

## Pages

- `/` upload · `/a/:id/questions` · `/a/:id/result`
- `/gallery` **My artworks**: everything in the current browser session, with links to questions and results.
- `/sessions` **Sessions** (admin): lists every anonymous session on the server with counts and last activity.
  *Preview* shows a session's artworks; *Open* switches this browser's session cookie to it so you can browse and
  play its results. Requires `ADMIN_TOKEN`; the page asks for it once and keeps it in localStorage.
- `/settings` model provider.

## Video

Drop an MP4, WebM or MOV and the browser samples 8 to 12 evenly spaced frames (more for longer clips) with a
hidden `<video>` and a canvas, then uploads only those JPEGs plus a poster. The video file itself never leaves the
device, so there is no ffmpeg on the server and no large upload. Every provider receives the frames in order with
an intro such as "8 frames sampled in order from a 42-second video" and is asked to read them as one work: what
moves, what changes, where the turn is. The song's arc follows the clip's arc. Sound is ignored; the model does
not hear audio. Codecs the browser cannot decode (some MOV/HEVC) get a clear error suggesting an H.264 export.

## Writing for feeling

The songwriting prompt is built around emotional craft rather than description: one plainly named
`emotional_core`, a `point_of_view` (who sings, to whom, what they cannot say), concrete physical detail instead
of abstractions, an arc where the chorus says the hard thing simply and the bridge turns, lines shaped for a
voice. Every section carries a `delivery` cue ("barely above a whisper", "full voice, letting it break") and the
song has `performance_notes` for the whole vocal arc. These show on the lyrics card, go into Suno's section
tags (`[Chorus – full voice, letting it break]`) and its style string, so the generated performance follows the
emotion instead of a flat read. For the most human results use `sonnet` or `opus` rather than `haiku` in Model
settings.

## Choosing the genre

Before composing (and on **Regenerate**) you can pick a genre from a list or type your own, and add style
notes such as "female vocals, 80s synths". The prompt then asks for lyrics in that genre's idiom and a style
recommendation whose primary genre matches, while keeping every image grounded in the artwork. Leave it on
"Let the artwork decide" for the original behavior. The choice is stored with the composition and shown on the
result page, and Suno inherits it through the style card.

## Song generation (Suno)

On the result page, **Generate the song** sends the lyrics (with `[Verse]`/`[Chorus]` tags) as Suno's custom-mode
`prompt`, the recommended style as `style` (genre, sub-genres, BPM, key, instruments, vocal style; reference
artists are excluded because Suno rejects artist names), and the title. Suno returns a task id; the page polls
`GET /api/songs/:id` every 5 s, which asks sunoapi.org for the task while it runs. The completion webhook at
`/api/songs/callback` updates the row too when the deployment is publicly reachable. Each generation yields two
takes with cover art. Suno's stream URL stops working once generation completes and its MP3 URL expires after
some days, so when a song finishes the API copies each MP3 into app storage (local disk or Vercel Blob) and
serves it from `GET /api/songs/:id/tracks/:n/audio` with Range support. The player uses that copy, falling
back to Suno's MP3 until the copy exists. Stored takes are removed with the artwork. Failures such as
`SENSITIVE_WORD_ERROR` are shown inline with a hint to regenerate the lyrics.

## How the model calls work

All providers implement one interface (`apps/api/src/services/provider.ts`): answer a question about the
image with replayed history, and compose analysis + lyrics + style as one schema-constrained JSON response.

**Claude CLI Proxy** sends `{ model, cliPath, systemPrompt, prompt, jsonSchema, image }` to
`scripts/claude-proxy.js`, which performs exactly the direct-CLI steps below on the host and returns the
CLI's JSON envelope.

**Claude CLI (direct)** writes the image into a scratch directory and runs
`claude -p --output-format json --tools Read --no-session-persistence --system-prompt … --model …`
there, with `--json-schema` for compose. The model reads the artwork with its Read tool. Earlier Q&A is
included in the prompt so answers stay consistent. Nesting markers are stripped from the environment so
it also works when the API was started from inside a Claude Code session.

**Ollama** posts to `/api/chat` with the image as base64, `think: false` for thinking models, and the
shared Zod schema converted to JSON Schema in `format`. Thinking tags and code fences are stripped before
validation, with one retry on a schema mismatch.

**Anthropic**

- **Questions** replay earlier Q&A so answers stay consistent. The image and system prompt form a
  stable prefix, so questions 2–5 hit the prompt cache.
- **Compose** makes one request with `output_config.format` bound to the shared Zod
  `Composition` schema, so analysis, lyrics, and style are generated together and validated before
  they are stored.
- Images are downscaled to 1568 px on the longest edge before being sent.
- `stop_reason: "refusal"` is surfaced as `422 model_refused`; other API failures as `502`.
