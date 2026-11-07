// client/test/player-search.unit.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterPlayersByQuery, SearchablePlayer } from '../src/lib/search';

describe('Player Search Filtering Engine', () => {
  const samplePlayers: SearchablePlayer[] = [
    { _id: '1', name: 'Rohit Roy', username: 'md260010', sport: 'Football', age: 21 },
    { _id: '2', name: 'Kamran Akmal', username: 'md260001', sport: 'Cricket', age: 20 },
    { _id: '3', name: 'Krishna Ashish', username: 'md260002', sport: 'Football', age: 19 },
    { _id: '4', name: 'Aadil Azhar', username: 'md260003', sport: 'Athletics', age: 22 },
  ];

  it('1. Case insensitivity: matches lower, UPPER, and MixedCase queries', () => {
    const lowerMatch = filterPlayersByQuery(samplePlayers, 'rohit');
    assert.equal(lowerMatch.length, 1);
    assert.equal(lowerMatch[0].name, 'Rohit Roy');

    const upperMatch = filterPlayersByQuery(samplePlayers, 'ROHIT');
    assert.equal(upperMatch.length, 1);
    assert.equal(upperMatch[0].name, 'Rohit Roy');

    const mixedMatch = filterPlayersByQuery(samplePlayers, 'RoHiT');
    assert.equal(mixedMatch.length, 1);
    assert.equal(mixedMatch[0].name, 'Rohit Roy');
  });

  it('2. Whitespace trimming: ignores leading and trailing spaces', () => {
    const paddedMatch = filterPlayersByQuery(samplePlayers, '   rohit   ');
    assert.equal(paddedMatch.length, 1);
    assert.equal(paddedMatch[0].name, 'Rohit Roy');
  });

  it('3. No match: returns empty array when query does not match any name or username', () => {
    const noMatch = filterPlayersByQuery(samplePlayers, 'nonexistentplayer123');
    assert.deepEqual(noMatch, []);
  });

  it('4. Empty query: restores full player list for empty, whitespace, null, or undefined query', () => {
    assert.equal(filterPlayersByQuery(samplePlayers, '').length, 4);
    assert.equal(filterPlayersByQuery(samplePlayers, '   ').length, 4);
    assert.equal(filterPlayersByQuery(samplePlayers, null).length, 4);
    assert.equal(filterPlayersByQuery(samplePlayers, undefined).length, 4);
  });

  it('5. Username matching: correctly finds player by username', () => {
    const usernameMatch = filterPlayersByQuery(samplePlayers, 'md260010');
    assert.equal(usernameMatch.length, 1);
    assert.equal(usernameMatch[0].name, 'Rohit Roy');

    const partialUsernameMatch = filterPlayersByQuery(samplePlayers, '260001');
    assert.equal(partialUsernameMatch.length, 1);
    assert.equal(partialUsernameMatch[0].name, 'Kamran Akmal');
  });

  it('6. Partial name matching: matches substrings in first or last name', () => {
    const lastMatch = filterPlayersByQuery(samplePlayers, 'roy');
    assert.equal(lastMatch.length, 1);
    assert.equal(lastMatch[0].name, 'Rohit Roy');

    const commonSubstr = filterPlayersByQuery(samplePlayers, 'krish');
    assert.equal(commonSubstr.length, 1);
    assert.equal(commonSubstr[0].name, 'Krishna Ashish');
  });
});

