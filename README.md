# ReachInbox — Full-Stack Email Job Scheduler

A complete, production-grade email job scheduling and outreach management platform built with **Node.js, TypeScript, Express, BullMQ, Redis, PostgreSQL (Prisma), Ethereal SMTP, Elasticsearch, Google OAuth 2.0, Slack OAuth 2.0, React, Vite, and Tailwind CSS**.

---

## 1. Project Purpose & Core Features

ReachInbox Scheduler is engineered to reliably schedule, space out, rate-limit, and deliver marketing and sales outreach emails at scale. It solves the hard consistency and concurrency challenges that arise in distributed background processing:

- ⏱ **Persistent Delayed Job Scheduling**: Backed by **BullMQ** and **Redis**; the scheduler uses no cron jobs or cron libraries.
- 🛡 **Transactional Outbox Pattern**: Atomic PostgreSQL transaction commits ensure zero email loss even if Redis crashes during queue insertion.
- 🔄 **Restart Recovery**: Survives process crashes and server reboots; scheduled jobs persist in Redis, and a background Outbox Sweeper automatically recovers stranded or un-queued records.
- ⚡ **Configurable Worker Concurrency**: Run concurrent processors (e.g. `WORKER_CONCURRENCY=5`) across multi-core systems or containers.
- ⏳ **Distributed Minimum Send Delay**: Each worker atomically reserves a future sender slot in Redis, spacing send starts across workers and nodes (`MIN_DELAY_BETWEEN_EMAILS_MS=2000`).
- 🚦 **Atomic Distributed Hourly Rate Limiting**: Enforces strict hourly limits per sender (`MAX_EMAILS_PER_HOUR_PER_SENDER=200`) using Redis atomic reservations. Excess jobs are gracefully deferred to the next hourly window without dropping emails.
- 🔔 **Real Slack Integration & Rate Limit Alerts**: Real OAuth 2.0 connection. Sends deduplicated Block Kit notifications to connected Slack channels when hourly quotas are reached.
- ✉️ **Ethereal Fake SMTP & Inspection**: Automatic test account generation, message preview URLs, and provider ID tracking without external exposure.
- 🔍 **Elasticsearch Search with PostgreSQL Fallback**: Full-text multi-field search across recipient, subject, and body, with strict tenant isolation and transparent DB fallback.
- 📊 **Live BullMQ Dashboard**: Interactive queue management powered by `@bull-board/express` at `/admin/queues`, protected by HTTP Basic Auth.
- 🔐 **Google OAuth and Email/Password Accounts**: Google OAuth 2.0 plus scrypt-hashed password signup/login, with secure HttpOnly session cookies.
- 💻 **Modern SaaS React Frontend**: Built with Vite, Tailwind CSS, TanStack Query, and React Hook Form, featuring real-time overview metrics, paginated email tables, CSV parsing and deduplication, and integration settings.

---

## 2. Architecture & Request/Job Flow

```
                                  +------------------------------------+
                                  |         React + Vite Client        |
                                  |   (Tailwind, React Router, Query)  |
                                  +-----------------+------------------+
                                                    | HTTP / Cookies
                                                    v
                                  +------------------------------------+
                                  |         Express API Server         |
                                  | (Auth, Zod, Routes, Bull-Board)    |
                                  +--------+------------------+--------+
                                           |                  |
                       Prisma ORM (Tx)     |                  | BullMQ Producer
                                           v                  v
                               +---------------+      +---------------+
                               |  PostgreSQL   |      |  Redis 7.x    |
                               | (Authoritative|      | (Delayed Jobs,|
                               |    Store)     |      | Rate Limits)  |
                               +-------+-------+      +-------+-------+
                                       ^                      |
                       Prisma Client   |                      | BullMQ Worker
                                       |                      v
                                  +----+----------------------+--------+
                                  |           BullMQ Worker            |
                                  | (Concurrency, Min-Delay, Rate-Lim) |
                                  +--------+------------------+--------+
                                           |                  |
                     Nodemailer (SMTP)     |                  | Indexing / Alerts
                                           v                  v
                                 +------------------+  +-------------------+
                                 |  Ethereal Email  |  |   Elasticsearch   |
                                 | (Preview URLs)   |  |   & Slack API     |
                                 +------------------+  +-------------------+
```

