# Maidan Desk — Sports Academy OS

Maidan Desk is a comprehensive sports academy management and talent scouting platform engineered for Dumka Sports Academy. It unifies multi-sport player development, attendance session tracking, match scheduling, scoring, and professional scouting evaluations across four core roles: Admin, Coach, Scout, and Athlete.

---

## Architecture & Migration Status

- **Backend**: **100% migrated to Next.js App Router route handlers** (`client/src/app/api/**/route.ts`). All 35 REST endpoints across authentication, player profiles, attendance sessions, match lifecycles, scouting radar, and sync operate natively on MongoDB Atlas with HS256 JWT security and strict Indian Standard Time (`Asia/Kolkata`, UTC+05:30) validation.
- **Frontend**: Hybrid architecture in transition:
  - **Native React Entry & Auth (`/`)**: High-performance React client component (`client/src/app/page.tsx`) with dark glassmorphism, 1-click demo role fill, and automatic session restoration.
  - **Native React Scout Radar (`/app/scout`)**: Dedicated Next.js React client component for scouting talent discovery, real-time trial readiness indicators, and performance star evaluations.
  - **Academy Workspace SPA (`/app`)**: The battle-tested management single-page application is served directly by Next.js via route rewrite, preserving complete operational parity for all administrative, coaching, and athlete workflows while native React pages are progressively ported.
- **Database**: MongoDB Atlas with atomic sync tracking (`syncstates`), optimistic locking, and strict database environment guards.

---

## Live Deployment Placeholder

- **Live URL**: `https://<your-maidandesk-app>.vercel.app`
- **Entry Point**: `https://<your-maidandesk-app>.vercel.app/`
- **SPA Workspace**: `https://<your-maidandesk-app>.vercel.app/app`
- **Scout Portal**: `https://<your-maidandesk-app>.vercel.app/app/scout`

---

## Demo Credentials

Sign in with any of the pre-seeded demo accounts (or use the 1-click quick-fill buttons on the login page):

| Role | Username | Password | Purpose & Capabilities |
|---|---|---|---|
| **Admin** | `admin` | `admin123` | Academy-wide oversight, athlete registrations, coach assignments, audit logs |
| **Coach** | `coach` | `coach123` | Daily session attendance locking, match scheduling, dynamic roster eligibility, scoring |
| **Scout** | `scout` | `scout123` | Trial-ready player discovery radar ($\ge 75\%$ attendance & $\ge 2$ matches), star badges |
| **Player** | `md260001` | `player123` | Athlete portal: personal session attendance, match history, readiness status |

---

## Local Run & Build Steps

The Next.js application is located in the `client/` directory:

```bash
# 1. Navigate to the client directory
cd client

# 2. Install dependencies
npm install

# 3. Configure local environment variables
# Copy .env.example to .env.local (git-ignored)
cp .env.example .env.local

# Provide your MongoDB Atlas URI and JWT Secret in client/.env.local:
# MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/academy_parity?retryWrites=true&w=majority
# JWT_SECRET=your_jwt_secret_key_min_32_characters

# 4. Start the development server
npm run dev
# Server boots at http://localhost:3000

# 5. Production build & run locally
npm run build
npm run start
```

---

## Vercel Deployment Steps

1. **Import Repository**:
   - In the Vercel Dashboard, import this repository.
2. **Configure Root Directory**:
   - In **Project Settings** > **General**, set **Root Directory** to `client`.
   - Framework preset will automatically detect **Next.js**.
3. **Environment Variables**:
   In **Project Settings** > **Environment Variables**, configure:
   - `MONGODB_URI`: Your MongoDB Atlas connection URI string.
   - `JWT_SECRET`: Random secret string (minimum 32 characters) for HS256 tokens.
   - `ALLOW_PRODUCTION_DB`: Set to `true` to permit connection to production database names.
   > [!CAUTION]
   > Do **NOT** set `ALLOW_MOCK_NOW` in production. Time-mocking is strictly reserved for automated testing.
4. **Deploy**:
   - Trigger deployment. Vercel will build the Next.js bundle and serverless route handlers cleanly.
