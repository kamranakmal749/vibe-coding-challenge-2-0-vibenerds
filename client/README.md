# Maidan Desk — Next.js Application & Vercel Deployment

Maidan Desk is a comprehensive sports academy management and scouting platform engineered for Dumka Sports Academy across multi-sport operations (Football, Cricket, Basketball).

---

## Architecture & Frontend Strategy

- **Backend API**: 100% of the API (35 endpoints across auth, players, attendance sessions, match lifecycles, scouting radar, and sync) is implemented as native Next.js App Router route handlers (`client/src/app/api/**/route.ts`).
- **Native React Entry (`/`)**: Dedicated React client component with dark glassmorphism, 1-click Quick Login role fill, and automatic session restoration.
- **Native React Scout Radar (`/app/scout`)**: Dedicated React client component for scouting talent discovery, real-time trial readiness indicators, and performance star evaluations.
- **Main Academy Workspace (`/app`)**: The main UI is the original battle-tested vanilla JS application (`app.html`, `script.js`, `style.css`, and vendor libraries) served directly by Next.js at `/app` via route rewrite (`{ source: '/app', destination: '/app.html' }`).
- **Legacy Notice**: The Express codebase in the repo root (`src/`, `server.js`) is legacy and is **not used** by the deployed Next.js application.

---

## Live Deployment

- **Live Application URL**: `<LIVE_URL>`
- **Entry & Login Portal**: `<LIVE_URL>/`
- **Scout Radar (Native React)**: `<LIVE_URL>/app/scout`
- **Academy Workspace (Main UI)**: `<LIVE_URL>/app`

---

## Test Credentials

Sign in with any of the pre-seeded test accounts (or select the role tab and click **Fill test credentials** on `/`):

| Role | Username | Password | Athlete / Profile Details | Scouting Readiness Status |
|---|---|---|---|---|
| **Admin** | `admin` | `admin123` | Academy Admin | System oversight & registrations |
| **Coach** | `coach` | `coach123` | Coach Sharma | Attendance locking & match operations |
| **Scout** | `scout` | `scout123` | Scout Verma | Talent discovery & trial evaluations |
| **Player** | `md260001` | `player123` | Kamran Akmal (Football) | **READY** (100% attendance, 2 matches) |
| **Player** | `md260003` | `player123` | Aadil Azhar (Football) | **NOT READY** (50% attendance, 1 match) |

> **Dataset Scope**: The seeded baseline contains **27 users (1 admin, 1 coach, 1 scout, 24 players)** with **24 seeded players (10 trial-ready)**. Any players or staff accounts created in the live app are persisted in `academy_final`, but will be overwritten if the database is re-seeded.

---

## Admin Staff Management

The Admin role possesses full staff lifecycle management privileges directly in the workspace (`/app` > **Staff** sidebar navigation):
- **Create Staff**: Admins can provision new **Coach** and **Scout** accounts with unique usernames (3–30 chars), optional emails, and secure passwords (minimum 8 characters or 1-click cryptographically generated temporary password).
- **One-Time Credential Reveal**: Account creation and password resets present a one-time credential modal with individual and bulk copy actions.
- **Mandatory First-Time Password Change**: Newly created staff accounts have `mustChangePassword = true` enforced on the server, requiring a permanent password change upon their first login.
- **Edit & Reset Password**: Admins can edit names, update emails, and trigger secure password resets.
- **Safe Staff Deletion**: Deleting a coach with assigned athletes is guarded: it requires either reassigning the athletes to another coach or will be blocked with a clear error. Scouts can be deleted freely, and admins cannot delete themselves.
- **Seeding Baseline Notice**: Any staff accounts or athletes added via the live UI are stored live in MongoDB Atlas `academy_final`. Re-running `node scripts/seed.js` will reset the database back to the seeded baseline (27 users, 24 players).

---

## Environment Variables

Configure the following environment variables (defined in `client/.env.local` for local development, or in Vercel Project Settings for production):

| Variable | Description | Required | Format / Constraint |
|---|---|:---:|---|
| `MONGODB_URI` | MongoDB Atlas connection string. | **YES** | **Must end in `/academy_final`** (`mongodb+srv://<user>:<password>@<cluster-host>/academy_final?retryWrites=true&w=majority`) |
| `JWT_SECRET` | Secret key for signing and verifying HS256 auth tokens. | **YES** | Minimum 32 random characters (no default fallback). |
| `ALLOW_PRODUCTION_DB` | Safety guard flag enabling production database connections. | **YES** | Must be set to `true` (enforces connection exclusively to `academy_final`). |

> [!CAUTION]
> **DO NOT SET `ALLOW_MOCK_NOW` IN PRODUCTION!**
> `ALLOW_MOCK_NOW` allows time-travel via the `x-mock-now` header or `?mockNow` query parameter for automated test suites. In production deployments, it must remain unset so that match kickoff, scoring unlock, and status calculations strictly reflect authentic wall-clock time in Indian Standard Time (UTC+05:30).

---

## Guarded Database Seeding

The seed script refuses to execute unless the target database name in `MONGODB_URI` equals `academy_final` AND `ALLOW_PRODUCTION_DB=true`:

```powershell
$env:ALLOW_PRODUCTION_DB = "true"
$env:MONGODB_URI = "mongodb+srv://<user>:<password>@<cluster-host>/academy_final?retryWrites=true&w=majority"
node scripts/seed.js
```

---

## Local Run Steps

1. **Install Dependencies**:
   ```bash
   cd client
   npm install
   ```

2. **Configure Environment Variables**:
   Create a local configuration file `client/.env.local` (this file is git-ignored):
   ```bash
   cp .env.example .env.local
   ```
   Provide your MongoDB URI (ending in `/academy_final`) and JWT secret in `.env.local`:
   ```env
   MONGODB_URI=mongodb+srv://<user>:<password>@<cluster-host>/academy_final?retryWrites=true&w=majority
   JWT_SECRET=your_jwt_secret_key_minimum_32_characters
   ALLOW_PRODUCTION_DB=true
   ```

3. **Start Development Server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

4. **Production Build & Test Locally**:
   ```bash
   npm run build
   npm run start
   ```

---

## Vercel Deployment Guide

### 1. Project Root Directory
In the Vercel Project Settings (`Settings` > `General`):
- Set **Root Directory** to `client`.
- Framework Preset: **Next.js** (automatically detected from `client/package.json`).
- No custom build overrides or additional configuration required.

### 2. Configure Environment Variables
In the Vercel Dashboard (`Settings` > `Environment Variables`), configure:
- `MONGODB_URI`: Connection string ending in `/academy_final`.
- `JWT_SECRET`: Random secret string (min 32 characters).
- `ALLOW_PRODUCTION_DB`: Set to `true`.

### 3. MongoDB Atlas Network Access
Because Vercel serverless functions execute on dynamic IP pools:
- In MongoDB Atlas, navigate to **Network Access** (`Security` > `Network Access`).
- Ensure IP Access List entry `0.0.0.0/0` (Allow access from anywhere) is configured.