### End-to-End Scheduling Sequence
1. **User Request**: User submits a single email or batch CSV via the React frontend.
2. **Validation & Isolation**: Express and Zod validate email formats, timestamps, and payload sizes. The session middleware verifies user identity and tenant ownership.
3. **Transactional Outbox Write**: Inside a PostgreSQL transaction, `ScheduledEmail` records are persisted with `status: SCHEDULED` alongside corresponding `EmailOutbox` records with `status: PENDING`.
4. **BullMQ Enqueue**: The API computes the delay (`delay = Math.max(0, scheduledAt - now)`) and enqueues jobs with stable IDs into BullMQ. Upon success, outbox records are marked `ENQUEUED`.
5. **Background Recovery**: If Redis is unreachable during step 4, the **Outbox Sweeper** retries pending outbox records until Redis reconnects; a prolonged Redis outage does not permanently exhaust a fixed retry count.
6. **Worker Processing**:
   - The worker checks the sender's current hourly quota in Redis.
   - **If the current window is full**: The email reserves capacity in the earliest later UTC hour with space and is delayed by BullMQ until that hour. An alert is sent to the connected Slack channel when a sender first exceeds the current window's limit.
   - **If quota available**: An atomic Redis script reserves the next sender send slot. Concurrent workers wait for distinct slots before delivering through Ethereal SMTP.
7. **Status Update & Indexing**: PostgreSQL updates to `status: SENT`, saves the `providerMessageId` and `etherealPreviewUrl`, and synchronizes the record to Elasticsearch.

Scheduling uses BullMQ delayed jobs persisted in Redis (with AOF enabled by the provided Docker Compose setup). There are no cron jobs or cron libraries. The worker's timer is only an outbox/stale-state recovery sweep; it does not calculate or drive scheduled send times.

### Restart and Idempotency Guarantees
- PostgreSQL stores the email and outbox row together before enqueueing. On startup and periodically, the worker recovers pending outbox rows; BullMQ restores delayed jobs from Redis.
- Every email uses its persisted database ID as its BullMQ `jobId`. Repeated enqueue/recovery attempts therefore use the same queue identity instead of creating another job.
- An optional `Idempotency-Key` request header is persisted with the email, and a database unique constraint on `(userId, idempotencyKey)` prevents concurrent duplicate scheduling requests from creating two emails.
- Before delivery, the worker checks authoritative PostgreSQL state and skips records already marked `SENT` or `CANCELLED`. The stalled-job recovery sweep leaves an existing BullMQ job to BullMQ's own lock/stalled recovery rather than adding a second copy.
- SMTP itself does not provide a standard exactly-once transaction with PostgreSQL: if the SMTP server accepts a message and the worker crashes before persisting `SENT`, the acceptance result is ambiguous. BullMQ and database idempotency prevent duplicate scheduling/enqueueing, but an SMTP provider with a true idempotency key is required to guarantee exactly-once recipient delivery across that failure boundary.

---

## 3. Monorepo Folder Structure

