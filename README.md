# Maidan Desk — Sports Academy OS

Maidan Desk is a comprehensive sports academy management and talent scouting platform engineered for sports academies and grassroots athlete development across multi-sport operations (Football, Cricket, Basketball). It streamlines daily attendance logging, match scheduling, dynamic squad eligibility, scoring, performance star tracking, and professional scouting evaluation.

---

## The Four Roles

The platform provides dedicated, role-isolated portals for each academy stakeholder:

- **Admin**: Complete academy oversight, staff provisioning (Coach/Scout creation, password resets, deletion), athlete lifecycle and roster management, bulk coach reassignment, immutable audit log tracking, and directory CSV export.
- **Coach**: Daily training attendance sessions (default Present with per-entry participation granularity), atomic session saving and locking, match scheduling, dynamic squad eligibility validation, and match scoring.
- **Scout**: Talent discovery radar filtered strictly for trial-ready athletes meeting performance criteria ($\ge 75\%$ attendance turnout and $\ge 2$ matches played).
- **Player**: Athlete personal portal displaying profile details, historical session attendance record, match participation history, and scouting readiness status.

---

## Architecture & Tech Stack

- **Framework**: Next.js 15 (located in [`client/`](client/))
- **Backend API**: 100% Next.js App Router route handlers in [`client/src/app/api/`](client/src/app/api/) (**43 endpoints** across auth, admin staff & player management, attendance sessions, match lifecycles, scouting radar, audit logging, and sync tracking).
- **Database**: MongoDB Atlas with atomic sync tracking (`syncstates`), optimistic concurrency locking, and strict database safety guards.
- **Authentication**: HS256 JWT auth read strictly from environment variables without default fallback secrets.
- **Frontend Architecture**:
  - **Native React Entry (`/`)**: Dark glassmorphic React login component featuring 4 dedicated role tabs (**Admin**, **Coach**, **Scout**, **Player**), dynamic role descriptions and placeholders, and a 1-click test credential helper.
  - **Native React Scout Radar (`/app/scout`)**: Dedicated React client component for scouting talent discovery, real-time trial readiness indicators, and performance star evaluations.
  - **Main Academy Workspace (`/app`)**: The main UI is the original battle-tested vanilla JS single-page application served directly by Next.js at `/app` via route rewrite from `client/public/`.
  - **Legacy Codebase Notice**: The original Express codebase in [`legacy/`](legacy/) (`legacy/src`, `legacy/server.js`, `legacy/test/`) is preserved for historical reference and parity testing only; it is **not used** by the deployed Next.js application.

---

## Live Deployment

