'use client';

import React, { useState, useEffect } from 'react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // If already authenticated, redirect to /app (or /app/scout for scout) immediately without hydration mismatch
  useEffect(() => {
    try {
      const token = localStorage.getItem('token');
      const user = localStorage.getItem('user');
      if (token && user) {
        try {
          const parsed = JSON.parse(user);
          if (parsed?.role === 'scout') {
            window.location.href = '/app/scout';
            return;
          }
        } catch (_) {}
        window.location.href = '/app';
        return;
      }
    } catch (_) {}
    setIsCheckingAuth(false);
  }, []);

  function fillDemo(user: string, pass: string) {
    setUsername(user);
    setPassword(pass);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Please enter both username and password.');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error((data && data.error) || 'Invalid credentials');
      }

      // Store in localStorage using the EXACT keys and format expected by script.js
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));

      // Redirect to scout radar for scout role, or SPA workspace for others
      if (data.user?.role === 'scout') {
        window.location.href = '/app/scout';
      } else {
        window.location.href = '/app';
      }
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check credentials.');
    } finally {
      setLoading(false);
    }
  }

  if (isCheckingAuth) {
    return (
      <div className="login-loading-screen">
        <span className="login-spinner">⏳</span>
        <span>Loading session...</span>
      </div>
    );
  }

  return (
    <div className="login-page">
      {/* Ambient gradient glow in background */}
      <div className="login-bg-glow-container">
        <div className="login-bg-glow-top" />
        <div className="login-bg-glow-bottom" />
      </div>

      {/* Top Header */}
      <header className="login-header">
        <div className="login-brand">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 200 200"
            width="56"
            height="56"
            className="login-logo"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="mGradNav" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
            </defs>
            <path
              d="M 0 200 L 0 0 L 100 100 L 200 0 L 200 200 L 150 200 L 150 80 L 100 140 L 50 80 L 50 200 Z"
              fill="url(#mGradNav)"
            />
            <rect x="0" y="96" width="200" height="8" fill="#ffffff" />
          </svg>
          <div className="login-brand-text">
            <span className="login-brand-title">
              Maidan <span className="login-brand-accent">Desk</span>
            </span>
            <span className="login-brand-subtitle">
              Dumka Sports OS
            </span>
          </div>
        </div>
        <div>
          <span className="login-header-status">
            <span className="login-pulse-dot" />
            Next.js Production
          </span>
        </div>
      </header>

      {/* Main Login Hero */}
      <main className="login-main">
        <div className="login-card">
          <div className="login-card-header">
            <h1 className="login-title">
              Sign In
            </h1>
            <p className="login-subtitle">
              Enter credentials or pick a demo role to access the desk.
            </p>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="login-error-banner" role="alert">
              <span className="login-error-icon">✕</span>
              <span>{error}</span>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="login-form">
            <div className="login-field">
              <label
                htmlFor="login-username"
                className="login-label"
              >
                Username or Email
              </label>
              <input
                id="login-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. coach, admin, md260001"
                className="login-input"
                autoComplete="username"
                required
              />
            </div>

            <div className="login-field">
              <label
                htmlFor="login-password"
                className="login-label"
              >
                Password
              </label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="login-input"
                autoComplete="current-password"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="login-submit-btn"
            >
              {loading ? (
                <>
                  <span className="login-spinner">⏳</span>
                  <span>Authenticating...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <span aria-hidden="true">→</span>
                </>
              )}
            </button>
          </form>

          {/* Quick-Fill Demo Roles */}
          <div className="login-quick-fill-section">
            <p className="login-quick-fill-title">
              Quick Fill Demo Roles
            </p>
            <div className="login-quick-fill-grid">
              <button
                type="button"
                onClick={() => fillDemo('admin', 'admin123')}
                className="login-pill-btn"
              >
                <div className="login-pill-row">
                  <span className="login-pill-role">Admin</span>
                  <span className="login-pill-user">admin</span>
                </div>
                <div className="login-pill-desc">
                  Full control & setup
                </div>
              </button>

              <button
                type="button"
                onClick={() => fillDemo('coach', 'coach123')}
                className="login-pill-btn"
              >
                <div className="login-pill-row">
                  <span className="login-pill-role">Coach</span>
                  <span className="login-pill-user">coach</span>
                </div>
                <div className="login-pill-desc">
                  Sessions & matches
                </div>
              </button>

              <button
                type="button"
                onClick={() => fillDemo('scout', 'scout123')}
                className="login-pill-btn"
              >
                <div className="login-pill-row">
                  <span className="login-pill-role">Scout</span>
                  <span className="login-pill-user">scout</span>
                </div>
                <div className="login-pill-desc">
                  Athlete scouting
                </div>
              </button>

              <button
                type="button"
                onClick={() => fillDemo('md260001', 'player123')}
                className="login-pill-btn"
              >
                <div className="login-pill-row">
                  <span className="login-pill-role">Player</span>
                  <span className="login-pill-user">md260001</span>
                </div>
                <div className="login-pill-desc">
                  Athlete portal
                </div>
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="login-footer">
        Maidan Desk &bull; Dumka Sports Academy Management Platform
      </footer>
    </div>
  );
}