```
Email_Job_Scheduler_FS/
├── package.json                   # Monorepo workspaces & root scripts
├── .env.example                   # Master environment template
├── infra/
│   └── docker-compose.yml         # PostgreSQL 16, Redis 7, Elasticsearch 8
├── prisma/
│   ├── schema.prisma              # Database schema & indexes
│   └── seed.ts                    # Initial demo user, sender, & email seed
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── src/
│   │   ├── config/env.ts          # Zod environment validation
│   │   ├── utils/logger.ts        # Pino structured logger with redaction
│   │   ├── middleware/            # Auth, validation, errorHandler, idempotency
│   │   ├── repositories/prisma.ts # Prisma singleton client
│   │   ├── queues/                # BullMQ Queue and Redis connection
│   │   ├── integrations/          # Ethereal SMTP, Google, Slack, Elasticsearch
│   │   ├── services/              # RateLimiter, EmailScheduler, OutboxSweeper
│   │   ├── workers/email.worker.ts# Standalone BullMQ Worker process
│   │   ├── controllers/           # HTTP controllers
│   │   ├── routes/                # Express API routes
│   │   ├── docs/openapi.ts        # OpenAPI 3.0 specification
│   │   ├── app.ts                 # Express application assembly & Bull-Board
│   │   ├── server.ts              # API server entrypoint
│   │   └── worker.ts              # Worker process entrypoint
│   └── tests/                     # Vitest API, validation, & rate limiter tests
└── frontend/
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── src/
    │   ├── components/ui/         # Button, Modal, Input, Badge, Card, Spinner
    │   ├── features/
    │   │   ├── auth/              # AuthContext & LoginPage
    │   │   ├── dashboard/         # OverviewPage
    │   │   ├── emails/            # Scheduled, Sent, Failed, Compose Modal
    │   │   └── integrations/      # IntegrationsPage (Slack, Google, SMTP)
    │   ├── layouts/               # DashboardLayout & Navigation
    │   └── tests/                 # Vitest component & CSV parser tests
```

---

## 4. Prerequisites

- **Node.js**: `v18.19.0` or higher (`v20.x` recommended)
- **npm**: `v9.x` or higher
- **Docker & Docker Compose**: For running PostgreSQL, Redis, and Elasticsearch

---

## 5. Installation & Setup

### Step 1: Clone and install dependencies
```bash
git clone <repository-url>
cd Email_Job_Scheduler_FS

# Install dependencies across all workspaces
npm install
```

### Step 2: Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Default values in `.env.example` work out-of-the-box for local development with Docker Compose.

---

## 6. Docker Infrastructure Setup

Launch the database, queue storage, and search engine:
```bash
# Start PostgreSQL, Redis, and Elasticsearch in background
npm run infra:up
```

Verify that all three containers are healthy:
```bash
docker compose -f infra/docker-compose.yml ps
```
Ports exposed:
- **PostgreSQL**: `localhost:5432`
- **Redis**: `localhost:6379`
- **Elasticsearch**: `localhost:9200`

To shut down infrastructure:
```bash
npm run infra:down
```

---

## 7. Database Migrations & Seeding

Generate the Prisma Client:
```bash
npm run prisma:generate
```

Push the schema to PostgreSQL:
```bash
npm run prisma:migrate --workspace=backend
# OR:
npm run prisma:push --workspace=backend
```

Seed the database with initial demo data (user, sender account, and sample emails):
```bash
npm run prisma:seed
```

---

## 8. Third-Party Service Credentials & Configuration

### A. Google OAuth 2.0 Setup
1. Visit the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project and navigate to **APIs & Services > Credentials**.
3. Create an **OAuth 2.0 Client ID** (Web application).
4. Add Authorized redirect URI:
   `http://localhost:5000/api/auth/google/callback`
5. Copy Client ID and Client Secret into `.env`:
   ```env
   GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your_client_secret
   GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback
   ```

### B. Email and Password Authentication

Users can create an account and sign in with email/password, or use Google OAuth. Passwords are stored as salted scrypt hashes, never plaintext. Apply database migrations before running the API:

```bash
npm run prisma:migrate --workspace=backend
```
*(Google sign-in requires valid `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` credentials.)*