- **Live Application URL**: [https://maidandesk.vercel.app](https://maidandesk.vercel.app)
- **Entry & Login Portal**: [https://maidandesk.vercel.app/](https://maidandesk.vercel.app/)
- **Scout Radar (Native React)**: [https://maidandesk.vercel.app/app/scout](https://maidandesk.vercel.app/app/scout)
- **Academy Workspace (Main UI)**: [https://maidandesk.vercel.app/app](https://maidandesk.vercel.app/app)

---

## Role Selection & Test Credentials

The login card at [`/`](https://maidandesk.vercel.app/) features four segmented role buttons at the top (**Admin**, **Coach**, **Scout**, **Player**). Selecting a role dynamically tailors the card heading, description, and input placeholder. Click **Fill test credentials** under the form to populate login fields with standard demo credentials:

| Role | Username | Password | Athlete / Profile Details | Scouting Readiness Status |
|---|---|---|---|---|
| **Admin** | `admin` | `admin123` | Academy Admin | System governance & staff management |
| **Coach** | `coach` | `coach123` | Coach Sharma | Attendance locking & match operations |
| **Scout** | `scout` | `scout123` | Scout Verma | Talent discovery & trial evaluations |
| **Player** | `md260001` | `player123` | Kamran Akmal (Football) | **READY** (100% attendance, 2 matches) |
| **Player** | `md260003` | `player123` | Aadil Azhar (Football) | **NOT READY** (50% attendance, 1 match) |

> **Dataset Scope**: The clean baseline contains 24 seeded players, 10 trial-ready, plus any added through the live application. Any players or staff accounts created in the live app are persisted in `academy_final`. If the database is re-seeded using `node scripts/seed.js`, all collections will be reset to the clean baseline.

---

## Project Structure

```text
maidandesk/
├── client/                     # Active production Next.js 15 application (Vercel Root)
│   ├── public/                 # Static assets & vanilla SPA (app.html, script.js, style.css)
│   ├── src/
│   │   ├── app/                # App Router: login (/), scout (/app/scout), and 43 API routes
│   │   │   ├── api/            # Route handlers (admin, auth, matches, players, sessions, scout, sync)
│   │   │   ├── app/scout/      # React Scout Radar page
│   │   │   ├── page.tsx        # React segmented 4-role login page
│   │   │   └── layout.tsx      # Root Next.js layout & theme providers
│   │   └── lib/                # Database connection, Mongoose models, auth guards, IST helpers
│   ├── test/                   # Fast automated unit and integration tests (zero external dependencies)
│   ├── next.config.mjs         # Production Next.js configuration & rewrite rules
│   └── package.json            # Client dependencies and build scripts
│
├── scripts/                    # Operational & maintenance scripts
│   ├── seed.js                 # Guarded database seed script (strictly restricted to academy_final)
│   └── verify-academy-final.js # Read-only database link integrity and readiness verification
│
├── legacy/                     # Original Express implementation (archived for reference)
│   ├── src/                    # Original Express 5 controllers, middleware, routes, and models
│   ├── public/                 # Original standalone vanilla HTML/JS/CSS assets
│   ├── test/                   # Legacy Jest / Supertest integration suites
│   ├── server.js               # Original Express entrypoint (port 3000)
│   └── README.md               # Legacy architecture documentation
│
├── KNOWN_ISSUES.md             # Technical debt, solved items, and known limitations
├── LICENSE                     # MIT License (Kamran Akmal)
└── package.json                # Root package manifest & developer scripts
```

---

## Admin Features

The Admin role possesses full governance, athlete lifecycle management, staff provisioning, and audit oversight directly from the workspace (`/app`):

### 1. Staff Management (`/app` > Staff)
- **Provision Staff Accounts**: Create new **Coach** and **Scout** accounts with unique usernames (3–30 characters), optional emails, and secure passwords (minimum 8 characters or 1-click cryptographically generated temporary password).
- **One-Time Credential Reveal**: Account creation and password resets present a one-time credential modal with individual and bulk copy actions.
- **Mandatory First-Time Password Change**: Newly created staff accounts have `mustChangePassword = true` enforced on the server, requiring a permanent password change upon their first login.
- **Edit & Reset Password**: Edit names, update emails, and trigger secure password resets.
- **Guarded Staff Deletion**: Deleting a coach with assigned athletes requires reassigning the athletes to another coach or is blocked with a clear warning. Scouts can be removed freely, and admins cannot delete themselves.

### 2. Player Management (`/app` > Players)
- **Centralized Directory**: View all academy athletes across sports with real-time dynamic stats: attendance rate (%), matches played, assigned coach, age, and trial readiness.
- **Search & Multi-Filter**: Filter athletes instantly by sport (Football, Cricket, Basketball), assigned coach, or text search matching athlete name, username, ID, or coach name.
- **Profile Editing**: Edit athlete name, age (5–50), sport, coach assignment, and default participation mode (`practice`, `match`, `both`). Updates automatically sync the linked user login account.
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
- **Trial-Ready Breakdown by Sport**: Proportion and count of athletes meeting readiness thresholds ($\ge 75\%$ attendance and $\ge 2$ valid matches played) per sport.

---

## Known Limitations

For details on resolved discrepancies (including the unified view/edit session roster fix) and remaining architectural considerations, consult [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

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
npm ci

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
