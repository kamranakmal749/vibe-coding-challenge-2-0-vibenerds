'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface ReadyPlayer {
  _id: string;
  name: string;
  sport: string;
  age: number;
  playerId?: string;
  coach?: {
    _id: string;
    name: string;
  } | string;
  attendanceRate: number;
  presentSessions?: number;
  totalSessions?: number;
  matchesPlayed: number;
  hasPerformanceStar?: boolean;
  performanceScore?: number | null;
  matchHistory?: Array<{
    played?: boolean;
    attendanceConflict?: boolean;
    score?: number | null;
  }>;
}

export default function ScoutRadarPage() {
  const [players, setPlayers] = useState<ReadyPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [selectedSport, setSelectedSport] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const fetchReadyPlayers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const token = localStorage.getItem('token');
      if (!token) {
        window.location.href = '/';
        return;
      }

      const res = await fetch('/api/scout/ready', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/';
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data && data.error) || `Server returned ${res.status}`);
      }

      const data = await res.json();
      setPlayers(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Cannot fetch scout evaluations. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        setUser(JSON.parse(storedUser));
      }
    } catch (_) {}

    fetchReadyPlayers();
  }, [fetchReadyPlayers]);

  function handleLogout() {
    try {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    } catch (_) {}
    window.location.href = '/';
  }

  function getCoachName(coach: any): string {
    if (!coach) return 'Dumka Academy';
    if (typeof coach === 'string') return coach;
    return coach.name || 'Dumka Academy';
  }

  function getStarData(p: ReadyPlayer): { hasStar: boolean; perfScore: number | null } {
    let perfScore: number | null = null;
    if (typeof p.performanceScore === 'number') {
      perfScore = p.performanceScore;
    } else if (p.matchHistory && p.matchHistory.length) {
      const scoredMatches = p.matchHistory.filter(
        m => m.played === true && !m.attendanceConflict && m.score !== null && m.score !== undefined
      );
      if (scoredMatches.length) {
        const total = scoredMatches.reduce((acc, m) => acc + Number(m.score), 0);
        perfScore = Math.round((total / scoredMatches.length) * 10) / 10;
      }
    }

    const hasStar =
      typeof p.hasPerformanceStar === 'boolean'
        ? p.hasPerformanceStar
        : perfScore !== null && perfScore >= 15;

    return { hasStar, perfScore };
  }

  // Filter sports
  const sports = ['all', ...Array.from(new Set(players.map(p => p.sport).filter(Boolean)))];

  const filteredPlayers = players.filter(p => {
    const matchesSport = selectedSport === 'all' || p.sport.toLowerCase() === selectedSport.toLowerCase();
    const matchesSearch = !searchQuery.trim() || p.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSport && matchesSearch;
  });

  return (
    <div className="scout-page">
      {/* Background ambient lighting */}
      <div className="scout-bg-glow-container">
        <div className="scout-bg-glow-top" />
        <div className="scout-bg-glow-bottom" />
      </div>

      {/* Top Navigation */}
      <header className="scout-navbar">
        <div className="scout-nav-left">
          <a href="/app/scout" className="scout-nav-logo">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 200 200"
              width="40"
              height="40"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="scoutLogoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#34d399" />
                  <stop offset="50%" stopColor="#10b981" />
                  <stop offset="100%" stopColor="#059669" />
                </linearGradient>
              </defs>
              <rect width="200" height="200" rx="44" fill="#0b1329" />
              <path
                d="M48 148 L48 58 L72 102 L96 58 L96 148"
                stroke="url(#scoutLogoGrad)"
                strokeWidth="15"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <path
                d="M112 58 L138 58 C152 58 162 68 162 82 C162 96 152 106 138 106 L112 106 Z M112 106 L140 106 C154 106 164 116 164 130 C164 144 154 148 140 148 L112 148 Z"
                stroke="url(#scoutLogoGrad)"
                strokeWidth="14"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </a>
          <div className="scout-nav-title-group">
            <span className="scout-nav-title">Maidan Desk</span>
            <span className="scout-nav-subtitle">Scouting Radar</span>
          </div>
        </div>

        <div className="scout-nav-actions">
          <a href="/app" className="scout-nav-spa-btn" title="Open Legacy SPA Workspace">
            <span>Workspace (/app)</span>
          </a>
          <button type="button" onClick={handleLogout} className="scout-logout-btn">
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="scout-container">
        {/* Page Header */}
        <div className="scout-header-row">
          <div>
            <h1 className="scout-heading">Advanced Scouting Radar</h1>
            <p className="scout-description">
              Trial-ready academy athletes evaluated for professional talent identification &amp; trials
            </p>
          </div>

          <div className="scout-header-badges">
            <span className="scout-criteria-badge">
              <span>Threshold: &ge;75% Att. &amp; &ge;2 Matches</span>
            </span>
            <button
              type="button"
              onClick={fetchReadyPlayers}
              className="scout-refresh-btn"
              disabled={loading}
              title="Refresh evaluations from database"
            >
              <span>{loading ? 'Refreshing...' : '↻ Refresh'}</span>
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="scout-error-banner">
            <div>
              <strong>Evaluation Error:</strong> {error}
            </div>
            <button type="button" onClick={fetchReadyPlayers} className="scout-retry-btn">
              Retry
            </button>
          </div>
        )}

        {/* Main Card */}
        <div className="scout-card">
          {loading ? (
            <div className="scout-loading-state">
              <div className="scout-spinner" />
              <span className="scout-state-text">Loading scout evaluations from database...</span>
            </div>
          ) : players.length === 0 ? (
            <div className="scout-empty-state">
              <p className="scout-state-text">
                No players currently meet the Ready criteria (&ge;75% attendance and &ge;2 matches played).
              </p>
            </div>
          ) : (
            <>
              {/* Optional Filter Bar */}
              <div
                style={{
                  padding: '16px 20px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.8rem', color: '#94A3B8', fontWeight: 600 }}>Sport:</span>
                  <select
                    value={selectedSport}
                    onChange={e => setSelectedSport(e.target.value)}
                    style={{
                      background: 'rgba(30, 41, 59, 0.8)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: '8px',
                      color: '#F8FAFC',
                      padding: '4px 10px',
                      fontSize: '0.8rem',
                      outline: 'none',
                    }}
                  >
                    {sports.map(s => (
                      <option key={s} value={s}>
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="Search player name..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    style={{
                      background: 'rgba(30, 41, 59, 0.8)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: '8px',
                      color: '#F8FAFC',
                      padding: '4px 12px',
                      fontSize: '0.8rem',
                      outline: 'none',
                    }}
                  />
                  <span style={{ fontSize: '0.8rem', color: '#10B981', fontWeight: 700 }}>
                    {filteredPlayers.length} of {players.length} Ready
                  </span>
                </div>
              </div>

              {/* Ready Players Table */}
              <div className="scout-table-wrapper">
                <table className="scout-table">
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Sport &amp; Age</th>
                      <th>Attendance Rate</th>
                      <th>Matches Played</th>
                      <th style={{ textAlign: 'right' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPlayers.map(p => {
                      const { hasStar, perfScore } = getStarData(p);
                      return (
                        <tr key={p._id}>
                          <td>
                            <div className="scout-player-cell">
                              <img
                                src={`https://i.pravatar.cc/150?u=${p._id}`}
                                alt={p.name}
                                className="scout-avatar"
                              />
                              <div>
                                <div className="scout-player-name-row">
                                  <span className="scout-player-name">{p.name}</span>
                                  {hasStar && (
                                    <span
                                      className="scout-star"
                                      title={`Performance Star: Score 15+${
                                        perfScore !== null ? ` (Avg: ${perfScore})` : ''
                                      }`}
                                      aria-label="Performance score 15 or above"
                                    >
                                      ⭐
                                    </span>
                                  )}
                                </div>
                                <div className="scout-coach-label">
                                  Coach: {getCoachName(p.coach)}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="scout-sport-badge">
                              {p.sport} &bull; Age {p.age}
                            </span>
                          </td>
                          <td>
                            <span className="scout-attendance-pct">{p.attendanceRate}%</span>
                            <span className="scout-attendance-sessions">
                              ({p.presentSessions || 0}/{p.totalSessions || 0} sessions)
                            </span>
                          </td>
                          <td>
                            <span className="scout-matches-count">
                              {p.matchesPlayed} matches
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <span className="scout-status-pill">
                              <span className="scout-status-icon">✓</span>
                              <span>Trial Eligible</span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