### B. Slack OAuth 2.0 Setup
1. Visit [Slack API Apps](https://api.slack.com/apps).
2. Click **Create New App** > **From scratch**.
3. Navigate to **OAuth & Permissions**:
   - Add Redirect URL: `http://localhost:5000/api/integrations/slack/callback`
   - Add Bot Scopes: `chat:write`, `incoming-webhook`
4. Copy Client ID, Client Secret, and Signing Secret into `.env`:
   ```env
   SLACK_CLIENT_ID=your_slack_client_id
   SLACK_CLIENT_SECRET=your_slack_client_secret
   SLACK_REDIRECT_URI=http://localhost:5000/api/integrations/slack/callback
   ```

### C. Ethereal Email Setup
No external setup required! If `ETHEREAL_USER` and `ETHEREAL_PASS` are left empty, the application automatically provisions a dynamic test account and logs inspection preview URLs for all sent emails.

---

## 9. Running the Application Processes

To run the full stack in development mode, open three terminal tabs:

### Terminal 1: Backend API Server
```bash
npm run dev:backend
```
- API Server: `http://localhost:5000`
- Swagger / OpenAPI: `http://localhost:5000/api-docs`
- BullMQ Live Dashboard: `http://localhost:5000/admin/queues`

### Terminal 2: BullMQ Worker & Recovery Sweeper
```bash
npm run dev:worker
```
- Processes delayed email jobs
- Enforces concurrency and minimum send delay
- Performs atomic hourly quota checks and Slack alerts
- Runs the Transactional Outbox Sweeper

### Terminal 3: React Frontend (Vite)
```bash
npm run dev:frontend
```
- Dashboard UI: `http://localhost:5175`

---

## 10. Key API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Healthcheck endpoint |
| `GET` | `/api-docs` | Interactive Swagger UI |
| `GET` | `/api/auth/me` | Current authenticated user profile |
| `POST` | `/api/auth/signup` | Create account using email and password |
| `POST` | `/api/auth/login` | Sign in using email and password |
| `POST`| `/api/auth/logout` | Clear session cookie |
| `POST`| `/api/emails/schedule` | Schedule single email (supports `Idempotency-Key`) |
| `POST`| `/api/emails/batch` | Schedule batch campaign from parsed list |
| `GET` | `/api/emails` | List scheduled/sent/failed emails (paginated) |
| `GET` | `/api/emails/search` | Full-text search via Elasticsearch with PG fallback |
| `GET` | `/api/emails/:id` | View email details and delivery metrics |
| `POST`| `/api/emails/:id/cancel` | Cancel an eligible scheduled email |
| `POST`| `/api/emails/:id/retry` | Retry delivery for a failed email |
| `GET` | `/api/emails/senders` | List configured sender accounts |
| `GET` | `/api/dashboard/stats` | Live summary metrics and queue health |
| `GET` | `/api/integrations/slack/status` | Check Slack connection status |
| `POST`| `/api/integrations/slack/test` | Dispatch test Block Kit alert to Slack |
| `POST`| `/api/integrations/slack/disconnect` | Disconnect connected Slack workspace |

---

## 11. Concurrency, Send Delay, and Rate Limiting Guarantees

### Concurrency
Worker concurrency is configured via `WORKER_CONCURRENCY=5`. Each worker process handles up to 5 asynchronous jobs simultaneously; additional worker processes share the same Redis-backed queue.

### Distributed Minimum Send Delay
The default is `MIN_DELAY_BETWEEN_EMAILS_MS=2000` (2 seconds). Before sending, each worker atomically reserves a time slot in Redis for that sender. Reservations are spaced by at least the configured interval, including across worker processes, so concurrent jobs cannot all observe the same available slot and send together. Workers wait for their reserved slot before calling SMTP. Redis reservation errors fail the job for BullMQ retry instead of silently bypassing the throttle.

### Distributed Hourly Rate Limiting
- `MAX_EMAILS_PER_HOUR_PER_SENDER` (default 200) configures the per-sender hourly cap.
- Hour windows use UTC. A Redis Lua script atomically reserves one slot in the earliest hour with available capacity and records the reservation by email ID. Retries reuse their reservation rather than consuming another slot. Redis is the shared source of truth across all worker instances; quota checks fail and BullMQ retries if Redis is unavailable rather than sending without a cap.
- When this hour is full, the email's `nextEligibleAt` is set to the reserved future hour and its active BullMQ job is moved to the delayed state. The outbox and delayed BullMQ job retain the email across restarts; work is not dropped or re-added under a duplicate job ID.
- **1000 simultaneous emails with a limit of 200/hour** are reserved in FIFO arrival order across five UTC windows: up to 200 in the current window, then up to 200 in each of the next four windows. Actual sends remain paced by the 2-second sender delay. Atomic Redis script execution provides best-effort arrival order across workers; unrelated jobs scheduled later may compete for capacity in future windows.
- If Slack is connected, the first over-limit event per sender/hour uses the stored bot token and channel (or incoming webhook) to make a real Slack API/webhook request. A distributed short-lived lock prevents concurrent duplicate alerts, and the dedupe key is recorded only after Slack confirms delivery; failures are logged and can be retried on a later rate-limit hit. If Slack is disconnected, rate limiting continues without an alert or worker failure. Connect/reconnect in the Integrations dashboard to enable subsequent alerts; use **Send Test Alert** there to verify delivery.

---

## 12. Automated Testing

Run the full automated test suite (backend + frontend):
```bash
npm test
```

Run tests individually:
```bash
# Run 18 backend unit & integration tests
npm run test:backend

# Run 9 frontend UI & CSV parsing tests
npm run test:frontend
```

---

## 13. Production Build

Build both frontend and backend bundles for production deployment:
```bash
npm run build
```
- Backend TypeScript compiles to `backend/dist/`
- Frontend Vite assets compile to `frontend/dist/`

---

## 14. Troubleshooting

- **Redis connection error (`ECONNREFUSED 127.0.0.1:6379`)**:
  Ensure Redis is running with `npm run infra:up` or `docker compose -f infra/docker-compose.yml up -d`.
- **Database connection error**:
  Check `DATABASE_URL` in `.env` and verify PostgreSQL container status.
- **Elasticsearch connection warning**:
  PostgreSQL is the authoritative store. If Elasticsearch is starting up or unavailable, search automatically falls back to PostgreSQL.
- **BullMQ Dashboard login**:
  Default credentials in development: Username: `admin`, Password: `admin`.

---

## 15. Assignment Requirement Mapping Checklist

| # | Requirement | Implementation Status | Location |
|---|---|---|---|
| 1 | Monorepo Structure | ✅ Complete | Root `package.json`, `backend/`, `frontend/`, `infra/` |
| 2 | Relational Schema & Prisma | ✅ Complete | `prisma/schema.prisma`, `prisma/seed.ts` |
| 3 | BullMQ Persistent Scheduling | ✅ Complete | `backend/src/queues/email.queue.ts` |
| 4 | Transactional Outbox Pattern | ✅ Complete | `backend/src/services/emailScheduler.service.ts` |
| 5 | Background Outbox Sweeper | ✅ Complete | `backend/src/services/outboxSweeper.service.ts` |
| 6 | Worker Concurrency | ✅ Complete | `backend/src/workers/email.worker.ts` |
| 7 | Distributed Minimum Send Delay | ✅ Complete (atomic future-slot reservation) | `backend/src/services/rateLimiter.service.ts` |
| 8 | Distributed Hourly Rate Limiter | ✅ Complete | `backend/src/services/rateLimiter.service.ts` |
| 9 | Ethereal Fake SMTP & Preview URLs| ✅ Complete | `backend/src/integrations/email/ethereal.service.ts` |
| 10| Real Google OAuth 2.0 | ✅ Complete | `backend/src/integrations/google/google.service.ts` |
| 11| Real Slack OAuth & Alerts | ✅ Complete | `backend/src/integrations/slack/slack.service.ts` |
| 12| Elasticsearch Index & Fallback | ✅ Complete | `backend/src/integrations/elasticsearch/elasticsearch.service.ts` |
| 13| BullMQ Dashboard (`@bull-board`) | ✅ Complete | `backend/src/app.ts` (`/admin/queues`) |
| 14| OpenAPI / Swagger Documentation | ✅ Complete | `backend/src/docs/openapi.ts` (`/api-docs`) |
| 15| React SaaS Dashboard Layout | ✅ Complete | `frontend/src/layouts/DashboardLayout.tsx` |
| 16| Compose Form & CSV Parsing | ✅ Complete | `frontend/src/features/emails/ComposeEmailModal.tsx` |
| 17| Scheduled/Sent/Failed Tables | ✅ Complete | `frontend/src/features/emails/` |
| 18| Automated Backend Tests | ✅ Complete (18 tests) | `backend/tests/` |
| 19| Automated Frontend Tests | ✅ Complete (9 tests) | `frontend/src/tests/` |
| 20| Docker Compose Infrastructure | ✅ Complete | `infra/docker-compose.yml` |
