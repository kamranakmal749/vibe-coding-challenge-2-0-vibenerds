# CHANGELOG — MaidanDesk v2 (Academy ERP)

This document details all schema updates, business rule shifts, API endpoints, status codes, and deprecations introduced in the v2 per-day participation, attendance immutability, default Present, and match day results release.

---

## 1. Summary of Changes

| Domain | Prior Behavior (v1) | New Behavior (v2) |
| :--- | :--- | :--- |
| **Attendance Default** | Players defaulted to absent on session creation. | Every player of that coach & sport defaults to `status: 'present'` with `participation: player.defaultParticipation`. |
| **Participation Tracking** | No per-session participation granularity; attendance was binary present/absent. | Per-entry participation (`'practice'`, `'match'`, `'both'`) for present players; absent players have `participation: null`. |
| **Attendance Lifecycle** | Separate Draft -> Saved -> Lock workflow with lock buttons in 4 places. | Single "Save Attendance" action. Saving atomically sets `saved: true` and `savedAt: new Date()`. Sessions are immutable once saved. Separate lock buttons removed. |
| **Session Uniqueness** | Multiple sessions allowed per coach/date/sport. | Unique compound index on `(coach, date, sport)`. Duplicate attempts return `409 Conflict`. |
| **Match Guard** | Required a locked session; only tested presence. | Requires a **saved** session for that coach, date, and sport. Absent players AND practice-only players are strictly barred from match entries. |
| **Match Entries** | `scores: [{ player, score }]` array containing only scoring players. | `entries: [{ player, result, score }]` requiring an entry for **every** eligible player (`result: 'played'` with score, or `'did_not_play'` with `score: null`). |
| **Player Profile** | Basic fields (`name`, `age`, `sport`). | Added `registeredOn` (Date of Registration, cannot be in future) and `defaultParticipation` (`enum ['practice', 'match', 'both']`, defaults to `'both'`). |

---

## 2. API Modifications & New Status Codes

### 2.1 Players API (`/api/players`)

* **`POST /api/players`**
  * **Payload accepted:** `{ name, age, sport, registeredOn?, defaultParticipation? }`
  * **New Validation:**
    * `registeredOn`: ISO Date string. Must not be a future date. Returns `400 Bad Request` if future or invalid.
    * `defaultParticipation`: Must be one of `'practice'`, `'match'`, `'both'`. Returns `400 Bad Request` if invalid.
* **`PATCH /api/players/:id`**
  * Allows coaches to update athlete details: `{ name, age, sport, registeredOn, defaultParticipation }`.
  * Returns `400 Bad Request` on invalid fields or future dates. Editing player details does not alter historical attendance or match records.
* **Readiness Evaluation Guard:**
  * Enriched using exact integer comparison: `presentCount * 4 >= totalCount * 3 && matchesPlayed >= 2`.
  * Considers only saved sessions (`saved: true` or `locked: true`) and matches with `result === 'played'`.

---

### 2.2 Sessions API (`/api/sessions`)

* **`POST /api/sessions`**
  * Automatically populates `attendance` with all active players in that sport:
    `{ player: p._id, status: 'present', participation: p.defaultParticipation || 'both' }`.
  * **New Status Code `409 Conflict`:**
    * Returned if a session for `(coach, date, sport)` already exists:
      `{ message: "A session for this date and sport already exists." }`.
* **`PATCH /api/sessions/:id/save`** (Primary Lifecycle Endpoint)
  * Atomically saves attendance roster and marks the session immutable.
  * Sets `saved: true`, `savedAt: new Date()`, and syncs `locked: true`.
  * Normalizes absent players to `participation: null`.
  * **Status Code `409 Conflict`:**
    * Returned if session was already saved or if a concurrent save request lost the atomic race:
      `{ message: "Session is already saved and cannot be modified." }`.
* **`PATCH /api/sessions/:id/bulk` & `PATCH /api/sessions/:id/mark`**
  * Allowed only while session is in Draft (`saved: false`).
  * **New Status Code `409 Conflict`:**
    * Returned if session has already been saved:
      `{ message: "Session is already saved and cannot be modified." }`.
* **`PATCH /api/sessions/:id/lock`** (Deprecated Alias)
  * Preserved for backward compatibility. Invokes the save logic. Returns `409 Conflict` if already saved.

---

### 2.3 Matches API (`/api/matches`)

* **`POST /api/matches`**
  * Accepts `{ date, sport, opponent }`.
  * Creates or returns fixture linked to `sessionId` (if an attendance session exists for that date and sport).
* **`PUT /api/matches/:id/entries`** (Complete Match Scoring Endpoint)
  * Accepts `{ entries: [{ playerId, result, score }] }`.
  * **New Status Code `409 Conflict`:**
    * Returned if no session exists for the match date and sport, or if the session has not yet been saved:
      `{ message: "Cannot record match results: attendance session for this date and sport must be saved first." }`.
  * **New Status Code `422 Unprocessable Entity`:**
    * **Absent Player submitted:**
      `{ message: "Player was absent on this date and cannot have match results recorded.", playerId: "..." }`
    * **Practice-only Player submitted:**
      `{ message: "Player attended practice only on this date and cannot have match results recorded.", playerId: "..." }`
    * **Omitted Eligible Player:**
      `{ message: "Match entry missing for eligible player.", playerId: "..." }`
    * **Invalid Score for `played` Player:**
      `{ message: "Score is required and must be an integer >= 0 for players who played.", playerId: "..." }`
    * **Non-null Score for `did_not_play` Player:**
      `{ message: "Score must be null for players who did not play.", playerId: "..." }`
