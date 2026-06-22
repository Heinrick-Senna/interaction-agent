# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Type-check without building
npx tsc --noEmit

# Run in dev mode (watch)
npm run start:dev

# Build for production
npm run build

# Run production build
npm run start
```

All production deployment is via Docker:

```bash
# Build and start all services
docker compose up --build -d

# Rebuild and force recreate a single service
docker compose up --build --force-recreate -d agent

# Tail logs
docker logs interaction-agent -f
docker logs evolution-api -f
```

## Architecture

This is a NestJS WhatsApp finance assistant. The user sends a natural-language message via WhatsApp → Evolution API delivers it via webhook → AgentService runs an agentic loop calling tools → reply is sent back via Evolution API REST.

### Request flow

```
WhatsApp → evoapicloud/evolution-api → POST /api/webhook/evolution
  → AgentController → AgentService (agentic loop)
    → AiProvider.chat() [OpenAI or Anthropic]
    → TransactionsService (SQLite via sql.js/TypeORM)
  → Evolution API REST → WhatsApp reply
```

### AI provider abstraction (`src/ai/`)

`AiProvider` interface defines a single `chat(options)` method with normalized `AiMessage[]` types. `AiModule` reads `AI_PROVIDER` env var (`openai` | `anthropic`) and uses a factory to instantiate the correct provider. Both providers translate the normalized format to their respective wire formats internally.

The agentic loop lives entirely in `AgentService` — it calls `ai.chat()`, handles `tool_calls` responses by executing tools, then feeds results back until a `text` response is returned.

### Tools (`src/agent/agent.service.ts`)

Four tools defined as `ToolDefinition[]`: `log_expense`, `log_saving`, `query_transactions`, `get_summary`. All tool execution routes through `executeTool()` which calls `TransactionsService`.

### Database

`sql.js` (SQLite in Node.js) with TypeORM. `synchronize: true` — schema is auto-created on startup. The DB file persists at `./data/finance.sqlite` (mounted as Docker volume). `transactionDate` stores the user-stated date (ISO string) and differs from `createdAt` (the actual insert time).

## Environment variables

| Variable | Description |
|---|---|
| `AI_PROVIDER` | `openai` (default) or `anthropic` |
| `OPENAI_API_KEY` | OpenAI key |
| `OPENAI_MODEL` | Default: `gpt-4.1-nano` |
| `ANTHROPIC_API_KEY` | Anthropic key |
| `ANTHROPIC_MODEL` | Default: `claude-haiku-4-5-20251001` |
| `EVOLUTION_API_KEY` | Shared secret for Evolution API |
| `EVOLUTION_INSTANCE` | WhatsApp instance name (e.g. `my-instance`) |
| `EVOLUTION_API_URL` | Set automatically in Docker to `http://evolution:8080` |
| `DB_PATH` | SQLite file path, default `./data/finance.sqlite` |
| `GITHUB_TOKEN` | GitHub Personal Access Token (for developer agent PRs) |
| `GITHUB_OWNER` | GitHub repo owner, default `Heinrick-Senna` |
| `GITHUB_REPO` | GitHub repo name, default `interaction-agent` |
| `DEVELOPER_AGENT_MODEL` | Model used by developer agent, default `claude-sonnet-4-6` |
| `ADMIN_JID` | WhatsApp JID to receive deploy notifications (e.g. `5511999999999@s.whatsapp.net`) |

## Docker services

- **agent** — NestJS app (this repo), port 3000
- **evolution** — `evoapicloud/evolution-api:latest`, port 8080. Requires PostgreSQL and Redis.
- **postgres** — PostgreSQL 16 for Evolution API state
- **redis** — Redis 7 for Evolution API cache

Evolution API webhook is configured per-instance (not just global env vars). After creating an instance, set the webhook explicitly:

```bash
curl -X POST http://localhost:8080/webhook/set/my-instance \
  -H "Content-Type: application/json" \
  -H "apikey: <EVOLUTION_API_KEY>" \
  -d '{"url":"http://agent:3000/api/webhook/evolution","webhook_by_events":false,"webhook_base64":false,"events":["MESSAGES_UPSERT","CONNECTION_UPDATE","QRCODE_UPDATED"]}'
```

## Developer Agent (self-extending bot)

When the WhatsApp bot is asked to do something it doesn't know (unknown tool call), it triggers `DeveloperAgentService` which:

1. Runs a Claude agentic loop (`DEVELOPER_AGENT_MODEL`) with tools: `read_file`, `list_files`, `write_file`, `run_tsc`, `ask_user`, `update_env`
2. Can ask questions via WhatsApp (`ask_user`) — loop pauses until user replies
3. If it needs new env vars: asks via `ask_user`, writes to `.env` via `update_env`
4. Creates a GitHub PR via Octokit REST API (no local git needed)
5. Sends PR URL to user via WhatsApp

User replies with `aprovado` or `recusado: [motivo]`.

**On `aprovado`:**
- Merges PR on GitHub
- Waits 5s, then `git pull /workspace`
- Sends "Código atualizado"
- `docker compose build agent` (synchronous, image rebuilt inside container)
- Sends "Reiniciando agente"
- `docker compose up -d agent` (detached, daemon recreates container)
- New container `onModuleInit` sends "Agente iniciado"

Docker volumes required in `docker-compose.yml`:
- `/var/run/docker.sock:/var/run/docker.sock` — for rebuilding
- `.:/workspace` — for git pull and build context

**AI_PROVIDER does NOT affect the developer agent** — it always uses the Anthropic SDK directly (`DEVELOPER_AGENT_MODEL`).

## Known gotchas

- **Body size limit**: Evolution API sends large payloads (QR code base64). The NestJS app sets a 10 MB limit via `express.json({ limit: '10mb' })` in `main.ts`.
- **ValidationPipe whitelist**: All DTO fields used in controllers must have at least one `class-validator` decorator, otherwise `whitelist: true` strips them silently.
- **OpenAI tool results**: OpenAI requires one message per tool result. The `OpenAiProvider` flattens `AiMessage { role: 'tool', results: ToolResult[] }` into multiple `ChatCompletionMessageParam` entries in `toOpenAiMessages()`.
- **sql.js vs native SQLite**: The project uses `sql.js` (WASM), not the native `better-sqlite3`. Column types must be `varchar` or `real` — avoid TypeORM defaults that emit unsupported SQLite types.
