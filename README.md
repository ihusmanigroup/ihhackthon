# AgentHack — Autonomous AI Sales Agent

Autonomous AI sales system: ingest company knowledge → define an ICP → discover & cheaply filter leads → deep research → qualification with evidence → service matching → decision-maker identification → personalized outreach → response classification → 3-day follow-up → meeting scheduling → memory → persistent pipeline.

## Architecture

- `client/` — Vite + React + TypeScript + Tailwind dashboard (deployed to Vercel)
- `server/` — Express + Node.js, Supabase PostgreSQL (via `pg`), Google Gemini AI (LLM + embeddings)

```
Company Knowledge (RAG) → ICP → Discovery → Cheap Filter → Deep Research → Qualification
→ Service Match → Decision Maker → Outreach → Response Classifier → Follow-Up / Meeting → Memory → Pipeline
```

## Setup

### Server

```bash
cd server
cp .env.example .env      # fill in DATABASE_URL + GEMINI_API_KEY
npm install
npx ts-node src/db/init.ts   # create Supabase tables once
npm run dev                  # http://localhost:5000
```

### Client

```bash
cd client
npm install
npm run dev                  # http://localhost:5173
```

## Environment Variables

See `server/.env.example` for all variables: `DATABASE_URL`, `SUPABASE_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `EMBEDDING_MODEL`, `DEMO_MODE`, `SCHEDULER_ENABLED`, `OUTBOUND_EMAIL_ENABLED`, `SEARCH_API_KEY`, `WHATSAPP_API_KEY`, `APP_URL`.

`DEMO_MODE=true` makes the agent deterministic with fallbacks (safe for live demos). `SCHEDULER_ENABLED` controls the durable follow-up / reminder worker.

## Pipeline Stages

`Discovered → Potential → Researching → Qualified → Contacted → Interested → Meeting Scheduled → Converted`
Negative: `Not Qualified`, `Not Interested`, `Do Not Contact`

## API Surface

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Health + demo-mode flag |
| GET | `/api/dashboard` | KPIs, recent leads, upcoming meetings |
| POST | `/api/company/ingest` | Ingest company knowledge (RAG) |
| GET | `/api/company` | Latest company profile |
| POST | `/api/company/retrieve` | Semantic RAG retrieval over company knowledge |
| POST | `/api/icp` | Create ICP |
| POST | `/api/leads/discover` | Staged discovery + cheap filtering |
| GET | `/api/leads` | List leads |
| GET | `/api/leads/:id` | Lead detail (evidence, contacts, messages, memories, follow-ups, meetings) |
| POST | `/api/leads/:id/research` | Deep research + qualification |
| POST | `/api/leads/:id/outreach` | Generate + send outreach |
| POST | `/api/leads/:id/reply` | Classify inbound reply + next action |
| POST | `/api/leads/:id/followup` | Execute the next due follow-up |
| POST | `/api/leads/:id/dnc` | Mark Do Not Contact |
| GET | `/api/followups` | Follow-up tasks |
| GET | `/api/meetings` | Meetings |
| GET | `/api/activity` | Agent activity / audit log |
| POST | `/api/scheduler/run` | Run the scheduler once (follow-ups + reminders) |
