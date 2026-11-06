'use client';

import React, { useState, useEffect } from 'react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // If already authenticated, redirect to /app immediately without hydration mismatch
  useEffect(() => {
    try {
      const token = localStorage.getItem('token');
      const user = localStorage.getItem('user');
      if (token && user) {
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

      // Redirect to the SPA workspace
      window.location.href = '/app';
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check credentials.');
    } finally {
      setLoading(false);
    }
  }

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-slate-950 text-slate-400">
        <div className="flex items-center gap-2 text-sm">
          <span className="inline-block animate-spin text-emerald-500">⏳</span>
          Loading session...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex flex-col justify-between bg-slate-950 text-slate-100 relative overflow-x-hidden selection:bg-emerald-500/30 selection:text-emerald-300">
      {/* Ambient gradient glow in background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-emerald-600/10 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full bg-sky-600/10 blur-[120px]" />
      </div>

      {/* Top Header */}
      <header className="relative z-10 w-full px-6 py-4 flex items-center justify-between border-b border-slate-800/80 bg-slate-950/60 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 200 200"
            className="w-9 h-9 flex-shrink-0 transition-transform hover:scale-105 duration-300"
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
          <div>
            <span className="text-lg font-extrabold tracking-tight text-white flex items-baseline">
              Maidan <span className="text-emerald-400 font-bold ml-1">Desk</span>
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider block text-emerald-400">
              Dumka Sports OS
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Next.js Production
          </span>
        </div>
      </header>

      {/* Main Login Hero */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md p-8 sm:p-10 rounded-3xl bg-slate-900/80 backdrop-blur-xl border border-slate-800 shadow-2xl shadow-black/60">
          <div className="mb-6">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Sign In
            </h1>
            <p className="text-slate-400 text-xs sm:text-sm font-medium mt-1">
              Enter credentials or pick a demo role to access the workspace.
            </p>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="mb-5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 font-medium flex items-center gap-2">
              <span className="text-rose-400 font-bold">✕</span>
              <span>{error}</span>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="login-username"
                className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5"
              >
                Username or Email
              </label>
              <input
                id="login-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. coach, admin, md260001"
                className="w-full px-4 py-3 bg-slate-950/60 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                required
              />
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5"
              >
                Password
              </label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3 bg-slate-950/60 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 px-4 rounded-xl font-semibold text-sm text-white bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? (
                <>
                  <span className="inline-block animate-spin">⏳</span>
                  <span>Authenticating...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <span>→</span>
                </>
              )}
            </button>
          </form>

          {/* Quick-Fill Demo Roles */}
          <div className="mt-8 pt-6 border-t border-slate-800">
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 text-center mb-3">
              Quick Fill Demo Roles
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => fillDemo('admin', 'admin123')}
                className="p-2.5 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-700/60 text-left transition-all cursor-pointer group"
              >
                <div className="flex items-center justify-between text-xs font-bold text-white group-hover:text-emerald-400">
                  <span>Admin</span>
                  <span className="text-[10px] text-slate-400">admin</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                  Full control & setup
                </div>
              </button>

              <button
                type="button"
                onClick={() => fillDemo('coach', 'coach123')}
                className="p-2.5 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-700/60 text-left transition-all cursor-pointer group"
              >
                <div className="flex items-center justify-between text-xs font-bold text-white group-hover:text-emerald-400">
                  <span>Coach</span>
                  <span className="text-[10px] text-slate-400">coach</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                  Sessions & matches
                </div>
              </button>

              <button
                type="button"
                onClick={() => fillDemo('scout', 'scout123')}
                className="p-2.5 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-700/60 text-left transition-all cursor-pointer group"
              >
                <div className="flex items-center justify-between text-xs font-bold text-white group-hover:text-emerald-400">
                  <span>Scout</span>
                  <span className="text-[10px] text-slate-400">scout</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                  Athlete scouting
                </div>
              </button>

              <button
                type="button"
                onClick={() => fillDemo('md260001', 'player123')}
                className="p-2.5 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-700/60 text-left transition-all cursor-pointer group"
              >
                <div className="flex items-center justify-between text-xs font-bold text-white group-hover:text-emerald-400">
                  <span>Player</span>
                  <span className="text-[10px] text-slate-400">md260001</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                  Athlete portal
                </div>
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full py-4 text-center text-xs text-slate-400 border-t border-slate-800/60">
        Maidan Desk &bull; Dumka Sports Academy Management Platform
      </footer>
    </div>
  );
}
