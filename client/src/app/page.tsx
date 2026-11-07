'use client';

import React, { useState, useEffect, useRef } from 'react';

type RoleType = 'admin' | 'coach' | 'scout' | 'player';

interface RoleConfig {
  id: RoleType;
  label: string;
  title: string;
  subtitle: string;
  usernameLabel: string;
  usernamePlaceholder: string;
  testUser: string;
  testPass: string;
}

const ROLES: RoleConfig[] = [
  {
    id: 'admin',
    label: 'Admin',
    title: 'Admin Sign In',
    subtitle: 'Full control and setup',
    usernameLabel: 'Username or Email',
    usernamePlaceholder: 'e.g. admin',
    testUser: 'admin',
    testPass: 'admin123',
  },
  {
    id: 'coach',
    label: 'Coach',
    title: 'Coach Sign In',
    subtitle: 'Sessions and matches',
    usernameLabel: 'Username or Email',
    usernamePlaceholder: 'e.g. coach',
    testUser: 'coach',
    testPass: 'coach123',
  },
  {
    id: 'scout',
    label: 'Scout',
    title: 'Scout Sign In',
    subtitle: 'Athlete scouting',
    usernameLabel: 'Username or Email',
    usernamePlaceholder: 'e.g. scout',
    testUser: 'scout',
    testPass: 'scout123',
  },
  {
    id: 'player',
    label: 'Player',
    title: 'Player Sign In',
    subtitle: 'Athlete portal',
    usernameLabel: 'Student ID or Email',
    usernamePlaceholder: 'e.g. md260001 or email',
    testUser: 'md260001',
    testPass: 'player123',
  },
];

export default function LoginPage() {
  const [selectedRole, setSelectedRole] = useState<RoleType>('coach');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

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

  const currentRoleConfig = ROLES.find((r) => r.id === selectedRole) || ROLES[1];

  function handleTabKeyDown(e: React.KeyboardEvent, index: number) {
    let nextIndex = index;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextIndex = (index + 1) % ROLES.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      nextIndex = (index - 1 + ROLES.length) % ROLES.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIndex = ROLES.length - 1;
    }

    if (nextIndex !== index) {
      const nextRole = ROLES[nextIndex].id;
      setSelectedRole(nextRole);
      setError(null);
      tabRefs.current[nextIndex]?.focus();
    }
  }

  function handleRoleSelect(role: RoleType) {
    setSelectedRole(role);
    setError(null);
  }

  function fillTestCredentials() {
    setUsername(currentRoleConfig.testUser);
    setPassword(currentRoleConfig.testPass);
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

      // Role check: do NOT store session if role does not match selected tab
      if (data.user?.role !== selectedRole) {
        try {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        } catch (_) {}
        setError('These credentials belong to a different role. Please choose the correct role tab.');
        return;
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
          {/* Role Selector Tabs at Top of Card */}
          <div
            role="tablist"
            aria-label="Select role"
            className="login-role-tabs"
          >
            {ROLES.map((role, idx) => {
              const isSelected = selectedRole === role.id;
              return (
                <button
                  key={role.id}
                  ref={(el) => { tabRefs.current[idx] = el; }}
                  id={`tab-${role.id}`}
                  role="tab"
                  type="button"
                  aria-selected={isSelected}
                  aria-controls={`panel-${role.id}`}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => handleRoleSelect(role.id)}
                  onKeyDown={(e) => handleTabKeyDown(e, idx)}
                  className={`login-role-tab${isSelected ? ' active' : ''}`}
                >
                  {role.label}
                </button>
              );
            })}
          </div>

          <div
            id={`panel-${currentRoleConfig.id}`}
            role="tabpanel"
            aria-labelledby={`tab-${currentRoleConfig.id}`}
          >
            <div className="login-card-header">
              <h1 className="login-title">
                {currentRoleConfig.title}
              </h1>
              <p className="login-subtitle">
                {currentRoleConfig.subtitle}
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
                  {currentRoleConfig.usernameLabel}
                </label>
                <input
                  id="login-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={currentRoleConfig.usernamePlaceholder}
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

            {/* Fill Test Credentials Link */}
            <div className="login-test-creds-container">
              <button
                type="button"
                onClick={fillTestCredentials}
                className="login-test-creds-btn"
              >
                Fill test credentials ({currentRoleConfig.testUser} / {currentRoleConfig.testPass})
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
