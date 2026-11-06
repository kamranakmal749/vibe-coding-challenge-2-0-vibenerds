# Maidan Desk — Next.js Migration

The API is fully migrated to Next.js route handlers on MongoDB. The entry portal at `/` is a native React login page, while the battle-tested workspace SPA is served at `/app`.

---

## Architecture Overview

- **Backend**: 100% of the REST API (35 endpoints across authentication, players, attendance sessions, matches, scouting, and synchronization) has been ported from legacy Express to Next.js App Router route handlers (`client/src/app/api/**/route.ts`).
- **Entry Page (`/`)**: A dedicated React client component (`client/src/app/page.tsx`) styled with dark glassmorphism and emerald accents. Features username/password inputs, 1-click quick-fill demo roles (Admin, Coach, Scout, Player `md260001`), authentication error banners, and automatic redirect to `/app` for existing sessions via `useEffect` (preventing SSR hydration mismatch).
- **SPA Workspace (`/app`)**: The legacy single-page application (`index.html`, `script.js`, `style.css`, and vendor libraries) is mapped to `/app` via Next.js `beforeFiles` rewrite (`{ source: '/app', destination: '/index.html' }`).
- **Clock & Timezone (IST)**: All date defaults (fixture date picker, session date defaults, report exports), match kickoff/unlock timing, scoring lock windows, and attendance calendar queries operate strictly on Indian Standard Time (`Asia/Kolkata`, UTC+05:30) via explicit helpers (`getTodayIstString`, `istDateString`, `istDateTime`). This eliminates timezone drift between UTC hosting (e.g. Vercel) and client browser clocks.
- **Error Handling**: The client fetch wrapper (`api()`) intercepts low-level network failures and presents a user-friendly message (`"Cannot reach the server. Check your connection and try again."`) instead of leaking raw browser `"Failed to fetch"` exceptions. All server-side domain errors (400, 403, 409, 422) remain untouched.
- **Session Lifecycle & Logout**: User sign-out and HTTP 401 handling clear `token` and `user` from `localStorage` and redirect to `/`, while preserving session-expired notification toasts.
- **Synchronization**: SSE stream has been replaced by 4-second polling against `/api/sync/version` backed by atomic document increments in the `syncstates` collection in MongoDB.

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
   Provide your MongoDB URI and JWT secret in `.env.local`:
   ```env
   MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/academy_parity?retryWrites=true&w=majority
   JWT_SECRET=your_jwt_secret_key_here
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

## Demo Credentials

You can sign in with any of the following pre-seeded test accounts (also accessible via 1-click quick-fill buttons on `/`):

| Role | Username | Password | Default Landing View |
|---|---|---|---|
| **Admin** | `admin` | `admin123` | System Overview, Academy Roster, Coach Management |
| **Coach** | `coach` | `coach123` | Session Attendance & Match Operations |
| **Scout** | `scout` | `scout123` | Scout Radar & Trial-Ready Player Roster |
| **Player** | `md260001` | `player123` | Personal Player Attendance & Match Performance Portal |

---

## Vercel Deployment Guide

### 1. Project Root Directory
In the Vercel Project Settings (`Settings` > `General`):
- Set **Root Directory** to `client`.
- Framework Preset: `Next.js`.

### 2. Environment Variables
Configure the following in the Vercel Dashboard (`Settings` > `Environment Variables`):

| Variable Name | Value / Format | Required | Description |
|---|---|:---:|---|
| `MONGODB_URI` | `mongodb+srv://...` | **YES** | MongoDB connection string. |
| `JWT_SECRET` | String (min 32 chars) | **YES** | Secret key for signing and verifying HS256 auth tokens. |
| `ALLOW_PRODUCTION_DB` | `true` | **YES** | Allows connection to production database names. (Without this flag, the server safety guard rejects any database other than `academy_dev` or `academy_parity`). |

> [!CAUTION]
> **DO NOT SET `ALLOW_MOCK_NOW` IN PRODUCTION!**
> `ALLOW_MOCK_NOW` allows arbitrary time-travel via the `x-mock-now` header or `?mockNow` query parameter for automated testing. In production deployments, it must remain unset so that match kickoff, scoring unlock, and status calculations strictly reflect authentic wall-clock time in Indian Standard Time (UTC+05:30).

### 3. MongoDB Atlas Network Access
Because Vercel serverless functions execute on dynamic IP addresses:
- In MongoDB Atlas, go to **Network Access** (`Security` > `Network Access`).
- Add IP Access List entry `0.0.0.0/0` (Allow access from anywhere).
