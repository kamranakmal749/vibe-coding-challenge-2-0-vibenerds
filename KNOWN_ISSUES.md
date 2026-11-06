# Known Issues & Deferred Technical Debt

These items represent pre-existing bugs, schema mismatches, and legacy fixtures in the codebase prior to the Next.js migration. Per Prime Directives 1 and 2, **behavior parity is maintained over refactoring** during migration: the Next.js implementation ports current behavior 1:1. These issues are catalogued here to be addressed systematically **after final cutover and verification**.

---

### 1. Pre-Existing Backend Bugs
- **`AuditLog` Never Written**:
  - In [`src/routes/players.js`](file:///c:/Users/pooki/Desktop/hackathon/src/routes/players.js#L380-L382), administrative player deletion performs a `console.log("[AUDIT] Admin ...")` statement rather than creating and persisting an `AuditLog` document (`AuditLog.create(...)`). As a result, the `auditlogs` collection in MongoDB remains empty.
- **`audit.js` Route Unmounted**:
  - [`src/routes/audit.js`](file:///c:/Users/pooki/Desktop/hackathon/src/routes/audit.js) defines admin endpoints `GET /api/audit-logs` and `GET /api/audit-logs/:id`, but it is never mounted in [`src/app.js`](file:///c:/Users/pooki/Desktop/hackathon/src/app.js). It is currently dead code in the Express backend.
- **Omission of `broadcastServerSync` in `PUT /api/matches/:id/entries`**:
  - In [`src/routes/matches.js`](file:///c:/Users/pooki/Desktop/hackathon/src/routes/matches.js#L1122), the deprecated `PUT /api/matches/:id/entries` endpoint saves entries and returns HTTP 200, but omits `broadcastServerSync(...)`. Consequently, it does not change `/api/sync/version` on Express. (All other 20 mutation routes in sessions, matches, and players call `broadcastServerSync`).

---

### 2. Seed Script vs Model Schema Inconsistency
- **Cricket Score Upper Limit Mismatch**:
  - [`src/models/Match.js`](file:///c:/Users/pooki/Desktop/hackathon/src/models/Match.js#L7-L11) defines validation on player scores: `max: [20, 'Score cannot exceed 20']`.
  - [`scripts/seed.js`](file:///c:/Users/pooki/Desktop/hackathon/scripts/seed.js#L306-L308) attempts to insert cricket scores of `38` and `45` for Simran Kaur and Arjun Nair in match `s1_c_m1`.
  - Running `scripts/seed.js` fails midway with `ValidationError: Match validation failed: entries.0.score: Score cannot exceed 20`, halting execution before Set 2 players and matches are created.
  - *Resolution deferred*: Adjust either sport-specific score limits or seed fixture scores post-cutover.

---

### 3. Stale Legacy Test Fixtures
- **11-Player Minimum Team Size Rule**:
  - When the standard team size validation (`minTeamSize`: Football 11, Cricket 11) was added to `matches.js`, test suites written for earlier phases (`match-phase2.test.js`, `match-phase3.test.js`, `data-synchronization.test.js` tests 1–5, `checklist.test.js` check 2) used test fixtures with only 0 to 4 registered players. `POST /api/matches` rightly rejects these with `400 Bad Request`.
- **Future Date Validation**:
  - `sessions.js` enforces that attendance sessions cannot be scheduled in the future (`Cannot create attendance sessions for future dates`).
  - `session-roster-integrity.test.js` and `acceptance.test.js` use static future dates (`2027-01-15` and `2027-01-01`), triggering 400 Bad Request.
- **Deprecated `PUT /api/matches/:id/entries` Endpoint**:
  - `acceptance.test.js` tests 6–12 target the deprecated Phase 2 `PUT /entries` endpoint, which was replaced in Phase 7/8 by the unified `/save-all` and `/complete` workflow.
- **Client Sync Test Contract in `player-removal-unit.test.js`**:
  - Test 7 checks for specific regex strings inside `script.js`. This test is retired by design at cutover once `script.js` is replaced by the Next.js client.

---

### 4. Auth & Token Invalidation
- **Deleted Coach/Admin Tokens Valid Until Expiry**:
  - In Express [`src/middleware/auth.js`](file:///c:/Users/pooki/Desktop/hackathon/src/middleware/auth.js#L18), the database user lookup (`User.findById`) and profile revocation check are executed only if `req.user.role === 'player'`.
  - For coach and admin roles, tokens are validated purely cryptographically against `JWT_SECRET`. If a coach or admin account is deleted or removed from MongoDB, existing JWT tokens issued to that account continue to work on endpoints that do not explicitly perform a fresh `User.findById` query until the 8-hour token TTL expires.
  - *Resolution*: Ported 1:1 to Next.js during migration to preserve behavior parity; post-cutover remediation can add universal user lookup or token revocation across all roles.


