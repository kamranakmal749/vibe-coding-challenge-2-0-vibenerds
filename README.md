# Maidan Desk — Sports Academy OS

Maidan Desk is a comprehensive sports academy management and talent scouting platform engineered for Dumka Sports Academy across multi-sport athlete operations (Football, Cricket, Basketball). It streamlines daily attendance logging, match scheduling, dynamic squad eligibility, scoring, performance star tracking, and professional scouting evaluation.

---

## Architecture & Tech Stack

- **Framework**: Next.js 15 (located in `client/`)
- **Backend API**: 100% migrated to Next.js App Router route handlers in `client/src/app/api/` (35 endpoints across auth, players, attendance sessions, match lifecycles, scouting radar, and sync).
- **Database**: MongoDB Atlas with atomic sync tracking (`syncstates`), optimistic concurrency locking, and strict database safety guards.
- **Authentication**: HS256 JWT auth read strictly from environment variables without default fallback secrets.
- **Frontend Architecture**:
  - **Native React Entry (`/`)**: Dark glassmorphic React login client component with 1-click Quick Login role selection and automatic session restoration.
  - **Native React Scout Radar (`/app/scout`)**: Dedicated React client component for scouting talent discovery, real-time trial readiness indicators, and performance star evaluations.
  - **Main Academy Workspace (`/app`)**: The main UI is the original battle-tested vanilla JS application served directly by Next.js at `/app` via route rewrite.
  - **Legacy Notice**: The Express codebase in the repo root (`src/`, `server.js`) is legacy and is **not used** by the deployed Next.js application.

---

## Live Deployment

- **Live Application URL**: `<LIVE_URL>`
- **Entry & Login Portal**: `<LIVE_URL>/`
- **Scout Radar (Native React)**: `<LIVE_URL>/app/scout`
- **Academy Workspace (Main UI)**: `<LIVE_URL>/app`

---

## Test Credentials

Sign in with any of the pre-seeded accounts (or select the role tab and click **Fill test credentials** on the login page):

| Role | Username | Password | Athlete / Profile Details | Scouting Readiness Status |
|---|---|---|---|---|
| **Admin** | `admin` | `admin123` | Academy Admin | System oversight & registrations |
| **Coach** | `coach` | `coach123` | Coach Sharma | Attendance locking & match operations |
| **Scout** | `scout` | `scout123` | Scout Verma | Talent discovery & trial evaluations |
| **Player** | `md260001` | `player123` | Kamran Akmal (Football) | **READY** (100% attendance, 2 matches) |
| **Player** | `md260003` | `player123` | Aadil Azhar (Football) | **NOT READY** (50% attendance, 1 match) |

> **Dataset Scope**: The academy database contains **24 seeded players, 10 trial-ready, plus any added** through the registration interface.

---

## Environment Variables

Configure the following environment variables (defined in `client/.env.local` for local execution, or in the Vercel Dashboard for production):

| Variable | Description | Requirement | Example Value |
|---|---|:---:|---|
| `MONGODB_URI` | MongoDB Atlas connection string. **Must end in `/academy_final`**. | **Required** | `mongodb+srv://<user>:<password>@<cluster-host>/academy_final?retryWrites=true&w=majority` |
| `JWT_SECRET` | Secret key for signing HS256 JWT tokens (min 32 characters, no default value). | **Required** | `your_secure_random_production_jwt_secret_min_32_chars` |
| `ALLOW_PRODUCTION_DB` | Safety guard flag enabling production database connections. Enforces connection exclusively to `academy_final`. | **Required** | `true` |

> [!CAUTION]
> `ALLOW_MOCK_NOW` must **NOT** be set in production. Time-travel mocking is restricted strictly to local automated testing.

---

## Guarded Database Seeding

The seed script includes an explicit safety guard that refuses to execute unless the target database name in `MONGODB_URI` equals `academy_final` AND `ALLOW_PRODUCTION_DB=true`:

```powershell
$env:ALLOW_PRODUCTION_DB = "true"
$env:MONGODB_URI = "mongodb+srv://<user>:<password>@<cluster-host>/academy_final?retryWrites=true&w=majority"
node scripts/seed.js
```

---

## Local Development & Run Steps

The Next.js application resides entirely in the `client/` directory:

```bash
# 1. Navigate to the client directory
cd client

# 2. Install dependencies
npm install

# 3. Configure local environment variables
# Copy client/.env.example to client/.env.local (git-ignored)
cp .env.example .env.local

# 4. Start local development server
npm run dev
# Server boots at http://localhost:3000

# 5. Production build & local start
npm run build
npm run start
```

---

## Vercel Deployment Instructions

1. **Import Repository**: In the Vercel Dashboard, import this repository.
2. **Project Settings**:
   - Set **Root Directory** to `client`.
   - Framework Preset: **Next.js** (automatically detected from `client/package.json`).
   - No custom build overrides or additional configuration required.
3. **Configure Environment Variables**:
   In **Settings** > **Environment Variables**, add:
   - `MONGODB_URI`: Connection string ending in `/academy_final`.
   - `JWT_SECRET`: Random secret string (minimum 32 characters).
   - `ALLOW_PRODUCTION_DB`: Set to `true`.
4. **Deploy**: Trigger deployment. Vercel will execute `next build` and deploy the route handlers and static assets cleanly.
