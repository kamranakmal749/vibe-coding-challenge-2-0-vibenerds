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

> **Dataset Scope**: The seeded baseline contains **27 users (1 admin, 1 coach, 1 scout, 24 players)** with **24 seeded players (10 trial-ready)**. Any players or staff accounts created in the live app are persisted in `academy_final`, but will be overwritten if the database is re-seeded.

---

## Admin Features & System Operations

The Admin role possesses full governance, athlete lifecycle management, staff provisioning, and audit oversight directly from the workspace (`/app`):

### 1. Staff Management (`/app` > Staff)
- **Provision Staff Accounts**: Create new **Coach** and **Scout** accounts with unique usernames (3–30 chars), optional emails, and secure passwords (minimum 8 characters or 1-click cryptographically generated temporary password).
- **One-Time Credential Reveal**: Account creation and password resets present a one-time credential modal with individual and bulk copy actions.
- **Mandatory First-Time Password Change**: Newly created staff accounts have `mustChangePassword = true` enforced on the server, requiring a permanent password change upon their first login.
- **Edit & Reset Password**: Edit names, update emails, and trigger secure password resets.
- **Guarded Staff Deletion**: Deleting a coach with assigned athletes requires either reassigning the athletes to another coach or is blocked with a clear warning. Scouts can be removed freely, and admins cannot delete themselves.

### 2. Player Management (`/app` > Players)
- **Centralized Directory**: View all academy athletes across sports with real-time dynamic stats: attendance rate (%), matches played, assigned coach, age, and trial readiness.
- **Search & Multi-Filter**: Filter athletes instantly by sport (Football, Cricket, Basketball), assigned coach, or text search matching athlete name, username, ID, or coach name.
- **Profile Editing**: Edit athlete name, age (5–50), sport, coach assignment, and default participation mode (practice, match, both). Updates automatically sync the linked user login account.
- **Temporary Password Reset**: Generate or assign a temporary password (min 8 chars) that sets `mustChangePassword = true`. Credentials are shown **once** in a secure modal with a 1-click copy action.
- **Cascade Deletion**: Safely removes the athlete AND permanently deletes their associated user login account (`User.deleteMany`), strips roster entries from draft/unsaved sessions, and removes selections from upcoming matches while preserving historical completed match integrity. Requires an explicit `{ confirm: true }` guard.
- **Bulk Coach Reassignment**: Select multiple athletes via row checkboxes (or select all) and reassign them to another coach in a single atomic operation.

### 3. Audit Log (`/app` > Audit Log)
- **Immutable Operation Trail**: Real-time chronological tracking of all administrative actions, including staff creation, editing, password resets, and deletions, as well as player editing, password resets, deletions, and coach reassignments.
- **Strict Credential Privacy**: Passwords, secrets, and sensitive tokens are strictly sanitized and redacted before any audit record is persisted (`details` never stores passwords).
- **Paginated Inspection**: Browse audit history with server-side pagination, timestamps, actor details, action tags, and structured operation details.

### 4. Player Directory CSV Export
- **One-Click Export**: Export the full athlete directory or current filter subset to CSV via `GET /api/admin/export/players?format=csv`.
- **Columns Exported**: Player ID, Full Name, Username, Sport, Age, Coach, Default Participation, Attendance %, Matches Played, Trial Ready Status, and Registration Date.

### 5. Academy Overview Breakdowns (`/app` > Overview)
- **Attendance Turnout by Sport**: Average attendance percentage and visual progress bars across Football, Cricket, and Basketball.
- **Trial-Ready Breakdown by Sport**: Proportion and count of athletes meeting readiness thresholds (>= 75% attendance and >= 2 valid matches played) per sport.

> [!NOTE]
> **Live Edits & Seeding Notice**: All staff and athlete modifications, password resets, and deletions are persisted immediately in MongoDB Atlas `academy_final`. If the database is re-seeded using `node scripts/seed.js`, all collections will be reset to the clean baseline (27 users, 24 players).

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
