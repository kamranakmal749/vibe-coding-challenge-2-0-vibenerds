# Known Issues, Resolutions & Technical Debt

This document catalogs pre-existing bugs, resolved discrepancies, schema notes, and architectural considerations across the MaidanDesk codebase.

---

## 1. Resolved Issues

### 1.1 Locked Session Roster Discrepancy (RESOLVED)
- **Symptom**: On locked training sessions, certain eligible players appeared as "NOT IN ROSTER" in the session detail view, but upon unlocking and entering edit mode, all players were displayed and defaulted to "Present".
- **Root Cause**: Divergent roster construction logic between view and edit modes. The view mode only rendered players who had existing attendance records on the session document, while edit mode computed the complete active roster for that coach, sport, and registration date.
- **Resolution**: Harmonized view and edit modes across `client/src/app/api/sessions/[id]/route.ts` and `client/public/script.js`. Both modes now use the identical roster computation logic based on active registered players for that sport and coach, eliminating "NOT IN ROSTER" inconsistencies for valid athletes.

### 1.2 Audit Log Persistence & Inspection (RESOLVED)
- **Status in Legacy Express**: `AuditLog.create()` was uncalled on player deletion (only `console.log` was executed), and `src/routes/audit.js` was unmounted in `src/app.js`.
- **Resolution in Next.js**: Full administrative audit logging is implemented in Next.js. Administrative actions across staff management (`create`, `edit`, `reset_password`, `remove`) and player operations (`edit`, `reset_password`, `delete`, `reassign_coach`) persist immutable records to the `auditlogs` collection. The endpoint `GET /api/admin/audit` serves paginated, sanitized logs to the admin workspace at `/app`.

### 1.3 Seed Script & Cricket Score Schema Alignment (RESOLVED)
- **Status in Legacy Express**: Seed script cricket scores previously exceeded the legacy schema's upper score limit.
- **Resolution**: Harmonized in `legacy/src/models/Match.js` and `client/src/lib/models/Match.ts`. `scripts/seed.js` runs cleanly against `academy_final` without schema validation errors.

### 1.4 Timezone & Calendar Month Boundaries (RESOLVED)
- **Resolution**: Addressed in `client/src/lib/ist.ts` (`istDateTime`, `istDateString`, `getWidenedDateWindow`, `getIstMonthRange`). Explicit Indian Standard Time (UTC+05:30) calculations eliminate host-local timezone dependencies on UTC serverless environments (Vercel).

---

## 2. Active Technical Considerations & Parity Notes

### 2.1 Stale Legacy Express Test Fixtures (in `legacy/test/`)
- **11-Player Minimum Team Size**: Legacy test suites written for early prototypes (`match-phase2.test.js`, `match-phase3.test.js`) used test fixtures with 0–4 registered players. `POST /api/matches` enforces standard team size validation (`minTeamSize`: Football 11, Cricket 11) and rejects fixtures with fewer players with `400 Bad Request`.
- **Future Date Validation**: Attendance sessions cannot be scheduled for future dates. Legacy tests using static future dates trigger `400 Bad Request`.
- **Deprecated `PUT /api/matches/:id/entries`**: Legacy acceptance tests targeting this deprecated endpoint have been superseded by the atomic `/save-all` and `/complete` workflows.

### 2.2 Auth & Token Invalidation Parity
- **Token Invalidation Scope**: For coach and admin roles, tokens are validated cryptographically against `JWT_SECRET`. If a coach account is deleted, existing JWT tokens remain valid until expiration (8 hours) on routes that do not perform a fresh `User.findById` query. This maintains 1:1 parity with the original Express specification.

### 2.3 Deliberate Improvements in Next.js API Routes
- **Upfront ObjectId Format Validation**: Next.js route handlers validate MongoDB ObjectIds upfront with `mongoose.Types.ObjectId.isValid(id)` and return clean `400 Bad Request` responses instead of unhandled Mongoose `CastError` 500s.
- **Coach Ownership Guard**: Next.js enforces ownership verification on match player selections (`PUT /api/matches/:id/selected-players`), ensuring coaches can modify selections only on their own matches.
