// client/test/scout-pdf.unit.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScoutPdfRows,
  ReadyPlayer,
  getPlayerStarInfo,
  getCoachDisplayName,
} from '../src/app/app/scout/scoutPdf';

const mockPlayers: ReadyPlayer[] = [
  {
    _id: 'p1',
    name: 'Kamran Akmal',
    sport: 'Football',
    age: 20,
    coach: { _id: 'c1', name: 'Coach Sharma' },
    attendanceRate: 100,
    presentSessions: 2,
    totalSessions: 2,
    matchesPlayed: 2,
    hasPerformanceStar: true,
  },
  {
    _id: 'p2',
    name: 'Krishna Ashish',
    sport: 'Football',
    age: 19,
    coach: 'Coach Sharma',
    attendanceRate: 100,
    presentSessions: 2,
    totalSessions: 2,
    matchesPlayed: 2,
    hasPerformanceStar: false,
    matchHistory: [
      { played: true, score: 18 },
      { played: true, score: 16 },
    ],
  },
  {
    _id: 'p3',
    name: 'Arjun Nair',
    sport: 'Cricket',
    age: 19,
    coach: undefined,
    attendanceRate: 80,
    presentSessions: 4,
    totalSessions: 5,
    matchesPlayed: 3,
    hasPerformanceStar: false,
    matchHistory: [
      { played: true, score: 8 },
      { played: true, score: 10 },
    ],
  },
  {
    _id: 'p4',
    name: 'Vivaan Sharma',
    sport: 'Basketball',
    age: 18,
    coach: { _id: 'c2', name: 'Coach Roy' },
    attendanceRate: 90,
    presentSessions: 9,
    totalSessions: 10,
    matchesPlayed: 4,
    hasPerformanceStar: false,
  },
];

test('Scout PDF Row Builder - Empty List Handling', () => {
  // 1. Completely empty array
  const emptyRows = buildScoutPdfRows([]);
  assert.deepEqual(emptyRows, []);

  // 2. Undefined/invalid input
  const invalidRows = buildScoutPdfRows(null as any);
  assert.deepEqual(invalidRows, []);

  // 3. Filters matching zero players
  const noMatchRows = buildScoutPdfRows(mockPlayers, 'Rugby', '');
  assert.deepEqual(noMatchRows, []);
});

test('Scout PDF Row Builder - Sport and Search Filtering', () => {
  // 1. Filter by specific sport (Football)
  const footballRows = buildScoutPdfRows(mockPlayers, 'football');
  assert.equal(footballRows.length, 2);
  assert.equal(footballRows[0].sport, 'Football');
  assert.equal(footballRows[1].sport, 'Football');

  // 2. Filter by search query (case-insensitive)
  const searchRows = buildScoutPdfRows(mockPlayers, 'all', 'krishna');
  assert.equal(searchRows.length, 1);
  assert.ok(searchRows[0].playerName.includes('Krishna Ashish'));

  // 3. Combined sport + search query
  const combinedRows = buildScoutPdfRows(mockPlayers, 'Cricket', 'Arjun');
  assert.equal(combinedRows.length, 1);
  assert.ok(combinedRows[0].playerName.includes('Arjun Nair'));

  // 4. Mismatched sport + search query returns empty
  const mismatchRows = buildScoutPdfRows(mockPlayers, 'Football', 'Vivaan');
  assert.equal(mismatchRows.length, 0);
});

test('Scout PDF Row Builder - Star Marker Formatting (No Emojis)', () => {
  const rows = buildScoutPdfRows(mockPlayers, 'all');

  // Player 1 has explicit hasPerformanceStar: true -> marked with " (Star)"
  const p1 = rows.find(r => r.playerName.includes('Kamran'));
  assert.ok(p1);
  assert.equal(p1.playerName, 'Kamran Akmal (Star)');
  assert.ok(!p1.playerName.includes('⭐'), 'Should not contain unicode emoji');

  // Player 2 has average score >= 15 -> inferred star marked with " (Star)"
  const p2 = rows.find(r => r.playerName.includes('Krishna'));
  assert.ok(p2);
  assert.equal(p2.playerName, 'Krishna Ashish (Star)');
  assert.ok(!p2.playerName.includes('⭐'), 'Should not contain unicode emoji');

  // Player 3 has no star -> plain name
  const p3 = rows.find(r => r.playerName.includes('Arjun'));
  assert.ok(p3);
  assert.equal(p3.playerName, 'Arjun Nair');
  assert.ok(!p3.playerName.includes('(Star)'));
});

test('Scout PDF Row Builder - Formats Columns and Fallbacks Correctly', () => {
  const rows = buildScoutPdfRows(mockPlayers, 'all');

  // 1-based index
  assert.equal(rows[0].index, 1);
  assert.equal(rows[1].index, 2);
  assert.equal(rows[2].index, 3);
  assert.equal(rows[3].index, 4);

  // Coach object parsing
  assert.equal(rows[0].coach, 'Coach Sharma');

  // Coach string parsing
  assert.equal(rows[1].coach, 'Coach Sharma');

  // Coach undefined fallback
  assert.equal(rows[2].coach, 'Dumka Academy');

  // Attendance string format
  assert.equal(rows[0].attendanceText, '100% (2/2)');
  assert.equal(rows[2].attendanceText, '80% (4/5)');

  // Status column
  assert.equal(rows[0].status, 'Trial Eligible');
});

