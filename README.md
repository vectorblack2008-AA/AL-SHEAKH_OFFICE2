# Al-Sheikh Office · مكتب الشيخ

Operations, fleet, contract and financial management for a commercial
transportation office. Built for the Egyptian market: **EGP**, **Africa/Cairo**,
Arabic-first **RTL** UI, **14% VAT** and Egyptian plates, phone numbers and cities.

- **Frontend** — React 19 + TypeScript + Vite, Tailwind CSS v4, TanStack Query, Recharts
- **Backend** — Express 4 + TypeScript, Zod validation, JWT httpOnly sessions, RBAC + audit log
- **Database** — PostgreSQL (hosted) or embedded PGlite for zero-config local use

---

## Table of contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Quick start](#quick-start)
4. [Default accounts](#default-accounts)
5. [Database modes](#database-modes)
6. [Environment variables](#environment-variables)
7. [Scripts](#scripts)
8. [Deployment](#deployment)
9. [Security notes](#security-notes)
10. [Testing](#testing)
11. [Project structure](#project-structure)
12. [نظرة سريعة بالعربية](#نظرة-سريعة-بالعربية)

---

## Features

| Area | Highlights |
| --- | --- |
| Dashboard | Revenue, net profit, utilization, receivables, charts, period comparison |
| Fleet | Vehicles, documents, odometer, status, maintenance blocks, unique plates |
| Drivers | Profiles, licences, expiry alerts, salary isolation (separate permission) |
| Routes & Trips | Fixed routes, recurring trip generation, private trips, conflict detection |
| Dispatch | Daily board, vehicle/driver assignment, maintenance-aware scheduling |
| Contracts | Monthly / per-trip / hybrid billing, revenue recognition, renewal alerts |
| Revenue | Invoices, partial payments, collection, aging, overdue tracking |
| Expenses | Categories, vehicle/driver/trip allocation, operating vs capital |
| Maintenance | Scheduled and completed work, parts, cost, vehicle downtime |
| Reports | Contract profitability, fleet cost per km, P&L, CSV export, print/PDF |
| Admin | Users, roles, granular permission overrides, settings, audit trail |
| Platform | Full reset / demo data, EN ⇄ AR, dark ⇄ light, responsive shell |

**Financial rules enforced by the API and verified by integration tests**

- Quoted revenue ≠ recognized revenue; revenue is recognized once and only once.
- Invoiced ≠ collected; partial payments are supported and cannot overpay.
- A trip or contract period can only be invoiced once (unique constraints).
- Operating profit = recognized revenue − recognized expenses.
- Expense allocations may never exceed the expense amount.

---

## Architecture

```
Browser (React SPA)
   │  httpOnly cookie session
   ▼
Express API  ── Zod validation ── RBAC ── audit log
   │
   ▼
Queryable layer (server/db.ts)
   ├── DATABASE_URL set  →  hosted PostgreSQL (pg Pool)
   └── otherwise         →  embedded PGlite at ./data/alsheikh
```

The same SQL schema (`server/schema.sql`) runs on both engines, so a local
installation can be promoted to a hosted database without code changes.

---

## Quick start

Requirements: **Node.js 20.19+**.

```bash
npm install
cp .env.example .env      # optional for local development
npm run dev               # API on :3001 + Vite on :5173
```

Open <http://localhost:5173>.

The first start creates the schema and the two built-in accounts. Load realistic
Egyptian demo data from **Settings → Demo → Load demo data** (admin only).

> The embedded database is a single-writer engine. Stop the API before running
> `npm run db:seed` or `npm run db:reset` from another terminal.

---

## Default accounts

| Role | Email | Password |
| --- | --- | --- |
| Administrator | `admin@alsheikh.eg` | `Admin@12345` |
| Viewer (read-only) | `viewer@alsheikh.eg` | `Viewer@12345` |

**Change these immediately after the first production login.** Demo credentials
are only advertised when `NODE_ENV !== 'production'`.

---

## Database modes

### 1. Embedded PGlite (default, local)

Nothing to install. Data lives in `./data/alsheikh` (git-ignored). Ideal for a
single office machine and for development. Do not point two processes at the
same folder, and back the folder up regularly.

### 2. Hosted PostgreSQL (production)

Set `DATABASE_URL` and the app switches automatically:

```env
DATABASE_URL=postgresql://user:password@host/db?sslmode=require
```

Works with Neon, Supabase, Railway, RDS or any PostgreSQL 14+ instance. The
schema is applied idempotently on boot, and `server/schema.sql` can also be run
manually (`psql -f server/schema.sql`).

**Serverless (Vercel) requires hosted PostgreSQL** — the function filesystem is
read-only and ephemeral, so PGlite cannot persist data there. The API fails fast
with a clear message when `DATABASE_URL` is missing on Vercel.

---

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | API port |
| `NODE_ENV` | `development` | `production` enables Secure cookies, CSP and strict secret checks |
| `JWT_SECRET` | dev-only fallback | Session signing key. **Required** in production |
| `DATABASE_URL` | — | Hosted PostgreSQL connection string |
| `DATABASE_PATH` | `./data/alsheikh` | PGlite data directory (when no `DATABASE_URL`) |
| `PGSSLMODE` | auto | Set `disable` for a local PostgreSQL without TLS |
| `PGPOOL_MAX` | `3` / `10` | PostgreSQL pool size (serverless / local) |
| `SHOP_TIMEZONE` | `Africa/Cairo` | Timezone used to resolve "today" |

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | API + Vite dev server together |
| `npm run dev:api` | API only (no watch, restart after backend edits) |
| `npm run dev:web` | Vite only |
| `npm run build` | Production frontend build into `dist/` |
| `npm start` | Production server (serves `dist/` and the API) |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Integration + smoke suites (requires a running API) |
| `npm run test:integration` | Financial/operational rules |
| `npm run test:smoke` | API surface + demo data checks |
| `npm run test:postgres` | Optional: verify the hosted-PostgreSQL code path without a server |
| `npm run db:seed` | Load demo data (admin account must exist) |
| `npm run db:reset` | Reset demo data and reload it |
| `npm run verify` | Typecheck + both test suites |

---

## Deployment

### Vercel (recommended)

1. Create a PostgreSQL database — [Neon](https://neon.tech) (use the pooled
   host) or [Supabase](https://supabase.com).
2. Import this repository in Vercel.
3. Add environment variables in **Project → Settings → Environment Variables**:

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | pooled PostgreSQL connection string |
   | `JWT_SECRET` | 48+ random bytes, hex encoded |
   | `NODE_ENV` | `production` |
   | `SHOP_TIMEZONE` | `Africa/Cairo` (optional) |

4. Deploy. `vercel.json` already configures:
   - the Vite build (`dist/`),
   - the Express function at `api/index.ts`,
   - the schema file bundled with the function,
   - SPA fallback for client-side routes.

5. Open the app and sign in with `admin@alsheikh.eg`, then change the password.

Notes:

- Serverless instances reuse a small connection pool (`PGPOOL_MAX`, default 3).
  Prefer the provider's **pooled** connection string to avoid connection limits.
- `api/index.ts` forwards requests to the same Express app used locally, so API
  routes, cookies and error handling behave identically.
- Closest Vercel region to Egypt is `fra1` (Frankfurt) — set `"regions": ["fra1"]`
  in `vercel.json` if you are on a plan that allows region selection.

### Any Node host (Render, Railway, Fly.io, VPS, Docker)

```bash
npm ci
npm run build
NODE_ENV=production JWT_SECRET=... DATABASE_URL=... npm start
```

The server listens on `PORT`, serves the built SPA and shuts down gracefully on
`SIGINT` / `SIGTERM`.

---

## Security notes

- Passwords hashed with bcrypt (cost 12); sessions are signed JWTs in **httpOnly**
  cookies (`SameSite=Lax`, `Secure` in production).
- Authorization is enforced **server-side** on every operational endpoint;
  the UI merely hides what the user cannot do.
- Driver salaries and sensitive financial fields are masked unless the user holds
  `view_driver_compensation` / `view_sensitive_finance`.
- Login attempts are throttled per IP and per email (in-memory, per instance).
- Audit log records actor, action, entity, before/after payload and IP.
- API responses send `Cache-Control: no-store`; production adds a strict CSP and
  hardening headers.
- Start from `.env.example`, never commit `.env`, and rotate `JWT_SECRET` after
  any suspected leak (this invalidates all sessions).

---

## Testing

Both suites talk to a running API and mutate the database, so run them against a
development or demo instance, sequentially:

```bash
npm run dev:api        # terminal 1
npm test               # terminal 2
```

`npm test` seeds the demo dataset first, so the checks are deterministic on a
fresh installation.

- `tests/integration.mjs` — 44 checks: revenue recognition, duplicate invoices,
  partial/over payment, expense allocation limits, maintenance blocks, duplicate
  plates, recurring trip generation, RBAC, dashboard reconciliation, and the
  full workspace reset (including re-seeding afterwards).
- `tests/smoke.mjs` — 56 checks across every API area and demo dataset.

Both suites finish with demo data loaded, so the app is left in a usable demo
state.

Optional verification of the hosted-PostgreSQL driver (no PostgreSQL or Docker
needed — PGlite is exposed over the PostgreSQL wire protocol for the test):

```bash
npm run test:postgres
```

---

## Project structure

```
api/index.ts              Vercel serverless entry (wraps the Express app)
server/
  app.ts                  Express application factory (routers, headers, errors)
  index.ts                Long-running server bootstrap (local / Node hosts)
  db.ts                   Queryable layer: PGlite | pg, transactions, sequences
  schema.sql              Authoritative PostgreSQL schema
  auth.ts                 JWT sessions, RBAC guards, permission resolution
  lib.ts                  Validation, serialization, timezone, CSV, audit helpers
  routes/                 HTTP endpoints grouped by domain
  services/               Finance, scheduling and contract business rules
  seed-data.ts            Demo dataset, demo reset, full workspace reset
src/
  App.tsx                 Lazy-loaded routes + guards
  main.tsx                Providers + global error boundary
  context/                App shell state (user, language, theme, toasts)
  components/             Design system, layout, charts, filters
  pages/                  One folder-level module per feature
  lib/                    API client, types, formatters, print templates
  i18n/                   Complete EN/AR dictionary
tests/                    Integration + smoke + optional PostgreSQL driver checks
```

---

## نظرة سريعة بالعربية

- **التشغيل محلياً:** `npm install` ثم `npm run dev`، وافتح `http://localhost:5173`.
- **الحساب الافتراضي:** `admin@alsheikh.eg` / `Admin@12345` — غيّره فوراً بعد الرفع.
- **قاعدة البيانات محلياً:** مدمجة (PGlite) وتُحفظ في `./data/alsheikh` بدون أي إعداد.
- **قاعدة البيانات عند الرفع:** PostgreSQL مستضافة (Neon أو Supabase) عبر `DATABASE_URL`.
  لا يمكن استخدام القاعدة المحلية على Vercel لأن ملفات الخادم مؤقتة.
- **الرفع على Vercel:** اربط المستودع، أضف `DATABASE_URL` و`JWT_SECRET`، ثم Deploy.
- **قبل الاستخدام الحقيقي:** غيّر كلمات المرور، راجع صلاحيات المشاهدين، واضبط نسخاً
  احتياطية دورية لقاعدة البيانات.

---

## License

Proprietary — all rights reserved. Prepared for Al-Sheikh Office.
