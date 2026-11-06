# Maidan Desk — Next.js Migration

The API is fully migrated to Next.js route handlers on MongoDB; the UI is the original vanilla app served from Next.js, with React pages to come.

---

## Architecture Overview

- **Backend**: 100% of the REST API (34 endpoints across authentication, players, attendance sessions, matches, scouting, and synchronization) has been ported from legacy Express to Next.js App Router route handlers (`client/src/app/api/**/route.ts`).
- **Frontend Live Bridge**: The original battle-tested single-page application (`index.html`, `script.js`, `style.css`, and vendor libraries) is served directly out of `client/public/` via Next.js `beforeFiles` URL rewrite (`/ -> /index.html`).
- **Clock & Timezone**: Time calculations for match kickoff, scoring lock windows, and attendance calendars operate on Indian Standard Time (IST, UTC+05:30) via explicit helpers, ensuring deterministic behavior regardless of host timezone (Vercel serverless runs in UTC).
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

You can sign in with any of the following pre-seeded test accounts:

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
