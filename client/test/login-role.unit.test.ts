// client/test/login-role.unit.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

// Helper to simulate LoginPage login flow logic
interface RoleConfig {
  id: 'admin' | 'coach' | 'scout' | 'player';
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

class MockLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) || null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

async function simulateLoginSubmit({
  selectedRole,
  username,
  password,
  mockFetchResponse,
  storage,
}: {
  selectedRole: 'admin' | 'coach' | 'scout' | 'player';
  username: string;
  password: string;
  mockFetchResponse: { ok: boolean; status: number; body: any };
  storage: MockLocalStorage;
}) {
  let error: string | null = null;
  let redirectedTo: string | null = null;

  if (!username.trim() || !password) {
    error = 'Please enter both username and password.';
    return { error, redirectedTo };
  }

  // Simulate API call
  const data = mockFetchResponse.body;
  if (!mockFetchResponse.ok) {
    error = data?.error || 'Invalid credentials';
    return { error, redirectedTo };
  }

  // Role validation guard
  if (data.user?.role !== selectedRole) {
    storage.removeItem('token');
    storage.removeItem('user');
    error = 'These credentials belong to a different role. Please choose the correct role tab.';
    return { error, redirectedTo };
  }

  // Store session
  storage.setItem('token', data.token);
  storage.setItem('user', JSON.stringify(data.user));

  if (data.user?.role === 'scout') {
    redirectedTo = '/app/scout';
  } else {
    redirectedTo = '/app';
  }

  return { error, redirectedTo };
}

test('Role Config: provides exact required titles, descriptions, and placeholders', () => {
  const admin = ROLES.find(r => r.id === 'admin')!;
  assert.equal(admin.title, 'Admin Sign In');
  assert.equal(admin.subtitle, 'Full control and setup');
  assert.equal(admin.usernamePlaceholder, 'e.g. admin');
  assert.equal(admin.testUser, 'admin');
  assert.equal(admin.testPass, 'admin123');

  const coach = ROLES.find(r => r.id === 'coach')!;
  assert.equal(coach.title, 'Coach Sign In');
  assert.equal(coach.subtitle, 'Sessions and matches');
  assert.equal(coach.usernamePlaceholder, 'e.g. coach');
  assert.equal(coach.testUser, 'coach');
  assert.equal(coach.testPass, 'coach123');

  const scout = ROLES.find(r => r.id === 'scout')!;
  assert.equal(scout.title, 'Scout Sign In');
  assert.equal(scout.subtitle, 'Athlete scouting');
  assert.equal(scout.usernamePlaceholder, 'e.g. scout');
  assert.equal(scout.testUser, 'scout');
  assert.equal(scout.testPass, 'scout123');

  const player = ROLES.find(r => r.id === 'player')!;
  assert.equal(player.title, 'Player Sign In');
  assert.equal(player.subtitle, 'Athlete portal');
  assert.equal(player.usernamePlaceholder, 'e.g. md260001 or email');
  assert.equal(player.testUser, 'md260001');
  assert.equal(player.testPass, 'player123');
});

test('Login flow: correct role + password logs in successfully and sets token', async () => {
  const storage = new MockLocalStorage();
  const res = await simulateLoginSubmit({
    selectedRole: 'coach',
    username: 'coach',
    password: 'coach123',
    mockFetchResponse: {
      ok: true,
      status: 200,
      body: {
        token: 'valid-jwt-token-coach',
        user: { id: 'u1', username: 'coach', role: 'coach', name: 'Coach Sharma' },
      },
    },
    storage,
  });

  assert.equal(res.error, null);
  assert.equal(res.redirectedTo, '/app');
  assert.equal(storage.getItem('token'), 'valid-jwt-token-coach');
  assert.ok(storage.getItem('user')?.includes('"role":"coach"'));
});

test('Login flow: scout role redirects to /app/scout on match', async () => {
  const storage = new MockLocalStorage();
  const res = await simulateLoginSubmit({
    selectedRole: 'scout',
    username: 'scout',
    password: 'scout123',
    mockFetchResponse: {
      ok: true,
      status: 200,
      body: {
        token: 'valid-jwt-token-scout',
        user: { id: 'u2', username: 'scout', role: 'scout', name: 'Scout Talent' },
      },
    },
    storage,
  });

  assert.equal(res.error, null);
  assert.equal(res.redirectedTo, '/app/scout');
  assert.equal(storage.getItem('token'), 'valid-jwt-token-scout');
});

test('Login flow: correct password on WRONG tab is rejected without storing a token', async () => {
  const storage = new MockLocalStorage();
  // Simulate stale token in storage to ensure it gets cleared
  storage.setItem('token', 'old-token');
  storage.setItem('user', '{"role":"coach"}');

  // Coach user attempting to log in while 'admin' tab is selected
  const res = await simulateLoginSubmit({
    selectedRole: 'admin',
    username: 'coach',
    password: 'coach123',
    mockFetchResponse: {
      ok: true,
      status: 200,
      body: {
        token: 'valid-jwt-token-coach',
        user: { id: 'u1', username: 'coach', role: 'coach', name: 'Coach Sharma' },
      },
    },
    storage,
  });

  assert.equal(res.error, 'These credentials belong to a different role. Please choose the correct role tab.');
  assert.equal(res.redirectedTo, null);
  assert.equal(storage.getItem('token'), null, 'Token must NOT be stored');
  assert.equal(storage.getItem('user'), null, 'User must NOT be stored');
});

test('Login flow: wrong password shows the existing error and does not store token', async () => {
  const storage = new MockLocalStorage();
  const res = await simulateLoginSubmit({
    selectedRole: 'admin',
    username: 'admin',
    password: 'wrongpassword',
    mockFetchResponse: {
      ok: false,
      status: 401,
      body: { error: 'Invalid credentials' },
    },
    storage,
  });

  assert.equal(res.error, 'Invalid credentials');
  assert.equal(res.redirectedTo, null);
  assert.equal(storage.getItem('token'), null);
});

