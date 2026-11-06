# Maidan Desk — Next.js App Router (Client)

This directory contains the production-ready Next.js 15 application powering both the REST API routes and the Maidan Desk application UI via static live bridge.

---

## Vercel Deployment Configuration

When deploying this project to Vercel:

1. **Root Directory**:
   - Set **Root Directory** to `client` in the Vercel Project Settings (`General` > `Root Directory`).

2. **Framework Preset**:
   - `Next.js`

3. **Build & Development Settings**:
   - Build Command: `next build` (default)
   - Output Directory: `.next` (default)
   - Install Command: `npm install` (default)

---

## Required Environment Variables

Configure the following environment variables in the Vercel Project Settings (`Settings` > `Environment Variables`):

| Variable Name | Required | Description |
|---|---|---|
| `MONGODB_URI` | **YES** | MongoDB connection string (e.g. `mongodb+srv://<user>:<password>@cluster.mongodb.net/academy_parity?retryWrites=true&w=majority`). |
| `JWT_SECRET` | **YES** | Secret key used to sign and verify HS256 authentication JWT tokens (must match legacy secret). |

> [!CAUTION]
> **DO NOT SET `ALLOW_MOCK_NOW` IN PRODUCTION!**
> `ALLOW_MOCK_NOW` allows arbitrary time-travel via the `x-mock-now` header or `?mockNow` query parameter for test assertions. In production deployments, it must remain unset so that match kickoff, scoring unlock, and status calculations strictly reflect authentic wall-clock time in Indian Standard Time (UTC+05:30).

---

## MongoDB Atlas Network Access Configuration

To allow Vercel serverless functions to connect to MongoDB Atlas:

- Navigate to **MongoDB Atlas** > **Network Access** (`Security` > `Network Access`).
- Ensure `0.0.0.0/0` (Allow access from anywhere) is configured in the IP Access List, because Vercel serverless function IP addresses are dynamic and change across invocations.