* **`GET /api/matches`**
  * For athletes (`role: 'player'`), returns only matches where the player had `result === 'played'`.

---

## 3. Deprecations

1. **`locked` field on Session:**
   * Deprecated in favor of `saved` (`Boolean`) and `savedAt` (`Date`).
   * `locked` is maintained as a virtual / synced property to prevent breaking existing queries.
2. **`scores` array on Match:**
   * Deprecated in favor of `entries: [{ player, result, score }]`.
   * A Mongoose virtual getter for `scores` returns entries where `result === 'played'` to preserve backward compatibility.
3. **Separate UI Lock Buttons:**
   * Separate buttons to "Lock" or "Save & Lock" in modals and lists are removed.
   * Replaced by the single "Save Attendance" action button and read-only status badges (`Saved` / `Draft`).

---

## 4. Scripts & Migrations

* **`scripts/seed.js`**:
  * Rewritten with `registeredOn`, `defaultParticipation`, saved sessions with explicit participation, and matches with complete `entries`.
* **`scripts/migrate-v2.js`**:
  * Idempotent migration script converting legacy database records:
    * Sessions with `locked: true` -> `saved: true` with `savedAt`.
    * Attendance participation initialized according to player defaults.
    * Matches with legacy `scores` converted to `entries`.
* **`test/acceptance.test.js`**:
  * 16-scenario automated test suite executing via `npm test` verifying all HTTP status codes (200, 400, 409, 422) and edge cases.

---

## 5. Match Management System Release (Phases 1–11)

### 5.1 Architecture & Data Models
* **`MatchParticipation` Collection (`src/models/MatchParticipation.js`):**
  * Per-player participation model replacing embedded arrays for matches.
  * Fields: `match` (ObjectId ref Match), `player` (ObjectId ref Player), `coach` (ObjectId ref User), `played` (Boolean or null), `score` (Number or null).
  * Unique compound index on `{ match: 1, player: 1 }` prevents duplicate athlete entries within the same match.
* **`Match` Collection (`src/models/Match.js`):**
  * Enhanced schema with `coach`, `title`, `sport`, `date`, `time`, `opponent`, `venue`, `description`, `status` (`'upcoming'`, `'completed'`, `'cancelled'`), and `completedAt`.
  * Unique compound index on `{ coach: 1, date: 1, sport: 1, opponent: 1 }` preventing duplicate fixtures.

### 5.2 Match API Endpoints (`src/routes/matches.js`)
* **`POST /api/matches`**: Creates an upcoming fixture with duplicate-guard validation (`409 Conflict`).
* **`GET /api/matches`**: Filterable list supporting `sport`, `status`, `opponent`, and date range.
* **`GET /api/matches/calendar`**: Aggregates matches by month with day-by-day fixture summaries.
* **`GET /api/matches/:id`**: Returns fixture details enriched with computed counts (`squadCount`, `playedCount`, `didNotPlayCount`).
* **`PATCH /api/matches/:id`**: Updates fixture metadata; restricted to `upcoming` matches.
* **`PATCH /api/matches/:id/cancel`**: Transitions upcoming matches to `cancelled`.
* **`GET /api/matches/:id/eligible-players`**: Derives eligible athletes strictly from saved attendance (`present` with `'match'` or `'both'`).
* **`PUT /api/matches/:id/selected-players`**: Idempotent squad roster selection enforcing attendance eligibility (`422 Unprocessable Entity` for ineligible athletes).
* **`GET /api/matches/:id/participation`**: Retrieves full squad scorecard table.
* **`PATCH /api/matches/:id/participation/:playerId`**: Updates individual athlete scorecard; validates `played: false => score: null` and `played: true => score >= 0`.
* **`PATCH /api/matches/:id/complete`**: Validates all selected athletes have a recorded status before locking match as `completed`.
* **`PATCH /api/matches/:id/reopen-for-edit`**: Allows coach to reopen a completed match back to editable state.
* **`GET /api/matches/history`**: Specialized completed match archive with per-fixture attendance aggregates.
* **Cross-Coach 403 Guards**: Comprehensive coach isolation enforced across all 12 match routes.

### 5.3 Player Stats & Readiness Integration
* **`GET /api/players/:id/attendance-history`**:
  * Enriched with `totalMatchesPlayed`, `totalMatchesSelected`, `totalMatchesNotPlayed`, and `matchHistory`.
  * Excludes cancelled and unfinalized upcoming matches from historical appearance calculations.
* **Trial Readiness**:
  * Evaluated on attendance ($\ge 75\%$) AND completed matches played ($\ge 2$).

### 5.4 Frontend UX & Modals (`index.html`, `script.js`)
* **Matches & Calendar Dashboard**: Monthly calendar grid, day fixture drawers, status filter tabs (Upcoming, Completed, History).
* **Add / Edit Modals**: Isolated input elements (`#modal-match-*` vs `#modal-edit-match-*`) with custom non-native confirmation dialogs.
* **Squad & Scorecard Flow**: Dual-tab modal for idempotent squad selection and live scorecard entry.
* **Athlete ERP Profile & Portal**: 4 benchmark cards (Attendance, Matches Played, Squad Selected, Did Not Play), Trial Readiness status pills, and personal match appearances.


