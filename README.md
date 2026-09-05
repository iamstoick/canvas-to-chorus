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
| `POST` | `/artworks` | multipart `file`; JPEG/PNG/WebP/GIF, 10 MB cap, magic-byte check, EXIF stripped |
| `GET` | `/artworks/:id` | artwork + questions + analyses (newest first) + suggested questions |
| `GET` | `/artworks/:id/image` | serves the stored image |
| `DELETE` | `/artworks/:id` | removes the artwork, its rows, and its file |
| `POST` | `/artworks/:id/questions` | `{ question }`; vision Q&A; `409 question_limit` after five |
| `POST` | `/artworks/:id/compose` | analysis + lyrics + style as one structured-output call; each call adds a version |
| `GET` | `/settings` | this session's provider settings (env defaults if none saved) |
| `PUT` | `/settings` | `{ provider, model, baseUrl? }` |
| `POST` | `/settings/test` | connectivity + model + vision check for the submitted settings |
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
| `RATE_UPLOADS_PER_HOUR` | `20` | Per-session upload limit |
| `RATE_MODEL_CALLS_PER_HOUR` | `60` | Per-session limit on question + compose calls |
| `DISABLE_REFUSAL_FALLBACKS` | – | Set `1` to turn off server-side refusal fallbacks |

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
