// client/test/roster.unit.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPlayerEligibleForSession, computeSessionRoster } from '../src/lib/roster';

describe('Unified Session Roster & Eligibility System', () => {
  const baseSession = {
    _id: 'sess_1',
    date: new Date('2026-11-06T10:00:00Z'),
    sport: 'Football',
    coach: 'coach_1',
    saved: true,
    locked: true,
    attendance: [
      { player: 'player_kamran', status: 'present', participation: 'both' },
      { player: 'player_aadil', status: 'absent', participation: null },
    ],
  };

  it('1. Eligible player: same sport, registered before session, defaultParticipation includes practice', () => {
    const eligiblePlayer = {
      _id: 'player_rohan',
      name: 'Rohan Mehta',
      sport: 'Football',
      coach: 'coach_1',
      registeredOn: new Date('2026-08-01T00:00:00Z'), // ~90 days before Nov 6
      defaultParticipation: 'both',
    };

    assert.equal(isPlayerEligibleForSession(eligiblePlayer, baseSession), true);
  });

  it('2. Ineligible: registered after the session date', () => {
    const latePlayer = {
      _id: 'player_late',
      name: 'Late Registrant',
      sport: 'Football',
      coach: 'coach_1',
      registeredOn: new Date('2026-11-08T00:00:00Z'), // After Nov 6
      defaultParticipation: 'both',
    };

    assert.equal(isPlayerEligibleForSession(latePlayer, baseSession), false);
  });

  it('3. Ineligible: wrong sport', () => {
    const cricketPlayer = {
      _id: 'player_simran',
      name: 'Simran Kaur',
      sport: 'Cricket',
      coach: 'coach_1',
      registeredOn: new Date('2026-08-01T00:00:00Z'),
      defaultParticipation: 'both',
    };

    assert.equal(isPlayerEligibleForSession(cricketPlayer, baseSession), false);
  });

  it('4. Ineligible: defaultParticipation does not include practice (match-only)', () => {
    const matchOnlyPlayer = {
      _id: 'player_match_only',
      name: 'Match Only Athlete',
      sport: 'Football',
      coach: 'coach_1',
      registeredOn: new Date('2026-08-01T00:00:00Z'),
      defaultParticipation: 'match',
    };

    assert.equal(isPlayerEligibleForSession(matchOnlyPlayer, baseSession), false);
  });

  it('5. Ineligible: different coach assigned', () => {
    const otherCoachPlayer = {
      _id: 'player_other_coach',
      name: 'Other Coach Athlete',
      sport: 'Football',
      coach: 'coach_999',
      registeredOn: new Date('2026-08-01T00:00:00Z'),
      defaultParticipation: 'both',
    };

    assert.equal(isPlayerEligibleForSession(otherCoachPlayer, baseSession), false);
  });

  it('6. computeSessionRoster: handles saved attendance entry cleanly', () => {
    const allPlayers = [
      {
        _id: 'player_kamran',
        name: 'Kamran Akmal',
        sport: 'Football',
        coach: 'coach_1',
        registeredOn: new Date('2026-11-04T00:00:00Z'),
        defaultParticipation: 'both',
        isReady: true,
      },
    ];

    const roster = computeSessionRoster(baseSession, allPlayers);
    assert.equal(roster.length, 1);
    assert.equal(roster[0].playerId, 'player_kamran');
    assert.equal(roster[0].inRoster, true);
    assert.equal(roster[0].sessionStatus, 'present');
    assert.equal(roster[0].hasSavedEntry, true);
  });

  it('7. computeSessionRoster: eligible player with no entry in locked session gets inRoster: true and not_recorded', () => {
    const allPlayers = [
      {
        _id: 'player_rohan',
        name: 'Rohan Mehta',
        sport: 'Football',
        coach: 'coach_1',
        registeredOn: new Date('2026-08-01T00:00:00Z'),
        defaultParticipation: 'both',
        isReady: true,
      },
    ];

    const roster = computeSessionRoster(baseSession, allPlayers);
    assert.equal(roster.length, 1);
    assert.equal(roster[0].playerId, 'player_rohan');
    // Crucial requirement: MUST be inRoster: true, sessionStatus: 'not_recorded'
    assert.equal(roster[0].inRoster, true);
    assert.equal(roster[0].sessionStatus, 'not_recorded');
    assert.equal(roster[0].hasSavedEntry, false);
  });

  it('8. computeSessionRoster: eligible player in draft session gets inRoster: true and not_taken', () => {
    const draftSession = {
      _id: 'sess_draft',
      date: new Date('2026-11-06T10:00:00Z'),
      sport: 'Football',
      coach: 'coach_1',
      saved: false,
      locked: false,
      attendance: [],
    };

    const allPlayers = [
      {
        _id: 'player_rohan',
        name: 'Rohan Mehta',
        sport: 'Football',
        coach: 'coach_1',
        registeredOn: new Date('2026-08-01T00:00:00Z'),
        defaultParticipation: 'both',
      },
    ];

    const roster = computeSessionRoster(draftSession, allPlayers);
    assert.equal(roster.length, 1);
    assert.equal(roster[0].inRoster, true);
    assert.equal(roster[0].sessionStatus, 'not_taken');
  });

  it('9. computeSessionRoster: genuinely ineligible players receive inRoster: false (not_in_roster)', () => {
    const allPlayers = [
      {
        _id: 'p_wrong_sport',
        name: 'Cricket Player',
        sport: 'Cricket',
        coach: 'coach_1',
        registeredOn: new Date('2026-08-01T00:00:00Z'),
        defaultParticipation: 'both',
      },
      {
        _id: 'p_late_reg',
        name: 'Late Registered Player',
        sport: 'Football',
        coach: 'coach_1',
        registeredOn: new Date('2026-11-08T00:00:00Z'),
        defaultParticipation: 'both',
      },
    ];

    const roster = computeSessionRoster(baseSession, allPlayers);
    assert.equal(roster.length, 2);
    assert.equal(roster[0].inRoster, false);
    assert.equal(roster[0].sessionStatus, 'not_in_roster');
    assert.equal(roster[1].inRoster, false);
    assert.equal(roster[1].sessionStatus, 'not_in_roster');
  });
});
