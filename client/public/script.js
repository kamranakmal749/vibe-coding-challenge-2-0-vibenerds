// script.js - Full live integration with Maidan Desk REST API

// IST Date helper with zero host-local dependency
function getTodayIstString(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

if (typeof window !== 'undefined') {
    window.getTodayIstString = getTodayIstString;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getTodayIstString };
}

let currentUser = null;
let authToken = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;

// Helpers for API requests
async function api(path, options = {}) {
    options.headers = options.headers || {};
    if (authToken) {
        options.headers['Authorization'] = `Bearer ${authToken}`;
    }
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(options.body);
    }
    let res;
    try {
        res = await fetch(path, options);
    } catch (err) {
        throw new Error('Cannot reach the server. Check your connection and try again.');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
        if (res.status === 401) {
            if (data && (data.error === 'Account has been removed' || data.error === 'Player profile has been removed')) {
                showToast('Your account is no longer valid. Signing out...', 'error');
            } else if (authToken) {
                showToast('Session expired. Please sign in again.', 'info');
            }
            setTimeout(() => { logout(); }, 300);
        }
        if (res.status === 403 && data && data.mustChangePassword) {
            openMandatoryPasswordChangeModal();
            throw new Error(data.error || 'Password change required before accessing platform features.');
        }
        throw new Error((data && data.error) || `HTTP ${res.status}`);
    }
    return data;
}

function initIcons() {
    if (typeof lucide !== "undefined" && typeof lucide.createIcons === "function") {
        lucide.createIcons();
    }
}

// ── TOAST NOTIFICATIONS ──────────────────────────────────────────────────────
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let iconName = 'check-circle';
    if (type === 'error') iconName = 'alert-circle';
    if (type === 'warning') iconName = 'alert-triangle';
    if (type === 'info') iconName = 'info';

    toast.innerHTML = `
        <i data-lucide="${iconName}" class="w-4 h-4 flex-shrink-0"></i>
        <span>${message}</span>
    `;
    container.appendChild(toast);
    initIcons();

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px) scale(0.9)';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ── MODAL ENGINE ─────────────────────────────────────────────────────────────
function openModal(title, bodyHtml, footerButtons = [], customMaxWidth = 'max-w-xl') {
    const modal = document.getElementById('app-modal');
    const titleElem = document.getElementById('modal-title');
    const bodyElem = document.getElementById('modal-body');
    const footerElem = document.getElementById('modal-footer');

    if (!modal) return;
    const card = modal.querySelector('.glass-panel');
    if (card) {
        card.classList.remove('max-w-md', 'max-w-lg', 'max-w-xl', 'max-w-2xl', 'max-w-3xl', 'max-w-4xl');
        card.classList.add(customMaxWidth);
    }

    titleElem.innerText = title;
    bodyElem.innerHTML = bodyHtml;

    footerElem.innerHTML = footerButtons.map(btn => `
        <button ${btn.id ? `id="${btn.id}"` : ''} onclick="${btn.action}" class="${btn.class || 'px-5 py-2.5 rounded-xl text-sm font-bold'}">
            ${btn.label}
        </button>
    `).join('');

    modal.classList.remove('hidden');
    initIcons();
}

function closeModal() {
    const modal = document.getElementById('app-modal');
    if (modal) {
        modal.classList.add('hidden');
        const card = modal.querySelector('.glass-panel');
        if (card) {
            card.classList.remove('max-w-lg', 'max-w-xl', 'max-w-2xl', 'max-w-3xl');
            card.classList.add('max-w-md');
        }
    }
}

function applySavedTheme() {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const stored = localStorage.getItem('theme');
    if (stored === 'dark' || (!stored && prefersDark)) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
}

function toggleDarkMode() {
    document.documentElement.classList.toggle('dark');
    const isDark = document.documentElement.classList.contains('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

function toggleNotifications() {
    const panel = document.getElementById('notification-panel');
    if (panel) panel.classList.toggle('hidden');
}

document.addEventListener('click', function (event) {
    const panel = document.getElementById('notification-panel');
    const btn = event.target.closest('button[onclick="toggleNotifications()"]');
    if (!btn && panel && !panel.contains(event.target) && !panel.classList.contains('hidden')) {
        panel.classList.add('hidden');
    }
});

// Roles definition
const roles = {
    admin: [
        { id: 'admin-overview', name: 'Overview', icon: 'layout-dashboard' },
        { id: 'admin-players', name: 'Players', icon: 'users' },
        { id: 'admin-staff', name: 'Staff', icon: 'shield-check' },
        { id: 'admin-registration', name: 'Registration', icon: 'user-plus' },
        { id: 'admin-audit', name: 'Audit Log', icon: 'history' }
    ],
    coach: [
        { id: 'coach-overview', name: 'Command Center', icon: 'home' },
        { id: 'coach-players', name: 'Players Directory', icon: 'users' },
        { id: 'coach-sessions', name: 'Attendance Sessions', icon: 'check-square' },
        { id: 'coach-matches', name: 'Matches & Calendar', icon: 'swords' },
        { id: 'admin-registration', name: 'Add Player', icon: 'user-plus' }
    ],
    scout: [
        { id: 'scout', name: 'Ready Players', icon: 'target' }
    ],
    player: [
        { id: 'player-overview', name: 'My Dashboard', icon: 'layout-dashboard' },
        { id: 'player-profile', name: 'My Profile', icon: 'user' },
        { id: 'player-attendance', name: 'My Attendance', icon: 'check-square' },
        { id: 'player-matches', name: 'My Matches', icon: 'swords' }
    ]
};

// ── Real Form Login ──────────────────────────────────────────────────────────
async function handleFormLogin(e) {
    if (e) e.preventDefault();
    const emailInput = document.getElementById('login-email') || document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    const errorDiv = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit-btn');

    const email = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';

    if (!email || !password) return;

    if (errorDiv) errorDiv.classList.add('hidden');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Verifying with database...';
    }

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: email, username: email, email, password })
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Invalid credentials');
        }

        authToken = data.token;
        currentUser = data.user;
        localStorage.setItem('token', authToken);
        localStorage.setItem('user', JSON.stringify(currentUser));

        renderAppForUser(currentUser.role, currentUser);
        showToast(`Welcome back, ${currentUser.name}!`, 'success');

        if (currentUser.role === 'player' && currentUser.mustChangePassword) {
            openMandatoryPasswordChangeModal();
        }
    } catch (err) {
        if (errorDiv) {
            errorDiv.textContent = err.message || 'Login failed. Please check credentials.';
            errorDiv.classList.remove('hidden');
        }
        showToast(err.message || 'Login failed', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = 'Sign In';
        }
    }
}

// ── Render Views Based on Authenticated User ─────────────────────────────────
function renderAppForUser(role, userObj) {
    document.getElementById('view-login').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');

    const roleFormatted = role.charAt(0).toUpperCase() + role.slice(1);
    const roleElem = document.getElementById('user-role-display');
    const nameElem = document.getElementById('user-name-display');
    const avatarElem = document.getElementById('header-avatar');
    const avatarBadge = document.getElementById('header-avatar-badge');

    if (roleElem) {
        roleElem.innerText = role === 'coach' ? 'Coach Account' : `${roleFormatted} Account`;
    }
    if (nameElem) {
        nameElem.innerText = userObj && userObj.name ? userObj.name : (role === 'coach' ? 'Coach Sharma' : roleFormatted);
    }
    if (avatarBadge) {
        const displayName = (userObj && userObj.name) || (role === 'coach' ? 'Coach Sharma' : roleFormatted);
        const parts = displayName.trim().split(/\s+/);
        const initials = parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();
        avatarBadge.innerText = initials;
    }
    if (avatarElem) avatarElem.src = role === 'player' ? "https://i.pravatar.cc/150?img=3" : "https://i.pravatar.cc/150?img=11";

    const nav = document.getElementById('sidebar-nav');
    if (!nav) return;
    nav.innerHTML = '';

    const roleItems = roles[role] || [];
    roleItems.forEach((item, index) => {
        const btn = document.createElement('button');
        const activeClass = 'bg-brand-600 dark:bg-emerald-600 text-white shadow-md font-bold';
        const inactiveClass = 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-white font-medium';

        btn.type = 'button';
        btn.setAttribute('data-page-id', item.id);
        btn.className = `w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm transition-all overflow-hidden cursor-pointer ${index === 0 ? activeClass : inactiveClass}`;
        btn.innerHTML = `<i data-lucide="${item.icon}" class="w-4.5 h-4.5 flex-shrink-0 pointer-events-none"></i> <span class="truncate whitespace-nowrap text-left flex-1 pointer-events-none">${item.name}</span>`;

        btn.onclick = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            switchPage(item.id);
        };

        nav.appendChild(btn);
        if (index === 0) switchPage(item.id);
    });

    initIcons();
    loadRoleData(role);
    if (role === 'admin') loadRegistrationCoachOptions();
}

function toggleMobileSidebar(force) {
    const sidebar = document.getElementById('app-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (!sidebar) return;
    const isCurrentlyOpen = sidebar.classList.contains('mobile-open');
    const shouldOpen = typeof force === 'boolean' ? force : !isCurrentlyOpen;
    if (shouldOpen) {
        sidebar.classList.add('mobile-open');
        if (backdrop) backdrop.classList.remove('hidden');
    } else {
        sidebar.classList.remove('mobile-open');
        if (backdrop) backdrop.classList.add('hidden');
    }
}

let currentActivePageId = null;
let navTransitionSequence = 0;
let hasUnsavedRosterChanges = false;
let isSavingRosterAttendance = false;
let isNavigatingAfterSave = false;

window.addEventListener('beforeunload', (e) => {
    if (currentActivePageId === 'coach-session-roster' && activeRosterSession && !activeRosterSession.saved && !activeRosterSession.locked && !isNavigatingAfterSave) {
        e.preventDefault();
        e.returnValue = 'You have unsaved attendance changes. Are you sure you want to leave?';
        return 'You have unsaved attendance changes. Are you sure you want to leave?';
    }
});

async function switchPage(targetId) {
    // Accidental navigation guard: Prevent leaving attendance-taking screen with unsaved changes
    if (currentActivePageId === 'coach-session-roster' && targetId !== 'coach-session-roster' && activeRosterSession && !activeRosterSession.saved && !activeRosterSession.locked && !isNavigatingAfterSave) {
        const confirmLeave = window.confirm('You have unsaved attendance changes. Are you sure you want to leave without saving?');
        if (!confirmLeave) {
            return;
        }
    }

    // Increment transition sequence token to cancel in-flight stale operations
    const transitionToken = ++navTransitionSequence;
    currentActivePageId = targetId;

    // Close mobile drawer on navigation
    toggleMobileSidebar(false);

    // Synchronously highlight the corresponding sidebar navigation button
    const nav = document.getElementById('sidebar-nav');
    if (nav) {
        const activeClass = 'bg-brand-600 dark:bg-emerald-600 text-white shadow-md font-bold';
        const inactiveClass = 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-white font-medium';
        nav.querySelectorAll('button[data-page-id]').forEach(btn => {
            const pageId = btn.getAttribute('data-page-id');
            if (pageId === targetId) {
                btn.className = `w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm transition-all overflow-hidden cursor-pointer ${activeClass}`;
            } else {
                btn.className = `w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm transition-all overflow-hidden cursor-pointer ${inactiveClass}`;
            }
        });
    }

    // Immediately switch the visible DOM view container
    document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));

    const targetPage = document.getElementById(`view-${targetId}`);
    if (targetPage) {
        targetPage.classList.add('active');
    }

    const main = document.querySelector('main');
    if (main) main.scrollTop = 0;

    // Trigger page-specific data refreshes asynchronously, guarding against stale overwrites
    try {
        if (targetId === 'coach-overview') {
            startGreetingTimer();
            await loadCoachStats();
        } else {
            stopGreetingTimer();
        }
        if (targetId === 'admin-overview') await loadAdminOverview();
        if (targetId === 'admin-players') await loadAdminPlayers();
        if (targetId === 'admin-staff') await loadAdminStaff();
        if (targetId === 'admin-audit') await loadAdminAudit();
        if (targetId === 'coach-players') await loadCoachPlayers();
        if (targetId === 'coach-sessions') await loadSessions();
        if (targetId === 'coach-matches') await loadMatchData();
        if (targetId === 'scout') await loadScoutPlayers();
        if (targetId === 'player-overview' || targetId === 'player-profile') await loadPlayerData();
        if (targetId === 'player-attendance') await loadPlayerAttendancePage();
        if (targetId === 'player-matches') await loadPlayerMatches();
    } catch (err) {
        console.warn(`[Navigation] Error loading data for ${targetId}:`, err);
    }
}

function logout() {
    stopGreetingTimer();
    authToken = null;
    currentUser = null;
    try {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        sessionStorage.removeItem('maidan_auth_redirected');
    } catch (_) {}

    if (window.location.pathname !== '/') {
        window.location.replace('/');
    }
}

// ── REAL-TIME CROSS-TAB DATA SYNCHRONIZATION ──────────────────────────────
// Uses native BroadcastChannel with localStorage storage-event fallback.
// Synchronizes tabs within the same browser origin without external dependencies.
const SYNC_CHANNEL_NAME = 'maidandesk_realtime_sync';
const SYNC_STORAGE_KEY = 'maidandesk_last_sync_event';

let syncBroadcastChannel = null;
try {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        syncBroadcastChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
    }
} catch (e) {
    console.warn('[Sync] BroadcastChannel unavailable, using storage event fallback:', e);
}

// Track processed event IDs to prevent duplicate handling or loops
const processedEventIds = new Set();
const MAX_PROCESSED_HISTORY = 100;
let isLocalMutationInProgress = false;
let pendingSyncRefresh = false;

function endLocalMutation() {
    isLocalMutationInProgress = false;
    if (pendingSyncRefresh) {
        pendingSyncRefresh = false;
        if (currentUser && authToken) {
            loadRoleData(currentUser.role);
        }
    }
}

function generateEventId() {
    return 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function isEventAlreadyProcessed(eventId) {
    if (!eventId) return true;
    if (processedEventIds.has(eventId)) return true;
    processedEventIds.add(eventId);
    if (processedEventIds.size > MAX_PROCESSED_HISTORY) {
        const oldest = processedEventIds.values().next().value;
        processedEventIds.delete(oldest);
    }
    return false;
}

/**
 * Broadcasts a lightweight mutation event across tabs on the same origin.
 * MUST be invoked ONLY after backend confirms successful API mutation.
 * Never broadcasts sensitive personal data or auth tokens.
 */
function broadcastSyncEvent(entity, action, extra = {}) {
    const eventId = generateEventId();
    isEventAlreadyProcessed(eventId); // Mark as processed locally so local window ignores reflected storage events

    const payload = {
        eventId,
        entity,     // 'session' | 'attendance' | 'match' | 'player'
        action,     // 'created' | 'saved' | 'updated' | 'locked' | 'unlocked' | 'cancelled' | 'completed'
        entityId: extra.entityId ? String(extra.entityId) : null,
        timestamp: Date.now()
    };

    // 1. Primary: BroadcastChannel (Native, multi-tab)
    if (syncBroadcastChannel) {
        try {
            syncBroadcastChannel.postMessage(payload);
        } catch (e) {
            console.warn('[Sync] BroadcastChannel postMessage failed:', e);
        }
    }

    // 2. Fallback: localStorage storage event
    try {
        localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
        // Handled silently if storage is restricted
    }
}

/**
 * Receives incoming sync events from other tabs and updates relevant views.
 * Strictly read-only: never calls broadcastSyncEvent to prevent infinite event loops.
 */
async function handleIncomingSyncEvent(payload) {
    if (!payload || !payload.eventId) return;

    // Deduplication check
    if (isEventAlreadyProcessed(payload.eventId)) {
        return;
    }

    // Do not clobber if this tab is in the middle of executing its own mutation
    if (isLocalMutationInProgress) {
        pendingSyncRefresh = true;
        return;
    }

    // Only update if user is authenticated
    if (!currentUser || !authToken) {
        return;
    }

    const role = currentUser.role;
    const { entity, action, entityId } = payload;

    try {
        if (role === 'coach') {
            const activePage = document.querySelector('.page.active')?.id;
            // Prevent clobbering active roster attendance marking
            if (activePage === 'view-coach-session-roster') {
                return;
            }

            // Do not disrupt user input while typing inside search box, any form inputs, or while a modal is open
            const isModalOpen = Boolean(document.getElementById('app-modal') && !document.getElementById('app-modal').classList.contains('hidden'));
            const activeEl = document.activeElement;
            const isTyping = activeEl && (
                activeEl.id === 'header-global-search' ||
                activeEl.tagName === 'INPUT' ||
                activeEl.tagName === 'TEXTAREA' ||
                activeEl.isContentEditable
            );

            if (isTyping || isModalOpen) {
                // Refresh cached players silently in background without re-rendering DOM table
                try {
                    const freshPlayers = await api('/api/players');
                    if (freshPlayers) cachedPlayers = freshPlayers;
                } catch (_) {}
                return;
            }

            // Selectively refresh the currently active view and dashboard aggregates
            const refreshPromises = [loadCoachStats()];
            if (activePage === 'view-coach-players') refreshPromises.push(loadCoachPlayers());
            if (activePage === 'view-coach-sessions') refreshPromises.push(loadSessions());
            if (activePage === 'view-coach-matches') refreshPromises.push(loadMatchData());

            await Promise.all(refreshPromises);

            // If coach is viewing details of this session, refresh details view
            if (activePage === 'view-coach-session-details' && activeDetailsSession) {
                if (!entityId || activeDetailsSession._id === entityId) {
                    await openSessionDetailsView(activeDetailsSession._id);
                }
            }
        } else if (role === 'player') {
            // Immediate account revocation check for deleted player
            if (entity === 'player' && action === 'deleted') {
                const myPlayerId = currentUser?.playerId || currentUser?.player?._id || (typeof currentUser?.player === 'string' ? currentUser.player : null);
                if (myPlayerId && String(myPlayerId) === String(entityId)) {
                    showToast('Your player profile has been permanently removed by an administrator.', 'error');
                    logout();
                    return;
                }
            }

            await Promise.all([
                loadPlayerData(),
                loadPlayerAttendancePage(),
                loadPlayerMatches()
            ]);
        } else if (role === 'scout') {
            await loadScoutPlayers();
        } else if (role === 'admin') {
            await Promise.all([
                loadAdminOverview(),
                loadCoachPlayers()
            ]);
            cachedPlayers = await api('/api/players');
        }
    } catch (err) {
        console.warn('[Sync] Error refreshing views for incoming sync event:', err);
    }
}

// Attach primary listener
if (syncBroadcastChannel) {
    syncBroadcastChannel.onmessage = (event) => {
        handleIncomingSyncEvent(event.data);
    };
    syncBroadcastChannel.onmessageerror = (err) => {
        console.warn('[Sync] BroadcastChannel message error:', err);
    };
}

// Attach storage event listener as fallback
window.addEventListener('storage', (event) => {
    if (event.key === SYNC_STORAGE_KEY && event.newValue) {
        try {
            const data = JSON.parse(event.newValue);
            handleIncomingSyncEvent(data);
        } catch (e) {
            console.warn('[Sync] Storage event parse error:', e);
        }
    }
});

// Server-Sent Events (SSE) for Cross-Browser / Multi-Device Synchronization
let serverEventSource = null;
let lastKnownSyncVersion = 0;

function initServerSyncListener() {
    // SSE stream omitted in Next.js; synchronization relies on 4-second /api/sync/version polling below
}

// Heartbeat version polling fallback (every 4 seconds) to guarantee sync across isolated browser sessions/profiles
setInterval(async () => {
    if (!currentUser || !authToken || isLocalMutationInProgress) return;
    try {
        const res = await api('/api/sync/version');
        if (res && res.version && res.version > lastKnownSyncVersion) {
            lastKnownSyncVersion = res.version;
            await handleIncomingSyncEvent({
                eventId: 'poll_' + res.version,
                entity: 'all',
                action: 'updated',
                timestamp: res.version
            });
        }
    } catch (_) { }
}, 4000);

// Expose on window for programmatic verification and fallback toggling
window.maidanSync = {
    broadcast: broadcastSyncEvent,
    handle: handleIncomingSyncEvent,
    getChannel: () => syncBroadcastChannel,
    isProcessed: (id) => processedEventIds.has(id),
    setChannelEnabled: (enabled) => {
        if (!enabled && syncBroadcastChannel) {
            try { syncBroadcastChannel.close(); } catch (_) { }
            syncBroadcastChannel = null;
        } else if (enabled && !syncBroadcastChannel && typeof BroadcastChannel !== 'undefined') {
            try {
                syncBroadcastChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
                syncBroadcastChannel.onmessage = (e) => handleIncomingSyncEvent(e.data);
            } catch (_) { }
        }
    }
};

// ── LIVE DATA SYNC LOGIC ──────────────────────────────────────────────────────

async function loadRoleData(role) {
    if (role === 'admin') {
        loadAdminOverview();
    } else if (role === 'coach') {
        // Only load the initial overview page on login/role setup.
        // Other pages (Players Directory, Sessions, Matches) load on-demand when clicked.
        loadCoachStats();
    } else if (role === 'scout') {
        loadScoutPlayers();
    } else if (role === 'player') {
        loadPlayerData();
    }
}

// ── Dynamic Greeting Helper (Timezone: Asia/Kolkata) ─────────────────────────
let greetingIntervalTimer = null;

function getGreetingForTime(date = new Date()) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Kolkata',
            hour: 'numeric',
            minute: 'numeric',
            hour12: false
        }).formatToParts(date);
        const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
        const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
        const totalMinutes = hour * 60 + minute;

        // 5:00 AM – 11:59 AM: Good Morning
        // 12:00 PM – 4:59 PM: Good Afternoon
        // 5:00 PM – 8:59 PM: Good Evening
        // 9:00 PM – 4:59 AM: Good Night
        if (totalMinutes >= 5 * 60 && totalMinutes < 12 * 60) {
            return 'Good Morning';
        } else if (totalMinutes >= 12 * 60 && totalMinutes < 17 * 60) {
            return 'Good Afternoon';
        } else if (totalMinutes >= 17 * 60 && totalMinutes < 21 * 60) {
            return 'Good Evening';
        } else {
            return 'Good Night';
        }
    } catch (e) {
        return 'Good Morning';
    }
}

function updateCommandCenterGreeting() {
    const greetingTextElem = document.getElementById('coach-greeting-text');
    const greetingRoleElem = document.getElementById('coach-greeting-role');
    const heroDateElem = document.getElementById('coach-hero-date-display');

    if (greetingTextElem) {
        greetingTextElem.innerText = getGreetingForTime(new Date());
    }

    if (greetingRoleElem) {
        let displayRole = 'Coach!';
        if (currentUser && currentUser.role) {
            const r = currentUser.role.toLowerCase();
            if (r === 'coach') displayRole = 'Coach!';
            else if (r === 'admin') displayRole = 'Admin!';
            else if (r === 'scout') displayRole = 'Scout!';
            else if (r === 'player') displayRole = `${currentUser.name ? currentUser.name.split(' ')[0] : 'Player'}!`;
            else displayRole = `${r.charAt(0).toUpperCase() + r.slice(1)}!`;
        }
        greetingRoleElem.innerText = displayRole;
    }

    if (heroDateElem) {
        try {
            heroDateElem.innerText = new Date().toLocaleDateString('en-US', {
                timeZone: 'Asia/Kolkata',
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric'
            });
        } catch (e) {
            heroDateElem.innerText = new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric'
            });
        }
    }
}

function startGreetingTimer() {
    if (greetingIntervalTimer) {
        clearInterval(greetingIntervalTimer);
        greetingIntervalTimer = null;
    }
    // Update every 30 seconds so time period crossovers update without page refresh
    greetingIntervalTimer = setInterval(updateCommandCenterGreeting, 30000);
}

function stopGreetingTimer() {
    if (greetingIntervalTimer) {
        clearInterval(greetingIntervalTimer);
        greetingIntervalTimer = null;
    }
}

// ── Admin: Overview Aggregates ──
async function loadAdminOverview() {
    try {
        const [players, sessions, matches] = await Promise.all([
            api('/api/players'),
            api('/api/sessions'),
            api('/api/matches')
        ]);
        const readyCount = players.filter(p => p.isReady).length;

        const pElem = document.getElementById('admin-stat-players');
        const sElem = document.getElementById('admin-stat-sessions');
        const mElem = document.getElementById('admin-stat-matches');
        const rElem = document.getElementById('admin-stat-ready');

        if (pElem) pElem.innerText = players.length;
        if (sElem) sElem.innerText = sessions.filter(s => s.saved || s.locked).length;
        if (mElem) mElem.innerText = matches.length;
        if (rElem) rElem.innerText = readyCount;

        renderAdminOverviewBreakdowns(players);
    } catch (err) {
        console.error('Admin overview error:', err);
    }
}

function renderAdminOverviewBreakdowns(players) {
    const attContainer = document.getElementById('admin-attendance-by-sport');
    const readyContainer = document.getElementById('admin-ready-by-sport');
    if (!attContainer && !readyContainer) return;

    if (!players || players.length === 0) {
        if (attContainer) attContainer.innerHTML = '<p class="text-xs text-slate-400 py-3 text-center">No athletes enrolled</p>';
        if (readyContainer) readyContainer.innerHTML = '<p class="text-xs text-slate-400 py-3 text-center">No athletes enrolled</p>';
        return;
    }

    const sportsMap = {};
    players.forEach(p => {
        const sp = (p.sport || 'Unassigned').trim();
        if (!sportsMap[sp]) {
            sportsMap[sp] = { total: 0, ready: 0, sumAttendance: 0 };
        }
        sportsMap[sp].total++;
        if (p.isReady) sportsMap[sp].ready++;
        sportsMap[sp].sumAttendance += (typeof p.attendanceRate === 'number' ? p.attendanceRate : 0);
    });

    const sportNames = Object.keys(sportsMap).sort();

    if (attContainer) {
        attContainer.innerHTML = sportNames.map(sp => {
            const data = sportsMap[sp];
            const avg = Math.round(data.sumAttendance / data.total);
            const colorClass = avg >= 75 ? 'text-emerald-600 dark:text-emerald-400' : (avg >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400');
            const barClass = avg >= 75 ? 'bg-emerald-500' : (avg >= 50 ? 'bg-amber-500' : 'bg-rose-500');
            return `
                <div class="space-y-1.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800">
                    <div class="flex items-center justify-between text-xs">
                        <span class="font-bold text-slate-800 dark:text-slate-200">${escapeHtml(sp)}</span>
                        <span class="font-mono font-extrabold ${colorClass}">${avg}%</span>
                    </div>
                    <div class="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div class="h-full rounded-full ${barClass}" style="width: ${Math.min(100, Math.max(0, avg))}%"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    if (readyContainer) {
        readyContainer.innerHTML = sportNames.map(sp => {
            const data = sportsMap[sp];
            const pct = Math.round((data.ready / data.total) * 100);
            return `
                <div class="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800">
                    <div>
                        <span class="font-bold text-xs text-slate-800 dark:text-slate-200 block">${escapeHtml(sp)}</span>
                        <span class="text-[11px] text-slate-400">${data.ready} of ${data.total} athletes ready</span>
                    </div>
                    <span class="px-2.5 py-1 rounded-full text-xs font-bold ${data.ready > 0 ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' : 'bg-slate-200 dark:bg-slate-700 text-slate-500'}">
                        ${pct}% Trial Ready
                    </span>
                </div>
            `;
        }).join('');
    }
}

// ── Admin: Staff Management (Coaches & Scouts) ──────────────────────────────
let cachedStaff = [];

async function loadAdminStaff() {
    const tableBody = document.getElementById('admin-staff-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = `
        <tr>
            <td colspan="7" class="py-10 text-center text-slate-400">
                <div class="inline-flex items-center gap-2">
                    <span class="inline-block animate-spin">⏳</span>
                    <span>Loading staff accounts...</span>
                </div>
            </td>
        </tr>
    `;

    try {
        const staff = await api('/api/admin/staff');
        cachedStaff = Array.isArray(staff) ? staff : [];
        renderAdminStaffTable(cachedStaff);
    } catch (err) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="py-8 text-center text-rose-500 font-semibold">
                    <div class="inline-flex items-center gap-2">
                        <i data-lucide="alert-circle" class="w-4 h-4"></i>
                        <span>Failed to load staff accounts: ${escapeHtml(err.message)}</span>
                    </div>
                </td>
            </tr>
        `;
        initIcons();
    }
}

function renderAdminStaffTable(staffList) {
    const tableBody = document.getElementById('admin-staff-table-body');
    if (!tableBody) return;

    if (!staffList || staffList.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="py-12 text-center text-slate-400">
                    <div class="flex flex-col items-center justify-center gap-2">
                        <i data-lucide="users" class="w-8 h-8 text-slate-500 stroke-1"></i>
                        <span class="font-medium text-slate-500">No coach or scout accounts found.</span>
                        <button type="button" onclick="openAddStaffModal()" class="mt-2 text-xs font-bold text-brand-600 dark:text-brand-400 hover:underline cursor-pointer">
                            + Add First Staff Member
                        </button>
                    </div>
                </td>
            </tr>
        `;
        initIcons();
        return;
    }

    tableBody.innerHTML = staffList.map((member, index) => {
        const isCoach = member.role === 'coach';
        const roleBadge = isCoach
            ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                 <i data-lucide="shield" class="w-3 h-3"></i> Coach
               </span>`
            : `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30">
                 <i data-lucide="target" class="w-3 h-3"></i> Scout
               </span>`;

        const createdDate = member.createdAt
            ? new Date(member.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
            : '—';

        const safeId = member._id || member.id;
        const safeName = (member.name || '').replace(/'/g, "\\'");
        const safeRole = member.role;
        const assignedPlayers = member.assignedPlayersCount || 0;

        return `
            <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                <td class="py-4 px-4 text-center font-mono text-xs text-slate-500 border-r border-slate-200 dark:border-slate-800">${index + 1}</td>
                <td class="py-4 px-6 border-r border-slate-200 dark:border-slate-800">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-xl ${isCoach ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'} border border-current/20 flex items-center justify-center font-bold text-xs uppercase shrink-0">
                            ${escapeHtml((member.name || 'S').slice(0, 2))}
                        </div>
                        <div>
                            <span class="font-bold text-sm text-slate-900 dark:text-white block">${escapeHtml(member.name)}</span>
                            ${isCoach ? `<span class="text-[11px] text-slate-400 block">${assignedPlayers} assigned athlete${assignedPlayers === 1 ? '' : 's'}</span>` : ''}
                        </div>
                    </div>
                </td>
                <td class="py-4 px-5 border-r border-slate-200 dark:border-slate-800">
                    <span class="font-mono text-xs font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/80 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700">
                        ${escapeHtml(member.username)}
                    </span>
                </td>
                <td class="py-4 px-4 text-center border-r border-slate-200 dark:border-slate-800">${roleBadge}</td>
                <td class="py-4 px-6 border-r border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                    ${member.email ? escapeHtml(member.email) : '<span class="text-slate-400 italic">None</span>'}
                </td>
                <td class="py-4 px-5 border-r border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-600 dark:text-slate-400">${createdDate}</td>
                <td class="py-4 px-4 text-center">
                    <div class="flex items-center justify-center gap-1.5">
                        <button type="button" onclick="openEditStaffModal('${safeId}')" class="p-2 rounded-xl text-slate-400 hover:text-brand-600 hover:bg-brand-500/10 dark:hover:bg-brand-500/20 transition-all cursor-pointer inline-flex items-center justify-center" title="Edit ${safeName}">
                            <i data-lucide="edit-3" class="w-4 h-4 text-brand-500 hover:text-brand-600"></i>
                        </button>
                        <button type="button" onclick="openResetStaffPasswordModal('${safeId}')" class="p-2 rounded-xl text-slate-400 hover:text-amber-600 hover:bg-amber-500/10 dark:hover:bg-amber-500/20 transition-all cursor-pointer inline-flex items-center justify-center" title="Reset password for ${safeName}">
                            <i data-lucide="key-round" class="w-4 h-4 text-amber-500 hover:text-amber-600"></i>
                        </button>
                        <button type="button" onclick="confirmDeleteStaff('${safeId}', '${safeName}', '${safeRole}')" class="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 dark:hover:bg-rose-500/20 transition-all cursor-pointer inline-flex items-center justify-center" title="Remove ${safeName}">
                            <i data-lucide="trash-2" class="w-4 h-4 text-rose-500 hover:text-rose-600"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    initIcons();
}

function openAddStaffModal() {
    const defaultPassword = generateRandomPasswordClient();
    const html = `
        <form id="add-staff-form" onsubmit="submitAddStaff(event)" class="space-y-4 py-1">
            <div>
                <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Role <span class="text-rose-500">*</span></label>
                <div class="grid grid-cols-2 gap-3">
                    <label class="flex items-center gap-2 p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 cursor-pointer hover:border-brand-500">
                        <input type="radio" name="staff-role" value="coach" checked class="text-brand-600 focus:ring-brand-500">
                        <div>
                            <span class="block text-xs font-bold text-slate-900 dark:text-white">Coach</span>
                            <span class="block text-[11px] text-slate-400">Sessions & Matches</span>
                        </div>
                    </label>
                    <label class="flex items-center gap-2 p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 cursor-pointer hover:border-brand-500">
                        <input type="radio" name="staff-role" value="scout" class="text-brand-600 focus:ring-brand-500">
                        <div>
                            <span class="block text-xs font-bold text-slate-900 dark:text-white">Scout</span>
                            <span class="block text-[11px] text-slate-400">Athlete Scouting</span>
                        </div>
                    </label>
                </div>
            </div>

            <div>
                <label for="staff-name-input" class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Full Name <span class="text-rose-500">*</span></label>
                <input id="staff-name-input" type="text" required placeholder="e.g. Rahul Sharma"
                    class="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500">
            </div>

            <div>
                <label for="staff-username-input" class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Username <span class="text-rose-500">*</span></label>
                <input id="staff-username-input" type="text" required minlength="3" maxlength="30" pattern="^[a-zA-Z0-9._]+$" placeholder="e.g. coach.rahul"
                    class="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500 font-mono">
                <p class="text-[11px] text-slate-400 mt-1">3–30 chars (lowercase letters, numbers, dot, underscore).</p>
            </div>

            <div>
                <label for="staff-email-input" class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Email <span class="text-slate-400 font-normal">(Optional)</span></label>
                <input id="staff-email-input" type="email" placeholder="staff@example.com"
                    class="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500">
            </div>

            <div>
                <div class="flex items-center justify-between mb-1">
                    <label for="staff-password-input" class="block text-xs font-bold text-slate-500 uppercase tracking-wider">Initial Password <span class="text-rose-500">*</span></label>
                    <button type="button" onclick="generateNewPasswordForInput('staff-password-input')" class="text-[11px] font-bold text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1 cursor-pointer">
                        <i data-lucide="refresh-cw" class="w-3 h-3"></i> Generate
                    </button>
                </div>
                <div class="relative">
                    <input id="staff-password-input" type="text" required minlength="8" value="${defaultPassword}"
                        class="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500 font-mono">
                </div>
                <p class="text-[11px] text-slate-400 mt-1">Minimum 8 characters. Staff will change this on first login.</p>
            </div>

            <div id="add-staff-error" class="hidden text-xs text-rose-500 font-semibold p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20"></div>

            <div class="pt-2 flex justify-end gap-2">
                <button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                    Cancel
                </button>
                <button type="submit" id="add-staff-submit-btn" class="px-5 py-2.5 rounded-xl text-xs font-bold bg-brand-600 hover:bg-brand-700 text-white shadow-md flex items-center gap-1.5 cursor-pointer">
                    <i data-lucide="user-plus" class="w-4 h-4"></i> Create Account
                </button>
            </div>
        </form>
    `;

    openModal('Add Academy Staff', html, [], 'max-w-lg');
    initIcons();
}

function generateRandomPasswordClient() {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const symbols = '!@#$%^&*';
    const pool = upper + lower + digits + symbols;
    let pwd = [
        upper[Math.floor(Math.random() * upper.length)],
        lower[Math.floor(Math.random() * lower.length)],
        digits[Math.floor(Math.random() * digits.length)],
        symbols[Math.floor(Math.random() * symbols.length)]
    ];
    for (let i = 4; i < 10; i++) {
        pwd.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    return pwd.sort(() => Math.random() - 0.5).join('');
}

function generateNewPasswordForInput(inputId) {
    const el = document.getElementById(inputId);
    if (el) el.value = generateRandomPasswordClient();
}

async function submitAddStaff(event) {
    event.preventDefault();
    const errorEl = document.getElementById('add-staff-error');
    const submitBtn = document.getElementById('add-staff-submit-btn');

    const roleEl = document.querySelector('input[name="staff-role"]:checked');
    const role = roleEl ? roleEl.value : 'coach';
    const name = document.getElementById('staff-name-input')?.value?.trim();
    const username = document.getElementById('staff-username-input')?.value?.trim().toLowerCase();
    const email = document.getElementById('staff-email-input')?.value?.trim();
    const password = document.getElementById('staff-password-input')?.value;

    if (errorEl) errorEl.classList.add('hidden');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Creating...';
    }

    try {
        const res = await api('/api/admin/staff', {
            method: 'POST',
            body: {
                role,
                name,
                username,
                email: email || undefined,
                password,
            }
        });

        closeModal();
        showToast(`${role === 'coach' ? 'Coach' : 'Scout'} account created successfully!`, 'success');
        await loadAdminStaff();

        showStaffCredentialsModal(res.user || { name, username, role }, res.generatedPassword || password);
    } catch (err) {
        if (errorEl) {
            errorEl.innerText = err.message || 'Failed to create staff account';
            errorEl.classList.remove('hidden');
        }
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i data-lucide="user-plus" class="w-4 h-4"></i> Create Account';
            initIcons();
        }
    }
}

function showStaffCredentialsModal(staff, password) {
    const isCoach = staff.role === 'coach';
    const html = `
        <div class="space-y-4 py-2">
            <div class="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs flex items-start gap-2.5">
                <i data-lucide="alert-triangle" class="w-4 h-4 shrink-0 mt-0.5"></i>
                <div class="leading-relaxed">
                    <strong class="font-bold">One-Time Credential View:</strong> Make sure to copy this temporary password now. For security, this password cannot be retrieved again after closing this window.
                </div>
            </div>

            <div class="p-4 rounded-2xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-3">
                <div class="flex items-center justify-between">
                    <span class="text-xs font-bold text-slate-500 uppercase">Staff Member</span>
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${isCoach ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-blue-500/15 text-blue-600 dark:text-blue-400'}">
                        ${isCoach ? 'Coach' : 'Scout'}
                    </span>
                </div>
                <div class="font-bold text-sm text-slate-900 dark:text-white">${escapeHtml(staff.name)}</div>

                <div class="pt-2 border-t border-slate-200 dark:border-slate-700/80">
                    <label class="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Username</label>
                    <div class="flex items-center gap-2">
                        <input id="staff-cred-username" type="text" readonly value="${escapeHtml(staff.username)}"
                            class="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 dark:text-white outline-none">
                        <button type="button" onclick="navigator.clipboard.writeText('${escapeHtml(staff.username)}'); showToast('Username copied!', 'info');"
                            class="px-3 py-2 rounded-xl text-xs font-bold bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-slate-200 shrink-0 cursor-pointer">
                            Copy
                        </button>
                    </div>
                </div>

                <div>
                    <label class="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Temporary Password</label>
                    <div class="flex items-center gap-2">
                        <input id="staff-cred-password" type="text" readonly value="${escapeHtml(password)}"
                            class="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-brand-600 dark:text-brand-400 outline-none">
                        <button type="button" onclick="navigator.clipboard.writeText('${escapeHtml(password)}'); showToast('Password copied!', 'info');"
                            class="px-3 py-2 rounded-xl text-xs font-bold bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 border border-brand-200 dark:border-brand-800 shrink-0 hover:bg-brand-100 cursor-pointer">
                            Copy
                        </button>
                    </div>
                </div>
            </div>

            <div class="pt-2 flex justify-between items-center gap-2">
                <button type="button" onclick="navigator.clipboard.writeText('Username: ${escapeHtml(staff.username)}\\nPassword: ${escapeHtml(password)}'); showToast('All credentials copied!', 'info');"
                    class="px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-300 cursor-pointer">
                    Copy All
                </button>
                <button type="button" onclick="closeModal()" class="px-6 py-2.5 rounded-xl text-xs font-bold bg-slate-900 dark:bg-brand-600 hover:opacity-90 text-white cursor-pointer">
                    Done
                </button>
            </div>
        </div>
    `;

    openModal('Account Credentials', html, [], 'max-w-md');
    initIcons();
}

function openEditStaffModal(staffId) {
    const member = cachedStaff.find(s => (s._id || s.id) === staffId);
    if (!member) {
        showToast('Staff member not found', 'error');
        return;
    }

    const html = `
        <form id="edit-staff-form" onsubmit="submitEditStaff('${staffId}', event)" class="space-y-4 py-1">
            <div class="flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <div>
                    <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Username</span>
                    <span class="font-mono font-bold text-xs text-slate-700 dark:text-slate-300">${escapeHtml(member.username)}</span>
                </div>
                <div>
                    <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Role</span>
                    <span class="text-xs font-bold uppercase ${member.role === 'coach' ? 'text-emerald-500' : 'text-blue-500'}">${member.role}</span>
                </div>
            </div>

            <div>
                <label for="edit-staff-name" class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Full Name <span class="text-rose-500">*</span></label>
                <input id="edit-staff-name" type="text" required value="${escapeHtml(member.name)}"
                    class="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500">
            </div>

            <div>
                <label for="edit-staff-email" class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Email</label>
                <input id="edit-staff-email" type="email" value="${escapeHtml(member.email || '')}" placeholder="staff@example.com"
                    class="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500">
            </div>

            <div id="edit-staff-error" class="hidden text-xs text-rose-500 font-semibold p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20"></div>

            <div class="pt-2 flex justify-end gap-2">
                <button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                    Cancel
                </button>
                <button type="submit" id="edit-staff-submit-btn" class="px-5 py-2.5 rounded-xl text-xs font-bold bg-brand-600 hover:bg-brand-700 text-white shadow-md flex items-center gap-1.5 cursor-pointer">
                    <i data-lucide="check" class="w-4 h-4"></i> Save Changes
                </button>
            </div>
        </form>
    `;

    openModal(`Edit Staff • ${member.name}`, html, [], 'max-w-md');
    initIcons();
}

async function submitEditStaff(staffId, event) {
    event.preventDefault();
    const errorEl = document.getElementById('edit-staff-error');
    const submitBtn = document.getElementById('edit-staff-submit-btn');

    const name = document.getElementById('edit-staff-name')?.value?.trim();
    const email = document.getElementById('edit-staff-email')?.value?.trim();

    if (errorEl) errorEl.classList.add('hidden');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Saving...';
    }

    try {
        await api(`/api/admin/staff/${staffId}`, {
            method: 'PATCH',
            body: { name, email: email || '' }
        });

        closeModal();
        showToast('Staff profile updated successfully!', 'success');
        await loadAdminStaff();
    } catch (err) {
        if (errorEl) {
            errorEl.innerText = err.message || 'Failed to update staff member';
            errorEl.classList.remove('hidden');
        }
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i data-lucide="check" class="w-4 h-4"></i> Save Changes';
            initIcons();
        }
    }
}

function openResetStaffPasswordModal(staffId) {
    const member = cachedStaff.find(s => (s._id || s.id) === staffId);
    if (!member) {
        showToast('Staff member not found', 'error');
        return;
    }

    const defaultPassword = generateRandomPasswordClient();
    const html = `
        <div class="space-y-4 py-1">
            <p class="text-xs text-slate-600 dark:text-slate-300">
                Reset password for <strong class="text-slate-900 dark:text-white">${escapeHtml(member.name)}</strong> (<code>${escapeHtml(member.username)}</code>).
                They will be prompted to set a permanent password upon first login.
            </p>

            <div>
                <div class="flex items-center justify-between mb-1">
                    <label for="reset-staff-password-input" class="block text-xs font-bold text-slate-500 uppercase tracking-wider">New Temporary Password</label>
                    <button type="button" onclick="generateNewPasswordForInput('reset-staff-password-input')" class="text-[11px] font-bold text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1 cursor-pointer">
                        <i data-lucide="refresh-cw" class="w-3 h-3"></i> Generate
                    </button>
                </div>
                <input id="reset-staff-password-input" type="text" required minlength="8" value="${defaultPassword}"
                    class="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500 font-mono">
                <p class="text-[11px] text-slate-400 mt-1">Minimum 8 characters.</p>
            </div>

            <div id="reset-staff-error" class="hidden text-xs text-rose-500 font-semibold p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20"></div>

            <div class="pt-2 flex justify-end gap-2">
                <button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                    Cancel
                </button>
                <button type="button" id="reset-staff-submit-btn" onclick="submitResetStaffPassword('${staffId}')" class="px-5 py-2.5 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-md flex items-center gap-1.5 cursor-pointer">
                    <i data-lucide="key-round" class="w-4 h-4"></i> Reset Password
                </button>
            </div>
        </div>
    `;

    openModal(`Reset Password • ${member.name}`, html, [], 'max-w-md');
    initIcons();
}

async function submitResetStaffPassword(staffId) {
    const errorEl = document.getElementById('reset-staff-error');
    const submitBtn = document.getElementById('reset-staff-submit-btn');
    const password = document.getElementById('reset-staff-password-input')?.value;

    if (!password || password.length < 8) {
        if (errorEl) {
            errorEl.innerText = 'Password must be at least 8 characters long';
            errorEl.classList.remove('hidden');
        }
        return;
    }

    if (errorEl) errorEl.classList.add('hidden');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Resetting...';
    }

    try {
        const res = await api(`/api/admin/staff/${staffId}`, {
            method: 'PATCH',
            body: { password }
        });

        closeModal();
        showToast('Password reset successfully!', 'success');
        await loadAdminStaff();

        showStaffCredentialsModal(res.user, res.generatedPassword || password);
    } catch (err) {
        if (errorEl) {
            errorEl.innerText = err.message || 'Failed to reset password';
            errorEl.classList.remove('hidden');
        }
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i data-lucide="key-round" class="w-4 h-4"></i> Reset Password';
            initIcons();
        }
    }
}

function confirmDeleteStaff(staffId, staffName, staffRole) {
    const member = cachedStaff.find(s => (s._id || s.id) === staffId);
    const assignedCount = member?.assignedPlayersCount || 0;
    const isCoach = staffRole === 'coach';

    // If coach has assigned players, offer reassignment in the dialog
    if (isCoach && assignedCount > 0) {
        const otherCoaches = cachedStaff.filter(s => s.role === 'coach' && (s._id || s.id) !== staffId);

        const coachOptions = otherCoaches.map(c => `
            <option value="${c._id || c.id}">${escapeHtml(c.name)} (${escapeHtml(c.username)})</option>
        `).join('');

        const html = `
            <div class="space-y-4 py-1">
                <div class="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-start gap-2">
                    <i data-lucide="alert-triangle" class="w-4 h-4 shrink-0 mt-0.5"></i>
                    <div>
                        Coach <strong>${escapeHtml(staffName)}</strong> currently has <strong>${assignedCount} active athlete(s)</strong> assigned.
                    </div>
                </div>

                ${otherCoaches.length > 0 ? `
                    <div>
                        <label for="delete-reassign-coach" class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                            Reassign Athletes To <span class="text-rose-500">*</span>
                        </label>
                        <select id="delete-reassign-coach" class="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer">
                            <option value="">Select Target Coach...</option>
                            ${coachOptions}
                        </select>
                        <p class="text-[11px] text-slate-400 mt-1">All ${assignedCount} player profiles will be transferred to this coach immediately.</p>
                    </div>
                ` : `
                    <p class="text-xs text-rose-500 font-semibold">
                        There are no other coaches in the academy to reassign players to. Please add another coach before removing this account.
                    </p>
                `}

                <div id="delete-staff-error" class="hidden text-xs text-rose-500 font-semibold p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20"></div>

                <div class="pt-2 flex justify-end gap-2">
                    <button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                        Cancel
                    </button>
                    ${otherCoaches.length > 0 ? `
                        <button type="button" id="confirm-delete-btn" onclick="executeDeleteStaffWithReassign('${staffId}')" class="px-5 py-2.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-md flex items-center gap-1.5 cursor-pointer">
                            <i data-lucide="user-x" class="w-4 h-4"></i> Reassign & Remove
                        </button>
                    ` : ''}
                </div>
            </div>
        `;

        openModal(`Remove Coach • ${staffName}`, html, [], 'max-w-md');
        initIcons();
        return;
    }

    // Direct deletion confirmation for Scouts or Coaches with 0 players
    const html = `
        <div class="space-y-4 py-1">
            <p class="text-xs text-slate-600 dark:text-slate-300">
                Are you sure you want to permanently delete the ${staffRole} account for <strong class="text-slate-900 dark:text-white">${escapeHtml(staffName)}</strong>? This action cannot be undone.
            </p>

            <div id="delete-staff-error" class="hidden text-xs text-rose-500 font-semibold p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20"></div>

            <div class="pt-2 flex justify-end gap-2">
                <button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                    Cancel
                </button>
                <button type="button" id="confirm-delete-btn" onclick="executeDeleteStaff('${staffId}')" class="px-5 py-2.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-md flex items-center gap-1.5 cursor-pointer">
                    <i data-lucide="trash-2" class="w-4 h-4"></i> Permanently Delete
                </button>
            </div>
        </div>
    `;

    openModal(`Remove Staff • ${staffName}`, html, [], 'max-w-md');
    initIcons();
}

async function executeDeleteStaff(staffId) {
    const errorEl = document.getElementById('delete-staff-error');
    const deleteBtn = document.getElementById('confirm-delete-btn');

    if (errorEl) errorEl.classList.add('hidden');
    if (deleteBtn) {
        deleteBtn.disabled = true;
        deleteBtn.innerText = 'Deleting...';
    }

    try {
        await api(`/api/admin/staff/${staffId}`, { method: 'DELETE' });
        closeModal();
        showToast('Staff member removed successfully!', 'success');
        await loadAdminStaff();
    } catch (err) {
        if (errorEl) {
            errorEl.innerText = err.message || 'Failed to remove staff member';
            errorEl.classList.remove('hidden');
        }
        if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i> Permanently Delete';
            initIcons();
        }
    }
}

async function executeDeleteStaffWithReassign(staffId) {
    const errorEl = document.getElementById('delete-staff-error');
    const deleteBtn = document.getElementById('confirm-delete-btn');
    const reassignSelect = document.getElementById('delete-reassign-coach');
    const reassignTo = reassignSelect?.value;

    if (!reassignTo) {
        if (errorEl) {
            errorEl.innerText = 'Please select a coach to reassign athletes to';
            errorEl.classList.remove('hidden');
        }
        return;
    }

    if (errorEl) errorEl.classList.add('hidden');
    if (deleteBtn) {
        deleteBtn.disabled = true;
        deleteBtn.innerText = 'Reassigning & Deleting...';
    }

    try {
        await api(`/api/admin/staff/${staffId}`, {
            method: 'DELETE',
            body: { reassignTo }
        });
        closeModal();
        showToast('Athletes reassigned and coach removed successfully!', 'success');
        await loadAdminStaff();
    } catch (err) {
        if (errorEl) {
            errorEl.innerText = err.message || 'Failed to remove coach';
            errorEl.classList.remove('hidden');
        }
        if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = '<i data-lucide="user-x" class="w-4 h-4"></i> Reassign & Remove';
            initIcons();
        }
    }
}

// ── Admin: Player Management ────────────────────────────────────────────────
let cachedAdminPlayers = [];
let cachedAdminCoaches = [];
let selectedAdminPlayerIds = new Set();
let adminPlayersFilterDebounceTimer = null;

async function loadAdminPlayers() {
    const tableBody = document.getElementById('admin-players-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = `
        <tr>
            <td colspan="10" class="py-10 text-center text-slate-400">
                <div class="inline-flex items-center gap-2">
                    <span class="inline-block animate-spin">⏳</span>
                    <span>Loading player directory...</span>
                </div>
            </td>
        </tr>
    `;

    try {
        const [players, coaches] = await Promise.all([
            api('/api/admin/players'),
            api('/api/auth/coaches').catch(() => [])
        ]);

        cachedAdminPlayers = Array.isArray(players) ? players : [];
        cachedAdminCoaches = Array.isArray(coaches) ? coaches : [];

        // Populate Coach Filter dropdown
        const coachFilter = document.getElementById('admin-players-coach-filter');
        if (coachFilter) {
            const currentVal = coachFilter.value;
            coachFilter.innerHTML = '<option value="all">All Coaches</option>' + cachedAdminCoaches.map(c => `
                <option value="${c._id || c.id}">${escapeHtml(c.name)}</option>
            `).join('');
            coachFilter.value = currentVal || 'all';
        }

        selectedAdminPlayerIds.clear();
        updateAdminPlayerSelectionUI();
        filterAdminPlayers();
    } catch (err) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="10" class="py-8 text-center text-rose-500 font-semibold">
                    <div class="inline-flex items-center gap-2">
                        <i data-lucide="alert-circle" class="w-4 h-4"></i>
                        <span>Failed to load players: ${escapeHtml(err.message)}</span>
                    </div>
                </td>
            </tr>
        `;
        initIcons();
    }
}

function debounceFilterAdminPlayers() {
    clearTimeout(adminPlayersFilterDebounceTimer);
    adminPlayersFilterDebounceTimer = setTimeout(() => {
        filterAdminPlayers();
    }, 250);
}

function filterAdminPlayers() {
    const searchInput = document.getElementById('admin-players-search');
    const sportFilter = document.getElementById('admin-players-sport-filter');
    const coachFilter = document.getElementById('admin-players-coach-filter');

    const searchVal = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const sportVal = sportFilter ? sportFilter.value : 'all';
    const coachVal = coachFilter ? coachFilter.value : 'all';

    let filtered = cachedAdminPlayers;

    if (sportVal && sportVal !== 'all') {
        filtered = filtered.filter(p => (p.sport || '').toLowerCase() === sportVal.toLowerCase());
    }

    if (coachVal && coachVal !== 'all') {
        filtered = filtered.filter(p => {
            const cId = p.coach ? (p.coach.id || p.coach._id || p.coach) : '';
            return cId === coachVal;
        });
    }

    if (searchVal) {
        filtered = filtered.filter(p => {
            const name = (p.name || '').toLowerCase();
            const username = (p.username || '').toLowerCase();
            const playerId = (p.playerId || '').toLowerCase();
            const sport = (p.sport || '').toLowerCase();
            const coachName = (p.coach && p.coach.name ? p.coach.name : '').toLowerCase();
            return name.includes(searchVal) || username.includes(searchVal) || playerId.includes(searchVal) || sport.includes(searchVal) || coachName.includes(searchVal);
        });
    }

    renderAdminPlayersTable(filtered);
}

function renderAdminPlayersTable(players) {
    const tableBody = document.getElementById('admin-players-table-body');
    if (!tableBody) return;

    if (!players || players.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="10" class="py-12 text-center text-slate-400">
                    <div class="flex flex-col items-center justify-center gap-2">
                        <i data-lucide="users" class="w-8 h-8 text-slate-500 stroke-1"></i>
                        <span class="font-medium text-slate-500">No players match the current filters.</span>
                    </div>
                </td>
            </tr>
        `;
        initIcons();
        updateAdminPlayerSelectionUI();
        return;
    }

    tableBody.innerHTML = players.map(p => {
        const safeId = p._id || p.id;
        const safeName = (p.name || '').replace(/'/g, "\\'");
        const isChecked = selectedAdminPlayerIds.has(safeId);

        const isReady = !!p.isReady;
        const readinessBadge = isReady
            ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                 <i data-lucide="check-circle" class="w-3 h-3"></i> Ready
               </span>`
            : `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                 <i data-lucide="clock" class="w-3 h-3"></i> Not Ready
               </span>`;

        const att = typeof p.attendanceRate === 'number' ? p.attendanceRate : 0;
        const attColor = att >= 75 ? 'text-emerald-500' : (att >= 50 ? 'text-amber-500' : 'text-rose-500');

        const sport = p.sport || 'General';
        const coachName = p.coach ? (p.coach.name || 'Assigned Coach') : 'Unassigned';

        return `
            <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                <td class="py-4 px-4 text-center border-r border-slate-200 dark:border-slate-800">
                    <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleAdminPlayerSelect('${safeId}', this.checked)" class="rounded text-brand-600 focus:ring-brand-500 cursor-pointer">
                </td>
                <td class="py-4 px-5 border-r border-slate-200 dark:border-slate-800">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 flex items-center justify-center font-bold text-xs uppercase shrink-0">
                            ${escapeHtml((p.name || 'P').slice(0, 2))}
                        </div>
                        <div>
                            <span class="font-bold text-sm text-slate-900 dark:text-white block">${escapeHtml(p.name)}</span>
                            <span class="text-[11px] font-mono text-slate-400 block">${escapeHtml(p.playerId || p.username || '')}</span>
                        </div>
                    </div>
                </td>
                <td class="py-4 px-4 border-r border-slate-200 dark:border-slate-800">
                    <span class="font-mono text-xs font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/80 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700">
                        ${escapeHtml(p.username || p.playerId || '')}
                    </span>
                </td>
                <td class="py-4 px-4 text-center border-r border-slate-200 dark:border-slate-800">
                    <span class="inline-block px-2 py-0.5 rounded-md text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        ${escapeHtml(sport)}
                    </span>
                </td>
                <td class="py-4 px-3 text-center border-r border-slate-200 dark:border-slate-800 font-mono text-xs text-slate-700 dark:text-slate-300">
                    ${p.age || '—'}
                </td>
                <td class="py-4 px-5 border-r border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300">
                    ${escapeHtml(coachName)}
                </td>
                <td class="py-4 px-4 text-center border-r border-slate-200 dark:border-slate-800">
                    <span class="font-mono text-xs font-extrabold ${attColor}">
                        ${att}%
                    </span>
                </td>
                <td class="py-4 px-3 text-center border-r border-slate-200 dark:border-slate-800 font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
                    ${p.matchesPlayed || 0}
                </td>
                <td class="py-4 px-4 text-center border-r border-slate-200 dark:border-slate-800">
                    ${readinessBadge}
                </td>
                <td class="py-4 px-4 text-center">
                    <div class="flex items-center justify-center gap-1.5">
                        <button type="button" onclick="openEditAdminPlayerModal('${safeId}')" class="p-2 rounded-xl text-slate-400 hover:text-brand-600 hover:bg-brand-500/10 dark:hover:bg-brand-500/20 transition-all cursor-pointer inline-flex items-center justify-center" title="Edit ${safeName}">
                            <i data-lucide="edit-3" class="w-4 h-4 text-brand-500 hover:text-brand-600"></i>
                        </button>
                        <button type="button" onclick="openResetAdminPlayerPasswordModal('${safeId}')" class="p-2 rounded-xl text-slate-400 hover:text-amber-600 hover:bg-amber-500/10 dark:hover:bg-amber-500/20 transition-all cursor-pointer inline-flex items-center justify-center" title="Reset password for ${safeName}">
                            <i data-lucide="key-round" class="w-4 h-4 text-amber-500 hover:text-amber-600"></i>
                        </button>
                        <button type="button" onclick="confirmDeleteAdminPlayer('${safeId}', '${safeName}')" class="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 dark:hover:bg-rose-500/20 transition-all cursor-pointer inline-flex items-center justify-center" title="Remove ${safeName}">
                            <i data-lucide="trash-2" class="w-4 h-4 text-rose-500 hover:text-rose-600"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    initIcons();
    updateAdminPlayerSelectionUI();
}

function toggleAdminPlayerSelect(id, checked) {
    if (checked) {
        selectedAdminPlayerIds.add(id);
    } else {
        selectedAdminPlayerIds.delete(id);
    }
    updateAdminPlayerSelectionUI();
}

function toggleSelectAllAdminPlayers(checked) {
    const tableBody = document.getElementById('admin-players-table-body');
    if (!tableBody) return;

    const checkboxes = tableBody.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        cb.checked = checked;
    });

    if (checked) {
        cachedAdminPlayers.forEach(p => {
            const safeId = p._id || p.id;
            selectedAdminPlayerIds.add(safeId);
        });
    } else {
        selectedAdminPlayerIds.clear();
    }

    updateAdminPlayerSelectionUI();
}

function updateAdminPlayerSelectionUI() {
    const reassignBtn = document.getElementById('admin-players-reassign-btn');
    const selectAllCheckbox = document.getElementById('admin-players-select-all');

    const count = selectedAdminPlayerIds.size;
    if (reassignBtn) {
        if (count > 0) {
            reassignBtn.disabled = false;
            reassignBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            reassignBtn.classList.add('cursor-pointer');
            reassignBtn.innerHTML = `<i data-lucide="user-check" class="w-4 h-4"></i> <span>Reassign Coach (${count})</span>`;
        } else {
            reassignBtn.disabled = true;
            reassignBtn.classList.add('opacity-50', 'cursor-not-allowed');
            reassignBtn.classList.remove('cursor-pointer');
            reassignBtn.innerHTML = `<i data-lucide="user-check" class="w-4 h-4"></i> <span>Reassign Coach</span>`;
        }
        initIcons();
    }

    if (selectAllCheckbox) {
        const total = cachedAdminPlayers.length;
        selectAllCheckbox.checked = total > 0 && count === total;
        selectAllCheckbox.indeterminate = count > 0 && count < total;
    }
}

// ── Admin: Edit Player Modal ──
function openEditAdminPlayerModal(playerId) {
    const player = cachedAdminPlayers.find(p => (p._id || p.id) === playerId);
    if (!player) return;

    const coachId = player.coach ? (player.coach.id || player.coach._id || player.coach) : '';
    const coachOptions = cachedAdminCoaches.map(c => `
        <option value="${c._id || c.id}" ${c._id === coachId || c.id === coachId ? 'selected' : ''}>
            ${escapeHtml(c.name)} (${escapeHtml(c.username || 'coach')})
        </option>
    `).join('');

    const html = `
        <form id="admin-edit-player-form" onsubmit="submitEditAdminPlayer(event, '${playerId}')" class="space-y-4 py-1">
            <div>
                <label for="edit-player-name" class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Full Name <span class="text-rose-500">*</span></label>
                <input id="edit-player-name" type="text" required value="${escapeHtml(player.name || '')}"
                    class="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500">
            </div>

            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label for="edit-player-age" class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Age (5–50) <span class="text-rose-500">*</span></label>
                    <input id="edit-player-age" type="number" min="5" max="50" required value="${player.age || ''}"
                        class="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500">
                </div>
                <div>
                    <label for="edit-player-sport" class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Sport <span class="text-rose-500">*</span></label>
                    <select id="edit-player-sport" required
                        class="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer">
                        <option value="Football" ${(player.sport || '').toLowerCase() === 'football' ? 'selected' : ''}>Football</option>
                        <option value="Cricket" ${(player.sport || '').toLowerCase() === 'cricket' ? 'selected' : ''}>Cricket</option>
                        <option value="Basketball" ${(player.sport || '').toLowerCase() === 'basketball' ? 'selected' : ''}>Basketball</option>
                    </select>
                </div>
            </div>

            <div>
                <label for="edit-player-coach" class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Assigned Coach <span class="text-rose-500">*</span></label>
                <select id="edit-player-coach" required
                    class="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer">
                    ${coachOptions || '<option value="">No coaches available</option>'}
                </select>
            </div>

            <div>
                <label for="edit-player-part" class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Default Participation</label>
                <select id="edit-player-part"
                    class="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer">
                    <option value="both" ${player.defaultParticipation === 'both' ? 'selected' : ''}>Both (Practice & Matches)</option>
                    <option value="practice" ${player.defaultParticipation === 'practice' ? 'selected' : ''}>Practice Sessions Only</option>
                    <option value="match" ${player.defaultParticipation === 'match' ? 'selected' : ''}>Competitive Matches Only</option>
                </select>
            </div>

            <div id="admin-edit-player-error" class="hidden text-xs text-rose-500 font-semibold p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20"></div>

            <div class="pt-2 flex justify-end gap-2">
                <button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                    Cancel
                </button>
                <button type="submit" id="admin-edit-player-btn" class="px-5 py-2.5 rounded-xl text-xs font-bold bg-brand-600 hover:bg-brand-700 text-white shadow-md flex items-center gap-1.5 cursor-pointer">
                    <i data-lucide="check" class="w-4 h-4"></i> Save Changes
                </button>
            </div>
        </form>
    `;

    openModal(`Edit Player • ${player.name}`, html, [], 'max-w-lg');
    initIcons();
}

async function submitEditAdminPlayer(e, playerId) {
    if (e) e.preventDefault();
    const errorEl = document.getElementById('admin-edit-player-error');
    const submitBtn = document.getElementById('admin-edit-player-btn');

    const name = document.getElementById('edit-player-name')?.value.trim();
    const age = parseInt(document.getElementById('edit-player-age')?.value, 10);
    const sport = document.getElementById('edit-player-sport')?.value;
    const coach = document.getElementById('edit-player-coach')?.value;
    const defaultParticipation = document.getElementById('edit-player-part')?.value;

    if (errorEl) errorEl.classList.add('hidden');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Saving...';
    }

    try {
        await api(`/api/admin/players/${playerId}`, {
            method: 'PATCH',
            body: { name, age, sport, coach, defaultParticipation }
        });

        closeModal();
        showToast('Player profile updated successfully!', 'success');
        await loadAdminPlayers();
        await loadAdminOverview();
    } catch (err) {
        if (errorEl) {
            errorEl.innerText = err.message || 'Failed to update player';
            errorEl.classList.remove('hidden');
        }
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i data-lucide="check" class="w-4 h-4"></i> Save Changes';
            initIcons();
        }
    }
}

// ── Admin: Reset Player Password Modal ──
function openResetAdminPlayerPasswordModal(playerId) {
    const player = cachedAdminPlayers.find(p => (p._id || p.id) === playerId);
    if (!player) return;

    const defaultPassword = generateRandomPasswordClient();

    const html = `
        <form id="admin-reset-player-form" onsubmit="submitResetAdminPlayerPassword(event, '${playerId}')" class="space-y-4 py-1">
            <p class="text-xs text-slate-600 dark:text-slate-300">
                Generate a new password for <strong class="text-slate-900 dark:text-white">${escapeHtml(player.name)}</strong> (${escapeHtml(player.username || player.playerId)}). The athlete will be required to change it on their next login.
            </p>

            <div>
                <div class="flex items-center justify-between mb-1">
                    <label for="reset-player-password-input" class="block text-xs font-bold text-slate-500 uppercase tracking-wider">New Password <span class="text-rose-500">*</span></label>
                    <button type="button" onclick="generateNewPasswordForInput('reset-player-password-input')" class="text-[11px] font-bold text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1 cursor-pointer">
                        <i data-lucide="refresh-cw" class="w-3 h-3"></i> Generate
                    </button>
                </div>
                <input id="reset-player-password-input" type="text" required minlength="8" value="${defaultPassword}"
                    class="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500 font-mono">
                <p class="text-[11px] text-slate-400 mt-1">Minimum 8 characters.</p>
            </div>

            <div id="admin-reset-player-error" class="hidden text-xs text-rose-500 font-semibold p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20"></div>

            <div class="pt-2 flex justify-end gap-2">
                <button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                    Cancel
                </button>
                <button type="submit" id="admin-reset-player-btn" class="px-5 py-2.5 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-md flex items-center gap-1.5 cursor-pointer">
                    <i data-lucide="key" class="w-4 h-4"></i> Reset Password
                </button>
            </div>
        </form>
    `;

    openModal(`Reset Password • ${player.name}`, html, [], 'max-w-md');
    initIcons();
}

async function submitResetAdminPlayerPassword(e, playerId) {
    if (e) e.preventDefault();
    const errorEl = document.getElementById('admin-reset-player-error');
    const submitBtn = document.getElementById('admin-reset-player-btn');
    const password = document.getElementById('reset-player-password-input')?.value;

    if (errorEl) errorEl.classList.add('hidden');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Resetting...';
    }

    try {
        const res = await api(`/api/admin/players/${playerId}/reset-password`, {
            method: 'POST',
            body: { password }
        });

        closeModal();
        showToast('Password reset successfully!', 'success');

        // Show dedicated one-time credentials card
        showAdminPlayerCredentialsModal({
            name: cachedAdminPlayers.find(p => (p._id || p.id) === playerId)?.name || 'Athlete',
            username: res.username,
            password: res.password
        });
    } catch (err) {
        if (errorEl) {
            errorEl.innerText = err.message || 'Failed to reset password';
            errorEl.classList.remove('hidden');
        }
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i data-lucide="key" class="w-4 h-4"></i> Reset Password';
            initIcons();
        }
    }
}

function showAdminPlayerCredentialsModal(creds) {
    const credText = `Username: ${creds.username}\nTemporary Password: ${creds.password}`;

    const html = `
        <div class="space-y-4 py-1">
            <div class="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs flex items-start gap-2.5">
                <i data-lucide="alert-triangle" class="w-4 h-4 shrink-0 mt-0.5"></i>
                <div>
                    <strong>One-Time Presentation:</strong> This temporary password is shown once and cannot be recovered from the database. Please copy and provide it to the athlete now.
                </div>
            </div>

            <div class="p-4 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-3 font-mono text-xs">
                <div>
                    <span class="text-slate-400 block text-[10px] uppercase font-bold tracking-wider mb-0.5">Athlete</span>
                    <span class="font-bold text-sm text-slate-900 dark:text-white font-sans">${escapeHtml(creds.name)}</span>
                </div>
                <div>
                    <span class="text-slate-400 block text-[10px] uppercase font-bold tracking-wider mb-0.5">Username</span>
                    <span class="font-bold text-slate-800 dark:text-slate-200">${escapeHtml(creds.username)}</span>
                </div>
                <div>
                    <span class="text-slate-400 block text-[10px] uppercase font-bold tracking-wider mb-0.5">Temporary Password</span>
                    <span class="font-bold text-emerald-600 dark:text-emerald-400 text-sm select-all">${escapeHtml(creds.password)}</span>
                </div>
            </div>

            <div class="pt-2 flex justify-end gap-2">
                <button type="button" onclick="navigator.clipboard.writeText('${creds.password}').then(() => showToast('Password copied to clipboard!', 'success'))" class="px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer">
                    <i data-lucide="copy" class="w-3.5 h-3.5"></i> Copy Password
                </button>
                <button type="button" onclick="closeModal()" class="px-5 py-2.5 rounded-xl text-xs font-bold bg-brand-600 hover:bg-brand-700 text-white shadow-md cursor-pointer">
                    Done
                </button>
            </div>
        </div>
    `;

    openModal(`Credentials • ${creds.name}`, html, [], 'max-w-md');
    initIcons();
}

// ── Admin: Delete Player ──
function confirmDeleteAdminPlayer(playerId, playerName) {
    const html = `
        <div class="space-y-4 py-1">
            <div class="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-start gap-2.5">
                <i data-lucide="alert-triangle" class="w-5 h-5 shrink-0 mt-0.5"></i>
                <div>
                    <strong class="block mb-1">Permanent Cascade Deletion</strong>
                    Deleting <strong>${escapeHtml(playerName)}</strong> will permanently remove:
                    <ul class="list-disc list-inside mt-1.5 space-y-0.5 text-[11px]">
                        <li>The player profile document</li>
                        <li>Their user login account</li>
                        <li>Roster entries from draft / unsaved sessions</li>
                        <li>Selection from upcoming matches</li>
                    </ul>
                </div>
            </div>

            <p class="text-xs text-slate-600 dark:text-slate-300">
                Are you completely sure you want to proceed? This operation cannot be reversed.
            </p>

            <div id="admin-delete-player-error" class="hidden text-xs text-rose-500 font-semibold p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20"></div>

            <div class="pt-2 flex justify-end gap-2">
                <button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                    Cancel
                </button>
                <button type="button" id="admin-delete-player-btn" onclick="executeDeleteAdminPlayer('${playerId}')" class="px-5 py-2.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-md flex items-center gap-1.5 cursor-pointer">
                    <i data-lucide="trash-2" class="w-4 h-4"></i> Permanently Delete
                </button>
            </div>
        </div>
    `;

    openModal(`Delete Player • ${playerName}`, html, [], 'max-w-md');
    initIcons();
}

async function executeDeleteAdminPlayer(playerId) {
    const errorEl = document.getElementById('admin-delete-player-error');
    const deleteBtn = document.getElementById('admin-delete-player-btn');

    if (errorEl) errorEl.classList.add('hidden');
    if (deleteBtn) {
        deleteBtn.disabled = true;
        deleteBtn.innerText = 'Deleting...';
    }

    try {
        await api(`/api/admin/players/${playerId}`, {
            method: 'DELETE',
            body: { confirm: true }
        });

        selectedAdminPlayerIds.delete(playerId);
        closeModal();
        showToast('Player and user login account permanently removed.', 'success');
        await loadAdminPlayers();
        await loadAdminOverview();
    } catch (err) {
        if (errorEl) {
            errorEl.innerText = err.message || 'Failed to remove player';
            errorEl.classList.remove('hidden');
        }
        if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i> Permanently Delete';
            initIcons();
        }
    }
}

// ── Admin: Reassign Coach Bulk Action ──
function openReassignAdminPlayersModal() {
    const count = selectedAdminPlayerIds.size;
    if (count === 0) {
        showToast('Please select at least one player to reassign', 'warning');
        return;
    }

    const selectedPlayers = cachedAdminPlayers.filter(p => selectedAdminPlayerIds.has(p._id || p.id));
    const coachOptions = cachedAdminCoaches.map(c => `
        <option value="${c._id || c.id}">${escapeHtml(c.name)} (${escapeHtml(c.username || 'coach')})</option>
    `).join('');

    const html = `
        <form id="admin-reassign-form" onsubmit="submitReassignAdminPlayers(event)" class="space-y-4 py-1">
            <p class="text-xs text-slate-600 dark:text-slate-300">
                You are about to reassign <strong>${count} athlete${count === 1 ? '' : 's'}</strong> to a different coach:
            </p>

            <div class="max-h-36 overflow-y-auto p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-1">
                ${selectedPlayers.map(p => `
                    <div class="text-xs flex items-center justify-between text-slate-800 dark:text-slate-200">
                        <span class="font-medium">${escapeHtml(p.name)}</span>
                        <span class="text-slate-400 font-mono text-[11px]">${escapeHtml(p.sport || '')}</span>
                    </div>
                `).join('')}
            </div>

            <div>
                <label for="reassign-target-coach" class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Assign To Coach <span class="text-rose-500">*</span>
                </label>
                <select id="reassign-target-coach" required
                    class="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer">
                    ${coachOptions || '<option value="">No coaches available</option>'}
                </select>
            </div>

            <div id="admin-reassign-error" class="hidden text-xs text-rose-500 font-semibold p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20"></div>

            <div class="pt-2 flex justify-end gap-2">
                <button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                    Cancel
                </button>
                <button type="submit" id="admin-reassign-submit-btn" class="px-5 py-2.5 rounded-xl text-xs font-bold bg-brand-600 hover:bg-brand-700 text-white shadow-md flex items-center gap-1.5 cursor-pointer">
                    <i data-lucide="user-check" class="w-4 h-4"></i> Reassign Athletes
                </button>
            </div>
        </form>
    `;

    openModal(`Reassign Coach (${count} Athletes)`, html, [], 'max-w-md');
    initIcons();
}

async function submitReassignAdminPlayers(e) {
    if (e) e.preventDefault();
    const errorEl = document.getElementById('admin-reassign-error');
    const submitBtn = document.getElementById('admin-reassign-submit-btn');
    const coachId = document.getElementById('reassign-target-coach')?.value;

    if (!coachId) {
        if (errorEl) {
            errorEl.innerText = 'Please select a target coach';
            errorEl.classList.remove('hidden');
        }
        return;
    }

    if (errorEl) errorEl.classList.add('hidden');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Reassigning...';
    }

    try {
        const playerIds = Array.from(selectedAdminPlayerIds);
        const res = await api('/api/admin/players/reassign', {
            method: 'POST',
            body: { playerIds, coachId }
        });

        selectedAdminPlayerIds.clear();
        closeModal();
        showToast(res.message || 'Players reassigned successfully!', 'success');
        await loadAdminPlayers();
        await loadAdminOverview();
    } catch (err) {
        if (errorEl) {
            errorEl.innerText = err.message || 'Failed to reassign players';
            errorEl.classList.remove('hidden');
        }
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i data-lucide="user-check" class="w-4 h-4"></i> Reassign Athletes';
            initIcons();
        }
    }
}

// ── Admin: Export Players CSV ──
function exportAdminPlayersCsv() {
    const searchVal = document.getElementById('admin-players-search')?.value.trim() || '';
    const sportVal = document.getElementById('admin-players-sport-filter')?.value || 'all';
    const coachVal = document.getElementById('admin-players-coach-filter')?.value || 'all';

    let url = '/api/admin/export/players?format=csv';
    if (searchVal) url += `&search=${encodeURIComponent(searchVal)}`;
    if (sportVal && sportVal !== 'all') url += `&sport=${encodeURIComponent(sportVal)}`;
    if (coachVal && coachVal !== 'all') url += `&coach=${encodeURIComponent(coachVal)}`;

    fetch(url, {
        headers: {
            'Authorization': authToken ? `Bearer ${authToken}` : ''
        }
    })
    .then(res => {
        if (!res.ok) throw new Error('Failed to export CSV');
        return res.blob();
    })
    .then(blob => {
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = 'players-export.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(downloadUrl);
        showToast('CSV export downloaded successfully!', 'success');
    })
    .catch(err => {
        showToast(err.message || 'CSV export failed', 'error');
    });
}

// ── Admin: Audit Log Inspection ─────────────────────────────────────────────
let adminAuditCurrentPage = 1;
let adminAuditTotalPages = 1;

async function loadAdminAudit(page = 1) {
    const tableBody = document.getElementById('admin-audit-table-body');
    if (!tableBody) return;

    adminAuditCurrentPage = Math.max(1, page);

    tableBody.innerHTML = `
        <tr>
            <td colspan="5" class="py-10 text-center text-slate-400">
                <div class="inline-flex items-center gap-2">
                    <span class="inline-block animate-spin">⏳</span>
                    <span>Loading audit records...</span>
                </div>
            </td>
        </tr>
    `;

    try {
        const res = await api(`/api/admin/audit?page=${adminAuditCurrentPage}&limit=20`);
        const logs = res.logs || [];
        adminAuditTotalPages = res.totalPages || 1;

        renderAdminAuditTable(logs, adminAuditCurrentPage, adminAuditTotalPages, res.total || 0);
    } catch (err) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="py-8 text-center text-rose-500 font-semibold">
                    <div class="inline-flex items-center gap-2">
                        <i data-lucide="alert-circle" class="w-4 h-4"></i>
                        <span>Failed to load audit history: ${escapeHtml(err.message)}</span>
                    </div>
                </td>
            </tr>
        `;
        initIcons();
    }
}

function renderAdminAuditTable(logs, page, totalPages, total) {
    const tableBody = document.getElementById('admin-audit-table-body');
    const pageInfo = document.getElementById('admin-audit-page-info');
    const prevBtn = document.getElementById('admin-audit-prev-btn');
    const nextBtn = document.getElementById('admin-audit-next-btn');

    if (pageInfo) {
        pageInfo.innerText = total > 0
            ? `Page ${page} of ${totalPages} (${total} total event${total === 1 ? '' : 's'})`
            : 'No events logged';
    }

    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= totalPages;

    if (!tableBody) return;

    if (!logs || logs.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="py-12 text-center text-slate-400">
                    <div class="flex flex-col items-center justify-center gap-2">
                        <i data-lucide="history" class="w-8 h-8 text-slate-500 stroke-1"></i>
                        <span class="font-medium text-slate-500">No audit events recorded yet.</span>
                    </div>
                </td>
            </tr>
        `;
        initIcons();
        return;
    }

    tableBody.innerHTML = logs.map(l => {
        const timestamp = l.timestamp
            ? new Date(l.timestamp).toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
              })
            : '—';

        const actionColor = l.action.includes('delete')
            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30'
            : (l.action.includes('reset')
                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
                : (l.action.includes('create')
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                    : 'bg-brand-500/15 text-brand-600 dark:text-brand-400 border-brand-500/30'));

        const targetBadge = l.targetType === 'Staff'
            ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
            : 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20';

        // Format details into tags
        let detailsHtml = '';
        if (l.details && typeof l.details === 'object' && Object.keys(l.details).length > 0) {
            detailsHtml = Object.entries(l.details).map(([k, v]) => {
                const valStr = Array.isArray(v) ? `${v.length} items` : String(v);
                return `<span class="inline-block bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-[11px] font-mono border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"><strong>${escapeHtml(k)}:</strong> ${escapeHtml(valStr)}</span>`;
            }).join(' ');
        } else {
            detailsHtml = '<span class="text-slate-400 text-xs italic">—</span>';
        }

        return `
            <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                <td class="py-3.5 px-5 border-r border-slate-200 dark:border-slate-800 font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    ${escapeHtml(timestamp)}
                </td>
                <td class="py-3.5 px-5 border-r border-slate-200 dark:border-slate-800">
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-xs text-slate-900 dark:text-white">${escapeHtml(l.actorName || 'Admin')}</span>
                        <span class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">(${escapeHtml(l.actorRole || 'admin')})</span>
                    </div>
                </td>
                <td class="py-3.5 px-4 text-center border-r border-slate-200 dark:border-slate-800">
                    <span class="inline-block px-2.5 py-1 rounded-full text-xs font-mono font-bold border ${actionColor}">
                        ${escapeHtml(l.action)}
                    </span>
                </td>
                <td class="py-3.5 px-5 border-r border-slate-200 dark:border-slate-800">
                    <div class="flex items-center gap-2">
                        <span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${targetBadge}">
                            ${escapeHtml(l.targetType)}
                        </span>
                        <span class="font-semibold text-xs text-slate-800 dark:text-slate-200 truncate max-w-[150px]">
                            ${escapeHtml(l.targetName || '—')}
                        </span>
                    </div>
                </td>
                <td class="py-3.5 px-6">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        ${detailsHtml}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    initIcons();
}

function changeAdminAuditPage(delta) {
    const targetPage = adminAuditCurrentPage + delta;
    if (targetPage >= 1 && targetPage <= adminAuditTotalPages) {
        loadAdminAudit(targetPage);
    }
}

// ── Coach: Stats & Players ──
let activeTodaySessionId = null;

async function loadCoachStats() {
    try {
        const [players, sessions, matches] = await Promise.all([
            api('/api/players'),
            api('/api/sessions'),
            api('/api/matches')
        ]);
        const readyCount = players.filter(p => p.isReady).length;

        const pElem = document.getElementById('coach-stat-players');
        const sElem = document.getElementById('coach-stat-sessions');
        const mElem = document.getElementById('coach-stat-matches');
        const rElem = document.getElementById('coach-stat-ready');

        if (pElem) pElem.innerText = players.length;
        if (sElem) sElem.innerText = sessions.length;
        if (mElem) mElem.innerText = matches.length;
        if (rElem) rElem.innerText = readyCount;

        // Dynamic Hero Greeting & Date (Asia/Kolkata)
        updateCommandCenterGreeting();

        // 1. Action Required List
        renderDashboardActions(sessions, matches);

        // 2. Today's Training Section
        renderDashboardTodayTraining(sessions);

        // 3. Upcoming Matches Section
        renderDashboardUpcomingMatches(matches);

        // 4. Attendance Insights Bar Chart & Average
        renderDashboardAttendanceInsights(sessions);

        // 5. Recent Activity Feed
        renderDashboardRecentActivity(players, sessions, matches);

        initIcons();
    } catch (err) {
        console.error('Stats error:', err);
    }
}

function renderDashboardActions(sessions = [], matches = []) {
    const listElem = document.getElementById('dashboard-action-required-list');
    const countElem = document.getElementById('dashboard-action-count-text');
    if (!listElem) return;

    const actions = [];
    const now = new Date();

    // Check for draft / pending attendance sessions
    const pendingSessions = (sessions || []).filter(s => !s.saved && !s.locked);
    if (pendingSessions.length > 0) {
        actions.push({
            icon: 'clock',
            color: 'amber',
            title: 'Attendance pending',
            desc: `${pendingSessions.length} session${pendingSessions.length > 1 ? 's need' : ' needs'} attendance marking`,
            action: `openSessionRosterView('${pendingSessions[0]._id}')`
        });
    }

    // Check for matches played / completed without results/scores
    const pendingMatches = (matches || []).filter(m => {
        const mDate = new Date(m.date);
        return (mDate <= now || m.status === 'in_progress') && m.status !== 'completed' && m.status !== 'cancelled';
    });
    if (pendingMatches.length > 0) {
        actions.push({
            icon: 'trophy',
            color: 'blue',
            title: 'Match result pending',
            desc: `${pendingMatches.length} match${pendingMatches.length > 1 ? 'es need' : ' needs'} score entry`,
            action: `openManageMatchPlayersModal('${pendingMatches[0]._id || pendingMatches[0].id}')`
        });
    }

    if (countElem) {
        countElem.innerText = `${actions.length} item${actions.length !== 1 ? 's' : ''}`;
    }

    if (actions.length === 0) {
        listElem.innerHTML = `
            <div class="col-span-full py-4 flex items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
                <div class="w-8 h-8 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
                    <i data-lucide="check-circle-2" class="w-4.5 h-4.5"></i>
                </div>
                <p class="text-sm font-medium"><span class="font-bold text-slate-800 dark:text-slate-200">All caught up!</span> No pending attendance rolls or match results require attention.</p>
            </div>
        `;
        initIcons();
        return;
    }

    listElem.innerHTML = actions.map(item => {
        const colorClasses = {
            amber: 'bg-amber-500/15 text-amber-500 dark:text-amber-400 border border-amber-500/25',
            blue: 'bg-blue-500/15 text-blue-500 dark:text-blue-400 border border-blue-500/25',
            purple: 'bg-purple-500/15 text-purple-500 dark:text-purple-400 border border-purple-500/25',
            emerald: 'bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 border border-emerald-500/25'
        }[item.color] || 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25';

        return `
            <div class="p-4 rounded-xl bg-slate-100/90 dark:bg-[#1B2535] border border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3 cursor-pointer hover:border-emerald-500/50 hover:bg-slate-200/60 dark:hover:bg-[#202c3f] transition-all" onclick="${item.action}">
                <div class="flex items-center gap-3.5 min-w-0">
                    <div class="w-10 h-10 rounded-xl ${colorClasses} flex items-center justify-center flex-shrink-0">
                        <i data-lucide="${item.icon}" class="w-5 h-5"></i>
                    </div>
                    <div class="min-w-0">
                        <p class="text-sm font-bold text-slate-900 dark:text-white truncate">${escapeHtml(item.title)}</p>
                        <p class="text-xs text-slate-600 dark:text-slate-400 truncate mt-0.5 font-medium">${escapeHtml(item.desc)}</p>
                    </div>
                </div>
                <i data-lucide="chevron-right" class="w-4.5 h-4.5 text-slate-400 flex-shrink-0"></i>
            </div>
        `;
    }).join('');
    initIcons();
}

function renderDashboardTodayTraining(sessions = []) {
    const container = document.getElementById('coach-today-training-container');
    if (!container) return;

    // Strict Asia/Kolkata date matching
    const todayKolkata = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const todaySession = (sessions || []).find(s => {
        if (!s.date) return false;
        const sKolkata = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(s.date));
        return sKolkata === todayKolkata;
    });

    if (!todaySession) {
        activeTodaySessionId = null;
        container.innerHTML = `
            <div class="py-7 flex flex-col items-center justify-center text-center">
                <div class="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800/80 text-slate-400 flex items-center justify-center mb-3">
                    <i data-lucide="calendar-off" class="w-6 h-6"></i>
                </div>
                <h4 class="text-base font-bold text-slate-900 dark:text-white">No Training Scheduled Today</h4>
                <p class="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm">No attendance roll is scheduled for today. You can schedule a new training session anytime.</p>
                <button onclick="openCreateSessionModal()" class="mt-4 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs sm:text-sm flex items-center gap-2 cursor-pointer shadow-sm transition-colors">
                    <i data-lucide="plus" class="w-4 h-4"></i>
                    <span>Schedule Training</span>
                </button>
            </div>
        `;
        initIcons();
        return;
    }

    activeTodaySessionId = todaySession._id;

    const presentCount = todaySession.presentCount ?? (todaySession.attendance || []).filter(a => a.status === 'present').length;
    const totalCount = todaySession.totalCount ?? (todaySession.attendance || []).length;
    const absentCount = todaySession.absentCount ?? Math.max(0, totalCount - presentCount);
    const attPct = todaySession.attendanceRate ?? (totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0);
    const isSaved = !!(todaySession.saved || todaySession.locked);

    const timeRange = (todaySession.startTime && todaySession.endTime) 
        ? `${todaySession.startTime} - ${todaySession.endTime}` 
        : (todaySession.startTime || '09:00 AM - 10:30 AM');

    const formattedDate = new Date(todaySession.date).toLocaleDateString('en-US', {
        timeZone: 'Asia/Kolkata',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });

    const badgeClass = isSaved 
        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
        : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25';
    const badgeText = isSaved ? 'COMPLETED' : 'SCHEDULED';

    container.innerHTML = `
        <div class="flex items-start justify-between gap-4">
            <div>
                <h3 class="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white">${escapeHtml(todaySession.sport || 'Sports')} Training</h3>
                <div class="flex items-center flex-wrap gap-4 text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-2 font-medium">
                    <span class="flex items-center gap-1.5"><i data-lucide="clock" class="w-4 h-4 text-slate-500"></i> <span>${escapeHtml(timeRange)}</span></span>
                    <span class="flex items-center gap-1.5"><i data-lucide="users" class="w-4 h-4 text-slate-500"></i> <span>${totalCount} enrolled</span></span>
                    <span class="flex items-center gap-1.5"><i data-lucide="calendar" class="w-4 h-4 text-slate-500"></i> <span>${formattedDate}</span></span>
                </div>
            </div>
            <span class="px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider border ${badgeClass}">
                ${badgeText}
            </span>
        </div>

        <div class="mt-6 sm:mt-7">
            <div class="flex items-center justify-between mb-2.5">
                <div class="flex items-baseline gap-2">
                    <span class="text-2xl sm:text-3xl font-extrabold text-emerald-500 dark:text-emerald-400">${attPct}%</span>
                    <span class="text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-400">attendance</span>
                </div>
                <span class="text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-400">${presentCount} Present &bull; ${absentCount} Absent</span>
            </div>
            <!-- Attendance Green Progress Bar -->
            <div class="w-full bg-slate-200/90 dark:bg-[#1B2535] rounded-full h-3 overflow-hidden">
                <div class="bg-emerald-500 h-3 rounded-full transition-all duration-500" style="width: ${Math.min(100, Math.max(0, attPct))}%;"></div>
            </div>
        </div>

        <div class="mt-6 flex justify-end">
            <button onclick="openTodayRegisterModal()" class="text-sm font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1.5 cursor-pointer">
                <span>View Register</span>
                <span>&rarr;</span>
            </button>
        </div>
    `;
    initIcons();
}

function openTodayRegisterModal() {
    if (activeTodaySessionId) {
        const todaySession = (cachedSessions || []).find(s => s._id === activeTodaySessionId);
        if (todaySession && !todaySession.saved && !todaySession.locked) {
            openSessionRosterView(activeTodaySessionId);
        } else {
            openSessionDetailsView(activeTodaySessionId);
        }
    } else {
        openCreateSessionModal();
    }
}

function openTakeAttendanceAction() {
    if (activeTodaySessionId) {
        const todaySession = (cachedSessions || []).find(s => s._id === activeTodaySessionId);
        if (todaySession && !todaySession.saved) {
            openSessionRosterView(activeTodaySessionId);
        } else {
            openSessionDetailsView(activeTodaySessionId);
        }
    } else {
        openCreateSessionModal();
    }
}

function renderDashboardUpcomingMatches(matches = []) {
    const listElem = document.getElementById('dashboard-upcoming-matches-list');
    if (!listElem) return;

    // Filter real upcoming matches sorted by date ascending
    const now = new Date();
    const upcoming = (matches || [])
        .filter(m => {
            const mDate = new Date(m.date);
            return m.status === 'upcoming' || m.status === 'scheduled' || mDate >= now;
        })
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .slice(0, 2);

    if (upcoming.length === 0) {
        listElem.innerHTML = `
            <div class="py-6 flex flex-col items-center justify-center text-center">
                <div class="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800/80 text-slate-400 flex items-center justify-center mb-3">
                    <i data-lucide="trophy" class="w-6 h-6"></i>
                </div>
                <p class="text-sm font-bold text-slate-900 dark:text-white">No Upcoming Matches</p>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">No fixtures currently scheduled.</p>
                <button onclick="openAddMatchModal()" class="mt-3.5 px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-emerald-600 dark:text-emerald-400 font-bold text-xs flex items-center gap-1.5 cursor-pointer border border-slate-200 dark:border-slate-700 transition-colors">
                    <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                    <span>Schedule Match</span>
                </button>
            </div>
        `;
        initIcons();
        return;
    }

    listElem.innerHTML = upcoming.map(m => {
        const d = new Date(m.date);
        const dayNum = String(d.getDate()).padStart(2, '0');
        const monthStr = d.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', month: 'short' }).toUpperCase();
        const timeStr = m.time || '4:00 PM';
        const opponent = cleanOpponentName(m.opponent, m.sport);
        const title = cleanMatchTitle(m.title, m.sport);

        return `
            <div class="p-4 rounded-xl bg-slate-100/90 dark:bg-[#1B2535] border border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3 cursor-pointer hover:border-emerald-500/40 hover:bg-slate-200/50 dark:hover:bg-[#202c3f] transition-all" onclick="openManageMatchPlayersModal('${m._id || m.id}')">
                <div class="flex items-center gap-3.5 min-w-0">
                    <div class="px-3 py-2 rounded-xl bg-white dark:bg-[#151D2B] border border-slate-300/80 dark:border-slate-700 text-center min-w-[52px] shadow-xs flex-shrink-0">
                        <span class="block text-sm font-black text-slate-900 dark:text-white leading-tight">${dayNum}</span>
                        <span class="block text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase leading-tight tracking-wider">${monthStr}</span>
                    </div>
                    <div class="min-w-0">
                        <p class="text-sm font-bold text-slate-900 dark:text-white truncate">${escapeHtml(title)}</p>
                        <p class="text-xs text-slate-600 dark:text-slate-400 truncate mt-0.5 font-medium">vs ${escapeHtml(opponent)} &bull; ${escapeHtml(timeStr)}</p>
                    </div>
                </div>
                <span class="px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 bg-white/80 dark:bg-[#151D2B] border border-slate-200 dark:border-slate-800 flex-shrink-0">${escapeHtml(m.sport || 'Sports')}</span>
            </div>
        `;
    }).join('');
    initIcons();
}

function renderDashboardAttendanceInsights(sessions = []) {
    const barsElem = document.getElementById('dashboard-attendance-bars');
    const rateElem = document.getElementById('dashboard-insights-rate');
    if (!barsElem) return;

    // Calculate weekly average from saved/locked sessions
    const savedSessions = (sessions || []).filter(s => s.saved || s.locked);
    const rates = savedSessions.map(s => {
        const present = s.presentCount ?? (s.attendance || []).filter(a => a.status === 'present').length;
        const total = s.totalCount ?? (s.attendance || []).length;
        return total > 0 ? (present / total) * 100 : 0;
    });

    const avg = rates.length > 0 ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : (sessions.length > 0 ? 86 : 0);
    if (rateElem) rateElem.innerText = `${avg}%`;

    // Map sessions to Mon (0) to Sun (6) in Asia/Kolkata timezone
    const dayStats = Array.from({ length: 7 }, () => ({ totalRates: [], count: 0 }));
    const dayMap = { 'Mon': 0, 'Tue': 1, 'Wed': 2, 'Thu': 3, 'Fri': 4, 'Sat': 5, 'Sun': 6 };
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    savedSessions.forEach(s => {
        if (!s.date) return;
        const dStr = new Date(s.date).toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' });
        const idx = dayMap[dStr];
        if (idx !== undefined) {
            const present = s.presentCount ?? (s.attendance || []).filter(a => a.status === 'present').length;
            const total = s.totalCount ?? (s.attendance || []).length;
            const rate = total > 0 ? (present / total) * 100 : 0;
            dayStats[idx].totalRates.push(rate);
            dayStats[idx].count++;
        }
    });

    // Default aesthetic heights if very few sessions
    const fallbackHeights = [65, 80, 70, 85, 95, 90, 40];

    barsElem.innerHTML = dayStats.map((st, idx) => {
        let pct;
        let title;
        if (st.count > 0) {
            pct = Math.round(st.totalRates.reduce((a, b) => a + b, 0) / st.count);
            title = `${dayLabels[idx]}: ${pct}% attendance`;
        } else if (savedSessions.length === 0) {
            pct = fallbackHeights[idx];
            title = `${dayLabels[idx]}: ${pct}% attendance`;
        } else {
            pct = 12; // Muted off-day bar
            title = `${dayLabels[idx]}: Off day`;
        }

        const isOff = st.count === 0 && savedSessions.length > 0;
        const barClass = isOff 
            ? 'bg-slate-300 dark:bg-slate-700/60 hover:bg-slate-400 dark:hover:bg-slate-600'
            : 'bg-emerald-500 hover:bg-emerald-400';

        return `
            <div class="flex-1 flex flex-col justify-end items-center h-full group cursor-pointer" title="${title}">
                <div class="w-full max-w-[34px] ${barClass} rounded-t-lg transition-all duration-300" style="height: ${pct}%;"></div>
            </div>
        `;
    }).join('');
}

function formatDashboardRelativeTime(dateInput) {
    if (!dateInput) return 'Recently';
    const now = Date.now();
    const then = new Date(dateInput).getTime();
    if (isNaN(then)) return 'Recently';
    const diffMs = now - then;
    if (diffMs < 0) return 'Upcoming';
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay === 1) return 'Yesterday';
    if (diffDay < 7) return `${diffDay}d ago`;
    return new Date(dateInput).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function renderDashboardRecentActivity(players = [], sessions = [], matches = []) {
    const listElem = document.getElementById('dashboard-recent-activity-list');
    if (!listElem) return;

    const items = [];

    // Collect recent players
    (players || []).slice(-3).reverse().forEach(p => {
        items.push({
            icon: 'user-plus',
            title: 'New player registered',
            desc: `${p.name} added to ${p.sport || 'Sports'} squad`,
            date: p.createdAt || p.registeredOn || new Date(),
            action: `openPlayerAttendanceDetailModal('${p._id}')`
        });
    });

    // Collect recent sessions
    (sessions || []).slice(-3).reverse().forEach(s => {
        items.push({
            icon: 'calendar-check',
            title: s.saved ? 'Training completed' : 'Training scheduled',
            desc: `${s.sport || 'Sports'} attendance register`,
            date: s.savedAt || s.date || new Date(),
            action: `openSessionDetailsView('${s._id}')`
        });
    });

    // Collect recent matches
    (matches || []).slice(-3).reverse().forEach(m => {
        items.push({
            icon: 'trophy',
            title: m.status === 'completed' ? 'Match completed' : 'Match scheduled',
            desc: `${cleanMatchTitle(m.title, m.sport)} vs ${cleanOpponentName(m.opponent, m.sport)}`,
            date: m.date || m.createdAt || new Date(),
            action: `openManageMatchPlayersModal('${m._id || m.id}')`
        });
    });

    // Sort combined by date descending
    items.sort((a, b) => new Date(b.date) - new Date(a.date));
    const recent = items.slice(0, 3);

    if (recent.length === 0) {
        listElem.innerHTML = `
            <div class="py-6 flex flex-col items-center justify-center text-center">
                <div class="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mb-2">
                    <i data-lucide="clock" class="w-5 h-5"></i>
                </div>
                <p class="text-sm font-bold text-slate-800 dark:text-slate-200">No Recent Activity</p>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Events and updates will appear here.</p>
            </div>
        `;
        initIcons();
        return;
    }

    listElem.innerHTML = recent.map(item => `
        <div class="p-3.5 rounded-xl bg-slate-100/70 dark:bg-[#1B2535]/80 border border-slate-200/60 dark:border-slate-800 flex items-center justify-between gap-3 cursor-pointer hover:border-emerald-500/40 hover:bg-slate-200/50 dark:hover:bg-[#202c3f] transition-all" onclick="${item.action}">
            <div class="flex items-center gap-3.5 min-w-0">
                <div class="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 border border-emerald-500/25 flex items-center justify-center flex-shrink-0">
                    <i data-lucide="${item.icon}" class="w-4.5 h-4.5"></i>
                </div>
                <div class="min-w-0">
                    <p class="text-sm font-bold text-slate-900 dark:text-white truncate">${escapeHtml(item.title)}</p>
                    <p class="text-xs text-slate-600 dark:text-slate-400 truncate mt-0.5 font-medium">${escapeHtml(item.desc)}</p>
                </div>
            </div>
            <span class="text-xs font-semibold text-slate-400 whitespace-nowrap flex-shrink-0">${formatDashboardRelativeTime(item.date)}</span>
        </div>
    `).join('');
    initIcons();
}

// ── GLOBAL SEARCH STATE & FILTERING ENGINE ───────────────────────────────────
let currentSearchQuery = '';
let searchDebounceTimer = null;
let searchRequestCounter = 0;

/**
 * Pure filter function for players:
 * - Case-insensitive
 * - Trims whitespace
 * - Matches player name or username
 * - If query is empty / whitespace-only / null / undefined, returns all players untouched
 */
function filterPlayersByQuery(players, query) {
    if (!Array.isArray(players)) return [];
    const q = (query || '').trim().toLowerCase();
    if (!q) return [...players];
    return players.filter(p => {
        if (!p) return false;
        const name = (p.name || '').trim().toLowerCase();
        const username = (p.username || '').trim().toLowerCase();
        return name.includes(q) || username.includes(q);
    });
}

function clearGlobalSearch() {
    clearTimeout(searchDebounceTimer);
    searchRequestCounter++;
    currentSearchQuery = '';
    const searchInput = document.getElementById('header-global-search');
    if (searchInput) searchInput.value = '';

    if (cachedPlayers && cachedPlayers.length > 0) {
        renderCoachPlayersTable(cachedPlayers);
    } else {
        loadCoachPlayers().catch(() => {});
    }

    if (typeof filterSessionsTable === 'function') {
        const sessionPage = document.getElementById('view-coach-sessions');
        if (sessionPage && sessionPage.classList.contains('active')) {
            filterSessionsTable();
        }
    }
}

async function performGlobalSearch(query) {
    const trimmed = (query || '').trim();
    currentSearchQuery = trimmed;
    const reqId = ++searchRequestCounter;

    // Keep header search input in sync if called programmatically
    const searchInput = document.getElementById('header-global-search');
    if (searchInput && searchInput.value !== (query || '') && document.activeElement !== searchInput) {
        searchInput.value = query || '';
    }

    // Switch to coach-players if not already active
    const activePage = document.querySelector('.page.active')?.id;
    if (activePage !== 'view-coach-players' && currentActivePageId !== 'coach-players') {
        switchPage('coach-players');
    }

    // If data is already in memory, filter instantly with ZERO API calls
    if (cachedPlayers && cachedPlayers.length > 0) {
        const filtered = filterPlayersByQuery(cachedPlayers, currentSearchQuery);
        renderCoachPlayersTable(filtered);
        return;
    }

    // If cachedPlayers is not yet loaded, fetch once with request counter protection against stale responses
    try {
        const players = await api('/api/players');
        if (reqId !== searchRequestCounter) return; // Stale request discarded
        cachedPlayers = players || [];
        const filtered = filterPlayersByQuery(cachedPlayers, currentSearchQuery);
        renderCoachPlayersTable(filtered);
    } catch (err) {
        console.warn('[GlobalSearch] Error loading players for search:', err);
    }
}

function handleGlobalSearchInput(val) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        performGlobalSearch(val);
    }, 250);
}

function handleGlobalSearchKeyDown(e) {
    if (e.key === 'Escape') {
        e.preventDefault();
        clearGlobalSearch();
        const searchInput = document.getElementById('header-global-search');
        if (searchInput) searchInput.blur();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(searchDebounceTimer);
        const searchInput = document.getElementById('header-global-search');
        performGlobalSearch(searchInput ? searchInput.value : '');
    }
}

function searchGlobalAcademy(query) {
    clearTimeout(searchDebounceTimer);
    performGlobalSearch(query);
}

// Global search keyboard shortcut: Ctrl + K (Windows) / Cmd + K to focus search bar
window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        const searchInput = document.getElementById('header-global-search');
        if (!searchInput) return;

        // Do not intercept if app-shell is hidden (e.g. on login/landing screen)
        const appShell = document.getElementById('app-shell');
        if (appShell && appShell.classList.contains('hidden')) return;

        // Prevent triggering when the user is typing inside another input, textarea or editable field
        const target = e.target;
        const activeEl = document.activeElement;

        const isAnotherEditable = (el) => {
            if (!el || el === searchInput) return false;
            if (el.isContentEditable) return true;
            const tag = el.tagName ? el.tagName.toUpperCase() : '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
            if (el.getAttribute && el.getAttribute('contenteditable') === 'true') return true;
            if (el.closest) {
                const closest = el.closest('input, textarea, select, [contenteditable="true"]');
                if (closest && closest !== searchInput) return true;
            }
            return false;
        };

        if (isAnotherEditable(target) || isAnotherEditable(activeEl)) {
            return;
        }

        // Avoid conflicts with browser shortcuts (e.g. browser address bar search in Chrome/Edge)
        e.preventDefault();

        searchInput.focus();
        searchInput.select();
    }
});

// Render Coach Players Table helper
function renderCoachPlayersTable(players) {
    const tableBody = document.getElementById('coach-players-table-body');
    if (!tableBody) return;

    if (!players || !players.length) {
        const isSearch = Boolean(currentSearchQuery && currentSearchQuery.trim());
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="py-12 text-center text-slate-400">
                    <p class="font-semibold text-xs">${isSearch ? `No athletes found matching "${escapeHtml(currentSearchQuery.trim())}"` : 'No athletes registered yet'}</p>
                    ${isSearch ? `<button onclick="clearGlobalSearch()" class="mt-2 text-brand-600 dark:text-brand-400 font-bold hover:underline">Clear Search</button>` : `<button onclick="switchPage('admin-registration')" class="mt-2 text-brand-600 dark:text-brand-400 font-bold hover:underline">+ Register First Player</button>`}
                </td>
            </tr>
        `;
        initIcons();
        return;
    }

    tableBody.innerHTML = players.map((p, idx) => {
        const regDate = p.registeredOn ? new Date(p.registeredOn).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

        const attRate = p.attendanceRate || 0;
        const totalSessions = p.totalSessions || 0;
        const presentSessions = p.presentSessions || 0;
        const isAttGreen = totalSessions > 0 && (presentSessions * 4 >= totalSessions * 3);
        const attBarColor = isAttGreen ? 'bg-[#10B981]' : 'bg-[#F59E0B]';
        const attTextColor = isAttGreen ? 'text-emerald-600 dark:text-emerald-400 font-extrabold' : 'text-amber-600 dark:text-amber-400 font-extrabold';

        const matches = p.matchesPlayed ?? p.matchCount ?? 0;
        const totalSportMatches = p.totalSportMatches ?? 0;
        const matchPct = totalSportMatches > 0 ? Math.min(100, Math.round((matches / totalSportMatches) * 100)) : (matches > 0 ? 100 : 0);
        const isMatchGreen = (totalSportMatches > 0 && matches >= totalSportMatches) || matches >= 2;
        const matchBarColor = isMatchGreen ? 'bg-[#10B981]' : (matches > 0 ? 'bg-[#3B82F6]' : 'bg-[#F59E0B]');
        const matchTextColor = isMatchGreen ? 'text-emerald-600 dark:text-emerald-400 font-extrabold' : 'text-slate-800 dark:text-slate-200 font-extrabold';

        return `
            <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors border-b border-slate-200/80 dark:border-slate-800/80 cursor-pointer" onclick="openPlayerAttendanceDetailModal('${p._id}')" title="Click to view detailed attendance & match log">
                <!-- 1. S.No. -->
                <td class="py-4 px-4 text-center font-bold text-slate-400 text-sm border-r border-slate-200/80 dark:border-slate-800/80">
                    ${idx + 1}
                </td>

                <!-- 2. Name -->
                <td class="py-4 px-6 border-r border-slate-200/80 dark:border-slate-800/80">
                    <div class="flex items-center gap-3.5">
                        <div class="w-9 h-9 rounded-full bg-brand-500/15 text-brand-600 dark:text-brand-400 border border-brand-500/25 flex items-center justify-center font-bold text-sm shrink-0">
                            ${escapeHtml((p.name || '').trim().charAt(0).toUpperCase())}
                        </div>
                        <div>
                            <span class="font-bold text-slate-900 dark:text-white text-sm block">${escapeHtml(p.name)}</span>
                            <span class="text-xs text-slate-500 dark:text-slate-400 font-medium">Age ${escapeHtml(p.age)}</span>
                        </div>
                    </div>
                </td>

                <!-- 3. Sport -->
                <td class="py-4 px-5 border-r border-slate-200/80 dark:border-slate-800/80">
                    <span class="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        ${escapeHtml(p.sport)}
                    </span>
                </td>

                <!-- 4. Date of Registration -->
                <td class="py-4 px-5 border-r border-slate-200/80 dark:border-slate-800/80">
                    <span class="text-sm font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">${regDate}</span>
                </td>

                <!-- 5. Attendance (%) -->
                <td class="py-4 px-6 border-r border-slate-200/80 dark:border-slate-800/80">
                    <div class="w-full min-w-[150px]">
                        <div class="flex justify-between items-center mb-1.5 text-xs">
                            <span class="${attTextColor}">${attRate}%</span>
                        </div>
                        <div class="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                            <div class="h-full rounded-full transition-all duration-500 ${attBarColor}" style="width: ${Math.min(100, attRate)}%"></div>
                        </div>
                    </div>
                </td>

                <!-- 6. Matches Played -->
                <td class="py-4 px-6 border-r border-slate-200/80 dark:border-slate-800/80">
                    <div class="w-full min-w-[130px]">
                        <div class="flex justify-between items-center mb-1.5 text-xs">
                            <span class="${matchTextColor}">${matches} / ${totalSportMatches}</span>
                            <span class="text-xs text-slate-400 font-semibold">${totalSportMatches > 0 ? `${matchPct}%` : '0%'}</span>
                        </div>
                        <div class="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                            <div class="h-full rounded-full transition-all duration-500 ${matchBarColor}" style="width: ${matchPct}%"></div>
                        </div>
                    </div>
                </td>

                <!-- 7. Actions (Edit & Admin Remove) -->
                <td class="py-4 px-4 text-center" onclick="event.stopPropagation()">
                    <div class="flex items-center justify-center gap-1.5">
                        <button 
                            type="button" 
                            onclick="openEditPlayerModal('${p._id}')" 
                            class="p-2 rounded-xl text-slate-400 hover:text-brand-600 hover:bg-brand-500/10 dark:hover:bg-brand-500/20 transition-all cursor-pointer inline-flex items-center justify-center" 
                            title="Edit athlete ${escapeQuotes(p.name)}"
                        >
                            <i data-lucide="edit-3" class="w-4.5 h-4.5 text-brand-500 hover:text-brand-600"></i>
                        </button>
                        ${currentUser?.role === 'admin' ? `
                            <button 
                                type="button" 
                                onclick="confirmRemovePlayer('${p._id}', '${escapeQuotes(p.name)}')" 
                                class="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 dark:hover:bg-rose-500/20 transition-all cursor-pointer inline-flex items-center justify-center" 
                                title="Permanently remove ${escapeQuotes(p.name)}"
                            >
                                <i data-lucide="trash-2" class="w-4.5 h-4.5 text-rose-500 hover:text-rose-600"></i>
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    initIcons();
}

async function loadCoachPlayers() {
    const tableBody = document.getElementById('coach-players-table-body');
    const container = document.getElementById('coach-players-container');
    if (!tableBody && !container) return;

    // Fast render: If cachedPlayers are already available in memory, render immediately with 0 delay!
    if (cachedPlayers && cachedPlayers.length > 0) {
        renderCoachPlayersTable(filterPlayersByQuery(cachedPlayers, currentSearchQuery));
    } else if (tableBody) {
        tableBody.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-slate-400"><div class="flex items-center justify-center gap-2"><i data-lucide="loader-2" class="w-4 h-4 animate-spin text-brand-600"></i><span>Loading players from database...</span></div></td></tr>';
        initIcons();
    }

    try {
        const token = navTransitionSequence;
        const players = await api('/api/players');

        // Check if user has navigated away while fetch was in progress
        if (currentActivePageId && currentActivePageId !== 'coach-players') {
            cachedPlayers = players || [];
            return;
        }

        cachedPlayers = players || [];
        renderCoachPlayersTable(filterPlayersByQuery(cachedPlayers, currentSearchQuery));
    } catch (err) {
        if (tableBody && (!cachedPlayers || cachedPlayers.length === 0)) {
            tableBody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-rose-500">Error loading players: ${err.message}</td></tr>`;
        }
    }
}

// ── REMOVE PLAYER (ADMIN ACTION) ──────────────────────────────────────────────
function confirmRemovePlayer(playerId, playerName) {
    if (!playerId) return;
    const safeName = escapeHtml(playerName || 'this player');

    const html = `
        <div class="space-y-4 py-1">
            <div class="flex items-start gap-3 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-800 dark:text-rose-300">
                <i data-lucide="alert-triangle" class="w-5 h-5 text-rose-500 shrink-0 mt-0.5"></i>
                <div class="text-xs">
                    <p class="font-bold">Permanent Account & Profile Deletion</p>
                    <p class="text-slate-600 dark:text-slate-300 mt-1">
                        Are you sure you want to permanently remove <strong>${safeName}</strong>?
                    </p>
                </div>
            </div>
            <div class="text-xs text-slate-500 dark:text-slate-400 space-y-1.5">
                <p>&bull; The player profile and linked login account will be permanently destroyed.</p>
                <p>&bull; Existing sessions for this player will be immediately revoked.</p>
                <p>&bull; The player will be removed from upcoming match squads and draft rosters.</p>
                <p>&bull; Historical match fixtures, opponents, and scores remain safely preserved.</p>
                <p class="font-semibold text-rose-600 dark:text-rose-400 pt-1">This action cannot be undone.</p>
            </div>
        </div>
    `;

    openModal(
        'Confirm Player Removal',
        html,
        [
            { label: 'Cancel', class: 'px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer', action: 'closeModal()' },
            {
                label: 'Yes, Remove Player',
                class: 'px-5 py-2 rounded-xl text-sm font-bold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer shadow-xs transition-colors flex items-center gap-1.5',
                action: `executeRemovePlayer('${playerId}')`
            }
        ],
        'max-w-md'
    );
    initIcons();
}

async function executeRemovePlayer(playerId) {
    if (!playerId) return;
    try {
        isLocalMutationInProgress = true;
        closeModal();

        // 1. Instant optimistic update in memory & DOM (0ms delay)
        cachedPlayers = (cachedPlayers || []).filter(p => p._id !== playerId);
        renderCoachPlayersTable(filterPlayersByQuery(cachedPlayers, currentSearchQuery));

        const res = await api(`/api/players/${playerId}`, {
            method: 'DELETE'
        });

        showToast(res.message || 'Player permanently removed successfully.', 'success');

        // Automatically navigate back to Players Directory if in another view
        if (currentUser?.role === 'coach') {
            switchPage('coach-players');
        } else if (currentUser?.role === 'admin') {
            switchPage('admin-overview');
        }

        // 2. Silently refresh relevant views in background
        loadCoachPlayers().catch(() => {});
        loadCoachStats().catch(() => {});
        loadAdminOverview().catch(() => {});
        loadSessions().catch(() => {});

        // Broadcast to other open tabs
        broadcastSyncEvent('player', 'deleted', { entityId: playerId });
    } catch (err) {
        showToast(err.message || 'Failed to remove player', 'error');
        loadCoachPlayers();
    } finally {
        isLocalMutationInProgress = false;
    }
}

// ── EDIT PLAYER DETAILS ───────────────────────────────────────────────────────
async function openEditPlayerModal(playerId) {
    let player = cachedPlayers.find(p => p._id === playerId);
    if (!player) {
        try {
            player = await api(`/api/players/${playerId}`);
        } catch (_) { }
    }
    if (!player) {
        showToast('Player record not found', 'error');
        return;
    }

    const sports = ['Football', 'Cricket', 'Basketball', 'Badminton', 'Tennis', 'Athletics'];
    if (!sports.includes(player.sport)) {
        sports.push(player.sport);
    }

    const playerIdentifier = player.playerId || player.username || '—';

    const bodyHtml = `
        <form id="edit-player-form" onsubmit="event.preventDefault(); submitEditPlayer('${player._id}');" class="space-y-4 py-1">
            <div class="flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                <div>
                    <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Athlete ID</span>
                    <span class="font-mono font-bold text-xs text-brand-600 dark:text-brand-400">${playerIdentifier}</span>
                </div>
                <span class="text-[10px] px-2 py-0.5 rounded font-bold uppercase bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">Permanent Record</span>
            </div>

            <div>
                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Full Name *</label>
                <input 
                    id="edit-player-name" 
                    type="text" 
                    required 
                    value="${escapeQuotes(player.name)}" 
                    class="w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                >
            </div>

            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Age * (5-50)</label>
                    <input 
                        id="edit-player-age" 
                        type="number" 
                        min="5" 
                        max="50" 
                        required 
                        value="${player.age}" 
                        class="w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                    >
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Sport *</label>
                    <select 
                        id="edit-player-sport" 
                        class="w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                    >
                        ${sports.map(s => `<option value="${s}" ${s.toLowerCase() === (player.sport || '').toLowerCase() ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                </div>
            </div>

        </form>
    `;

    openModal(
        `Edit Athlete Profile • ${player.name}`,
        bodyHtml,
        [
            { label: 'Cancel', class: 'px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer', action: 'closeModal()' },
            { label: 'Save Changes', class: 'px-5 py-2 rounded-xl text-xs font-bold bg-brand-600 text-white hover:bg-brand-700 transition-colors shadow-xs cursor-pointer', action: `submitEditPlayer('${player._id}')` }
        ],
        'max-w-md'
    );
    initIcons();
}

async function submitEditPlayer(playerId) {
    const nameInput = document.getElementById('edit-player-name');
    const ageInput = document.getElementById('edit-player-age');
    const sportSelect = document.getElementById('edit-player-sport');

    const name = nameInput ? nameInput.value.trim() : '';
    const age = ageInput ? parseInt(ageInput.value, 10) : NaN;
    const sport = sportSelect ? sportSelect.value.trim() : '';

    if (!name) {
        showToast('Player name is required', 'error');
        return;
    }
    if (isNaN(age) || age < 5 || age > 50) {
        showToast('Age must be between 5 and 50', 'error');
        return;
    }
    if (!sport) {
        showToast('Sport is required', 'error');
        return;
    }

    try {
        isLocalMutationInProgress = true;
        const updated = await api(`/api/players/${playerId}`, {
            method: 'PATCH',
            body: { name, age, sport }
        });

        showToast(`Athlete "${updated.name}" updated successfully!`, 'success');
        closeModal();

        // If the updated player is the logged-in player, update header name immediately
        if (currentUser && currentUser.playerId && currentUser.playerId.toString() === playerId.toString()) {
            currentUser.name = updated.name;
            const nameElem = document.getElementById('user-name-display');
            if (nameElem) nameElem.innerText = updated.name;
        }

        // Instantly update cache and table in memory (0ms)
        const pIdx = (cachedPlayers || []).findIndex(p => p._id === playerId);
        if (pIdx !== -1) {
            cachedPlayers[pIdx] = Object.assign({}, cachedPlayers[pIdx], updated);
            renderCoachPlayersTable(filterPlayersByQuery(cachedPlayers, currentSearchQuery));
        }

        // Refresh dependent modules in background
        loadCoachPlayers().catch(() => {});
        loadCoachStats().catch(() => {});
        loadSessions().catch(() => {});
        loadMatchData().catch(() => {});

        // If active session details view is open, refresh it
        if (activeDetailsSession) {
            openSessionDetailsView(activeDetailsSession._id).catch(() => {});
        }

        // Broadcast to other open tabs and browser sessions
        broadcastSyncEvent('player', 'updated', { entityId: playerId });
    } catch (err) {
        showToast(err.message || 'Failed to update athlete', 'error');
    } finally {
        isLocalMutationInProgress = false;
    }
}

async function loadRegistrationCoachOptions() {
    const wrapper = document.getElementById('reg-player-coach-wrapper');
    const select = document.getElementById('reg-player-coach');
    if (!wrapper || !select) return;

    if (!currentUser || currentUser.role !== 'admin') {
        wrapper.classList.add('hidden');
        return;
    }

    wrapper.classList.remove('hidden');
    try {
        const coaches = await api('/api/auth/coaches');
        if (!coaches || !coaches.length) {
            select.innerHTML = '<option value="">No coach account found</option>';
            return;
        }
        select.innerHTML = coaches.map(c =>
            `<option value="${c._id}">${c.name} (@${c.username})</option>`
        ).join('');
        if (coaches.length === 1) select.value = coaches[0]._id;
    } catch (err) {
        select.innerHTML = '<option value="">Unable to load coaches</option>';
        console.error('Error loading coaches:', err);
    }
}

// ── Registration (Admin or Coach) ──
let activePlayerCredentials = null;

function copyCredentialField(elementId, label) {
    const el = document.getElementById(elementId);
    if (!el || !el.value) return;
    navigator.clipboard.writeText(el.value).then(() => {
        showToast(`${label} copied to clipboard!`, 'info');
    }).catch(() => {
        el.select();
        document.execCommand('copy');
        showToast(`${label} copied to clipboard!`, 'info');
    });
}

function copyAllCredentials() {
    if (!activePlayerCredentials) return;
    let text = `Maidan Desk - Athlete Credentials\nAthlete: ${activePlayerCredentials.name} (${activePlayerCredentials.sport})\nPlayer ID: ${activePlayerCredentials.playerId}\nUsername: ${activePlayerCredentials.username}`;
    if (activePlayerCredentials.temporaryPassword) {
        text += `\nTemporary Password: ${activePlayerCredentials.temporaryPassword}\n\n*Note: The player will be prompted to change this temporary password on their first login.`;
    }
    navigator.clipboard.writeText(text).then(() => {
        showToast('All credentials copied to clipboard!', 'success');
    }).catch(() => {
        showToast('Unable to access clipboard', 'error');
    });
}

function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    if (btn) {
        btn.innerHTML = `<i data-lucide="${isPassword ? 'eye-off' : 'eye'}" class="w-3.5 h-3.5"></i>`;
        initIcons();
    }
}

function openPlayerCredentialsModal(player, credentials) {
    const pId = player.playerId || player.username || credentials.username || '—';
    activePlayerCredentials = {
        name: player.name,
        sport: player.sport,
        playerId: pId,
        username: credentials?.username || player.username || pId,
        temporaryPassword: credentials?.temporaryPassword || null
    };

    const nameEl = document.getElementById('cred-player-name');
    const idEl = document.getElementById('cred-player-id');
    const userEl = document.getElementById('cred-username-input');
    const passEl = document.getElementById('cred-password-input');
    const passSection = document.getElementById('cred-password-section');
    const modal = document.getElementById('player-credentials-modal');

    if (nameEl) nameEl.textContent = `${player.name} (${player.sport})`;
    if (idEl) idEl.textContent = pId;
    if (userEl) userEl.value = activePlayerCredentials.username || '';
    if (passEl) {
        passEl.type = 'password';
        passEl.value = activePlayerCredentials.temporaryPassword || '';
    }
    if (passSection) {
        if (activePlayerCredentials.temporaryPassword) {
            passSection.classList.remove('hidden');
        } else {
            passSection.classList.add('hidden');
        }
    }

    if (modal) {
        modal.classList.remove('hidden');
        initIcons();
    }
}

function closePlayerCredentialsModal() {
    const modal = document.getElementById('player-credentials-modal');
    if (modal) modal.classList.add('hidden');

    // Wipe sensitive temporary password from memory and DOM immediately
    const passEl = document.getElementById('cred-password-input');
    if (passEl) passEl.value = '';
    const userEl = document.getElementById('cred-username-input');
    if (userEl) userEl.value = '';
    const idEl = document.getElementById('cred-player-id');
    if (idEl) idEl.textContent = '—';
    activePlayerCredentials = null;

    // Automatically navigate to Players Directory upon completing athlete registration
    if (currentUser?.role === 'coach') {
        switchPage('coach-players');
    } else if (currentUser?.role === 'admin') {
        switchPage('admin-overview');
    }
}

function openMandatoryPasswordChangeModal() {
    const modal = document.getElementById('mandatory-password-modal');
    const newPass = document.getElementById('new-permanent-password');
    const confPass = document.getElementById('confirm-permanent-password');
    const errDiv = document.getElementById('mandatory-password-error');

    if (newPass) newPass.value = '';
    if (confPass) confPass.value = '';
    if (errDiv) {
        errDiv.textContent = '';
        errDiv.classList.add('hidden');
    }

    if (modal) {
        modal.classList.remove('hidden');
        initIcons();
    }
}

async function handleMandatoryPasswordChange(e) {
    if (e) e.preventDefault();
    const newPass = (document.getElementById('new-permanent-password')?.value || '').trim();
    const confPass = (document.getElementById('confirm-permanent-password')?.value || '').trim();
    const errDiv = document.getElementById('mandatory-password-error');
    const submitBtn = document.getElementById('mandatory-password-submit-btn');

    if (!newPass || newPass.length < 6) {
        if (errDiv) {
            errDiv.textContent = 'Password must be at least 6 characters long.';
            errDiv.classList.remove('hidden');
        }
        return;
    }

    if (newPass !== confPass) {
        if (errDiv) {
            errDiv.textContent = 'Passwords do not match. Please re-enter.';
            errDiv.classList.remove('hidden');
        }
        return;
    }

    if (errDiv) errDiv.classList.add('hidden');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Updating password...';
    }

    try {
        const res = await api('/api/auth/change-password', {
            method: 'PATCH',
            body: { newPassword: newPass }
        });

        if (res.token) {
            authToken = res.token;
            localStorage.setItem('token', authToken);
        }
        if (currentUser) {
            currentUser.mustChangePassword = false;
            localStorage.setItem('user', JSON.stringify(currentUser));
        }

        const modal = document.getElementById('mandatory-password-modal');
        if (modal) modal.classList.add('hidden');

        const newPassEl = document.getElementById('new-permanent-password');
        const confPassEl = document.getElementById('confirm-permanent-password');
        if (newPassEl) newPassEl.value = '';
        if (confPassEl) confPassEl.value = '';

        showToast('Password updated successfully! Welcome to your dashboard.', 'success');
        loadRoleData('player');
    } catch (err) {
        if (errDiv) {
            errDiv.textContent = err.message || 'Failed to update password.';
            errDiv.classList.remove('hidden');
        }
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = 'Set Password & Continue';
        }
    }
}

async function handleRegisterPlayer(e) {
    e.preventDefault();

    // Elements
    const nameEl = document.getElementById('reg-player-name');
    const ageEl = document.getElementById('reg-player-age');
    const sportEl = document.getElementById('reg-player-sport');
    const coachSelect = document.getElementById('reg-player-coach');
    const msg = document.getElementById('reg-player-msg');
    const btn = document.getElementById('reg-player-btn');

    // Field-level error elements
    const errName = document.getElementById('reg-error-name');
    const errAge = document.getElementById('reg-error-age');
    const errSport = document.getElementById('reg-error-sport');
    const errCoach = document.getElementById('reg-error-coach');

    // Reset errors
    if (errName) { errName.textContent = ''; errName.classList.add('hidden'); }
    if (errAge) { errAge.textContent = ''; errAge.classList.add('hidden'); }
    if (errSport) { errSport.textContent = ''; errSport.classList.add('hidden'); }
    if (errCoach) { errCoach.textContent = ''; errCoach.classList.add('hidden'); }
    if (msg) { msg.textContent = ''; msg.classList.add('hidden'); }

    // Validation
    const name = (nameEl?.value || '').trim();
    const rawAge = (ageEl?.value || '').trim();
    const sport = (sportEl?.value || '').trim();
    const coachId = currentUser?.role === 'admin' ? (coachSelect?.value || '') : undefined;

    let hasValidationError = false;

    if (!name) {
        if (errName) {
            errName.textContent = 'Full name is required';
            errName.classList.remove('hidden');
        }
        hasValidationError = true;
    }

    const numAge = Number(rawAge);
    if (!rawAge || isNaN(numAge) || !Number.isInteger(numAge) || numAge < 5 || numAge > 50) {
        if (errAge) {
            errAge.textContent = 'Age must be a whole number between 5 and 50';
            errAge.classList.remove('hidden');
        }
        hasValidationError = true;
    }

    if (!sport) {
        if (errSport) {
            errSport.textContent = 'Please select a sport';
            errSport.classList.remove('hidden');
        }
        hasValidationError = true;
    }

    if (currentUser?.role === 'admin' && !coachId) {
        if (errCoach) {
            errCoach.textContent = 'Please assign athlete to a coach';
            errCoach.classList.remove('hidden');
        }
        hasValidationError = true;
    }

    if (hasValidationError) {
        return;
    }

    btn.disabled = true;
    btn.innerHTML = `<span class="inline-block animate-spin mr-1">⌛</span> Registering in database...`;
    isLocalMutationInProgress = true;

    const idempotencyKey = 'reg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);

    try {
        const newPlayer = await api('/api/players', {
            method: 'POST',
            body: {
                name,
                age: numAge,
                sport,
                idempotencyKey,
                ...(coachId ? { coachId } : {})
            }
        });

        const pId = newPlayer.playerId || newPlayer.username || '';
        showToast(`Athlete "${newPlayer.name}" successfully registered!`, 'success');

        msg.textContent = `✅ Player "${newPlayer.name}" successfully registered into ${newPlayer.sport}! Player ID: ${pId}`;
        msg.className = 'text-xs font-semibold text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-xl';
        msg.classList.remove('hidden');

        // Reset inputs
        if (nameEl) nameEl.value = '';
        if (ageEl) ageEl.value = '';
        if (sportEl) sportEl.value = '';

        // Open secure success modal with Player ID, Username and Temporary Password
        openPlayerCredentialsModal(newPlayer, newPlayer.credentials || {});

        loadRoleData(currentUser?.role || 'coach');

        // Broadcast to other open tabs
        broadcastSyncEvent('player', 'created', { entityId: newPlayer._id });
    } catch (err) {
        showToast(err.message, 'error');
        msg.textContent = `❌ ${err.message}`;
        msg.className = 'text-xs font-semibold text-rose-500 bg-rose-500/10 border border-rose-500/20 p-3 rounded-xl';
        msg.classList.remove('hidden');
    } finally {
        endLocalMutation();
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="user-plus" class="w-4 h-4"></i><span>Register Player</span>`;
        initIcons();
    }
}

// ── Sessions & Attendance (Spec 1: Open -> 2: Mark -> 3: Lock) ──
function openCreateSessionModal() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const todayLocal = `${year}-${month}-${day}`;

    const html = `
        <div class="space-y-4">
            <div>
                <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Session Date</label>
                <input id="modal-session-date" type="date" value="${todayLocal}" max="${todayLocal}" onchange="if(this.value > '${todayLocal}'){ this.value = '${todayLocal}'; showToast('Future dates are not allowed. Date reset to today.', 'warning'); }" class="w-full bg-white/50 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500">
                <p class="text-[11px] text-slate-400 mt-1">Sessions can only be created for today or past dates.</p>
            </div>
            <div>
                <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Sport</label>
                <select id="modal-session-sport" class="w-full bg-white/50 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500">
                    <option value="Football">Football</option>
                    <option value="Cricket">Cricket</option>
                    <option value="Basketball">Basketball</option>
                </select>
            </div>
            <p class="text-xs text-slate-400">All registered players under this sport will start as Present.</p>
        </div>
    `;

    openModal(
        'Open New Training Session',
        html,
        [
            { label: 'Cancel', class: 'px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white', action: 'closeModal()' },
            { label: 'Create Session', class: 'px-5 py-2 rounded-xl text-sm font-bold bg-brand-600 text-white hover:bg-brand-700', action: 'submitCreateSession()' }
        ]
    );
}

let activeRosterSession = null;
let activeRosterAttendance = [];
let isRosterEditMode = false;

async function submitCreateSession() {
    const dateInput = document.getElementById('modal-session-date');
    const sportInput = document.getElementById('modal-session-sport');
    if (!dateInput || !sportInput) return;

    const date = dateInput.value;
    const sport = sportInput.value;
    if (!date || !sport) return;

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const todayLocal = `${year}-${month}-${day}`;

    if (date > todayLocal) {
        showToast('Cannot create attendance sessions for future dates. Please select today or a past date.', 'error');
        return;
    }

    try {
        isLocalMutationInProgress = true;
        const session = await api('/api/sessions', {
            method: 'POST',
            body: { date, sport }
        });
        closeModal();
        showToast('New session created! Opening attendance roster...', 'success');
        loadCoachStats();
        openSessionRosterView(session._id, { isEditing: false });

        broadcastSyncEvent('session', 'created', { entityId: session._id });
    } catch (err) {
        showToast('Error opening session: ' + err.message, 'error');
    } finally {
        isLocalMutationInProgress = false;
    }
}

// ── Unified Session Roster Eligibility ───────────────────────────────────────
function isPlayerEligibleForSession(player, session) {
    if (!player || !session) return false;

    // 1. Sport check (case-insensitive)
    const pSport = (player.sport || '').trim().toLowerCase();
    const sSport = (session.sport || '').trim().toLowerCase();
    if (!pSport || !sSport || pSport !== sSport) return false;

    // 2. Coach check
    const pCoach = player.coach ? (player.coach._id || player.coach).toString() : null;
    const sCoach = session.coach ? (session.coach._id || session.coach).toString() : null;
    if (pCoach && sCoach && pCoach !== sCoach) return false;

    // 3. Registration date check (registeredOn <= session date end of day)
    if (player.registeredOn && session.date) {
        const regDate = new Date(player.registeredOn);
        const sessDate = new Date(session.date);
        if (!isNaN(regDate.getTime()) && !isNaN(sessDate.getTime())) {
            const sessEndLocal = new Date(sessDate);
            sessEndLocal.setHours(23, 59, 59, 999);
            const sessEndUtc = new Date(sessDate);
            sessEndUtc.setUTCHours(23, 59, 59, 999);
            const latestAllowed = sessEndLocal > sessEndUtc ? sessEndLocal : sessEndUtc;
            if (regDate > latestAllowed) return false;
        }
    }

    // 4. Default participation check: must include practice ('practice' or 'both')
    const defaultPart = (player.defaultParticipation || 'both').toLowerCase();
    if (defaultPart !== 'practice' && defaultPart !== 'both') {
        return false;
    }

    return true;
}

async function openSessionRosterView(sessionId, options = {}) {
    if (!sessionId) return;
    try {
        if (!cachedPlayers || cachedPlayers.length === 0) {
            cachedPlayers = await api('/api/players');
        }

        // Authoritative fresh session details from API
        const session = await api(`/api/sessions/${sessionId}`);
        if (!session) return;
        activeRosterSession = session;

        // Non-blocking background player refresh
        api('/api/players').then(pList => { if (pList) cachedPlayers = pList; }).catch(() => {});

        // Determine workflow: First-time attendance vs Editing previously saved attendance
        const isEditing = options.isEditing === true || (options.isEditing === undefined && !!session.saved && (session.attendance || []).length > 0);
        isRosterEditMode = isEditing;

        if (session.locked) {
            showToast('Session is locked. Unlock the session first to edit attendance.', 'warning');
            await openSessionDetailsView(sessionId);
            return;
        }

        // Filter all registered and eligible players for this session
        const sportPlayers = (cachedPlayers || []).filter(p => {
            return isPlayerEligibleForSession(p, session);
        });

        if (!isEditing) {
            // ================= PART 1: FIRST-TIME ATTENDANCE WORKFLOW =================
            // Brand new session: Attendance taken for the FIRST time!
            // All players automatically preselected as PRESENT.
            // Initially, Absent count must be 0; Present count must equal total registered players.
            activeRosterAttendance = sportPlayers.map(p => ({
                playerId: p._id.toString(),
                name: p.name || 'Athlete',
                age: p.age || 18,
                sport: session.sport,
                status: 'present',
                participation: p.defaultParticipation || 'both'
            }));
        } else {
            // ================= PART 2: PREVIOUSLY SAVED ATTENDANCE WORKFLOW =================
            // Load the previously saved attendance values exactly as they are.
            // Never reset all players to Present when editing an existing session!
            const seenPids = new Set();
            activeRosterAttendance = [];

            (session.attendance || []).forEach(a => {
                const pid = (a.player?._id || a.player)?.toString();
                if (!pid || seenPids.has(pid)) return;
                seenPids.add(pid);

                const pDoc = (typeof a.player === 'object' && a.player?._id)
                    ? a.player
                    : (cachedPlayers || []).find(p => p._id.toString() === pid);

                const status = (a.status || 'present').toLowerCase() === 'absent' ? 'absent' : 'present';
                const participation = status === 'absent' ? null : (a.participation || pDoc?.defaultParticipation || 'both');

                activeRosterAttendance.push({
                    playerId: pid,
                    name: pDoc?.name || 'Athlete',
                    age: pDoc?.age || 18,
                    sport: session.sport,
                    status: status,
                    participation: participation
                });
            });

            // Also include any athletes in sportPlayers not recorded in session.attendance
            sportPlayers.forEach(p => {
                const pid = p._id.toString();
                if (!seenPids.has(pid)) {
                    seenPids.add(pid);
                    activeRosterAttendance.push({
                        playerId: pid,
                        name: p.name || 'Athlete',
                        age: p.age || 18,
                        sport: session.sport,
                        status: 'present',
                        participation: p.defaultParticipation || 'both'
                    });
                }
            });
        }

        hasUnsavedRosterChanges = false;

        renderActiveRoster();
        if (currentActivePageId !== 'coach-session-roster') {
            switchPage('coach-session-roster');
        }
    } catch (err) {
        showToast('Error opening roster: ' + err.message, 'error');
    }
}

function renderActiveRoster() {
    if (!activeRosterSession) return;

    const dateStr = new Date(activeRosterSession.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const dateTitle = document.getElementById('roster-date-title');
    const sportBadge = document.getElementById('roster-sport-badge');
    const modeBadge = document.getElementById('roster-mode-badge');
    const listElem = document.getElementById('roster-player-list');
    const helpText = document.getElementById('roster-footer-help-text');
    const actionButtons = document.getElementById('roster-action-buttons');

    if (dateTitle) {
        dateTitle.innerText = isRosterEditMode ? `Edit Attendance • ${dateStr}` : dateStr;
    }
    if (sportBadge) sportBadge.innerText = activeRosterSession.sport;

    if (modeBadge) {
        if (isRosterEditMode) {
            modeBadge.classList.remove('hidden');
        } else {
            modeBadge.classList.add('hidden');
        }
    }

    if (helpText) {
        helpText.innerText = isRosterEditMode
            ? 'You are editing previously saved attendance. Saving changes will automatically lock the session again.'
            : 'Default Present is only initial. Attendance is unsaved. Click Save Attendance to finalize and lock this session.';
    }

    if (actionButtons) {
        if (isRosterEditMode) {
            actionButtons.innerHTML = `
                <button type="button" onclick="cancelRosterEdit()"
                    class="w-full sm:w-auto px-5 py-2.5 rounded-xl text-xs font-bold bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition-colors shadow-xs flex items-center justify-center gap-1.5 cursor-pointer">
                    Cancel
                </button>
                <button id="roster-save-btn" onclick="executeSaveChanges()"
                    class="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer">
                    <i data-lucide="check" class="w-4 h-4"></i> Save Changes
                </button>
            `;
        } else {
            actionButtons.innerHTML = `
                <button id="roster-save-btn" onclick="executeSaveAttendance()"
                    class="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer">
                    <i data-lucide="check" class="w-4 h-4"></i> Save Attendance
                </button>
            `;
        }
    }

    updateRosterCounters();

    if (listElem) {
        listElem.innerHTML = activeRosterAttendance.map((item, idx) => {
            const isPresent = item.status === 'present';
            const rowClass = isPresent
                ? 'p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors border-b border-slate-200/80 dark:border-slate-800/80'
                : 'p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors bg-rose-500/5 border-b border-slate-200/80 dark:border-slate-800/80';

            return `
                <li class="${rowClass}">
                    <div class="flex items-center gap-3.5">
                        <div class="w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-base border shrink-0 ${isPresent
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                    : 'bg-rose-500/15 border-rose-500/30 text-rose-600 dark:text-rose-400'
                }">
                            ${item.name.charAt(0)}
                        </div>
                        <div>
                            <span class="font-bold text-base text-slate-900 dark:text-white block leading-tight">${item.name}</span>
                            <span class="text-sm text-slate-500 dark:text-slate-400 font-medium mt-0.5 block">Age ${item.age} &bull; ${item.sport}</span>
                        </div>
                    </div>

                    <!-- Status Controls: Present & Absent -->
                    <div class="inline-flex rounded-xl p-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                        <button 
                            type="button" 
                            onclick="setPlayerStatus(${idx}, 'present')" 
                            class="px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${
                                isPresent 
                                    ? 'bg-emerald-500 text-white shadow-xs' 
                                    : 'text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-500/10'
                            } cursor-pointer"
                        >
                            <i data-lucide="check" class="w-4 h-4 stroke-[3]"></i>
                            <span>Present</span>
                        </button>
                        <button 
                            type="button" 
                            onclick="setPlayerStatus(${idx}, 'absent')" 
                            class="px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${
                                !isPresent 
                                    ? 'bg-rose-500 text-white shadow-xs' 
                                    : 'text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10'
                            } cursor-pointer"
                        >
                            <i data-lucide="x" class="w-4 h-4 stroke-[3]"></i>
                            <span>Absent</span>
                        </button>
                    </div>
                </li>
            `;
        }).join('');
    }

    initIcons();
}

function setPlayerStatus(index, newStatus) {
    if (!activeRosterAttendance[index]) return;
    if (activeRosterSession && activeRosterSession.locked) {
        showToast('Session is locked. Unlock the session to edit attendance.', 'warning');
        return;
    }

    const current = activeRosterAttendance[index];
    if (current.status === newStatus) return;

    current.status = newStatus;
    if (newStatus === 'absent') {
        current.participation = null;
    } else {
        current.participation = 'both';
    }
    hasUnsavedRosterChanges = true;
    renderActiveRoster();
}

function togglePlayerAttendance(index) {
    if (!activeRosterAttendance[index]) return;
    if (activeRosterSession && activeRosterSession.locked) {
        showToast('Session is locked. Unlock the session to edit attendance.', 'warning');
        return;
    }

    const current = activeRosterAttendance[index];
    const newStatus = current.status === 'present' ? 'absent' : 'present';
    setPlayerStatus(index, newStatus);
}

function setPlayerParticipation(index, reason) {
    if (!activeRosterAttendance[index]) return;
    if (activeRosterSession && activeRosterSession.locked) return;
    if (activeRosterAttendance[index].status === 'absent') return;

    if (['practice', 'match', 'both'].includes(reason)) {
        activeRosterAttendance[index].participation = reason;
        hasUnsavedRosterChanges = true;
        renderActiveRoster();
    }
}

function setAllAttendance(status) {
    if (activeRosterSession && activeRosterSession.locked) {
        showToast('Session is locked. Unlock the session to edit attendance.', 'warning');
        return;
    }

    activeRosterAttendance.forEach(a => {
        a.status = status;
        if (status === 'present') {
            a.participation = 'both';
        } else {
            a.participation = null;
        }
    });
    hasUnsavedRosterChanges = true;
    renderActiveRoster();
    showToast(`Marked all players as ${status.toUpperCase()}`, 'info');
}

function updateRosterCounters() {
    const presentCount = activeRosterAttendance.filter(a => a.status === 'present').length;
    const absentCount = activeRosterAttendance.length - presentCount;

    const presentElem = document.getElementById('roster-present-counter');
    const absentElem = document.getElementById('roster-absent-counter');

    if (presentElem) presentElem.innerText = presentCount;
    if (absentElem) absentElem.innerText = absentCount;
}

// ================= PART 1: FIRST-TIME ATTENDANCE SAVE =================
async function executeSaveAttendance() {
    if (!activeRosterSession) return;
    if (isSavingRosterAttendance) return;

    const saveBtn = document.getElementById('roster-save-btn');
    const originalBtnHtml = saveBtn ? saveBtn.innerHTML : '';

    try {
        isSavingRosterAttendance = true;
        isLocalMutationInProgress = true;

        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.classList.add('opacity-75', 'cursor-not-allowed');
            saveBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Saving Attendance...';
            initIcons();
        }

        const payload = activeRosterAttendance.map(a => ({
            playerId: a.playerId,
            status: a.status,
            participation: a.status === 'absent' ? null : (a.participation || 'both')
        }));

        const res = await api(`/api/sessions/${activeRosterSession._id}/save`, {
            method: 'PATCH',
            body: { attendance: payload }
        });

        const sessionId = activeRosterSession._id;
        if (res && res.session) {
            activeRosterSession = res.session;
        } else {
            activeRosterSession.saved = true;
            activeRosterSession.locked = true;
        }

        hasUnsavedRosterChanges = false;
        isRosterEditMode = false;
        isNavigatingAfterSave = true;

        // Show success notification
        showToast('Attendance saved successfully.', 'success');

        // Automatically navigate back to Attendance Sessions page
        await switchPage('coach-sessions');

        // Refresh Attendance Sessions data and associated cache
        await Promise.all([
            loadSessions(),
            loadCoachStats(),
            loadCoachPlayers(),
            loadMatchData()
        ]);
        cachedPlayers = await api('/api/players');

        // Broadcast to other open tabs
        broadcastSyncEvent('attendance', 'saved', { entityId: sessionId });
    } catch (err) {
        // Keep Coach on attendance-taking screen and display clear error message
        showToast(err.message || 'Error saving attendance', 'error');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.classList.remove('opacity-75', 'cursor-not-allowed');
            saveBtn.innerHTML = originalBtnHtml || '<i data-lucide="check" class="w-4 h-4"></i> Save Attendance';
            initIcons();
        }
    } finally {
        isSavingRosterAttendance = false;
        isNavigatingAfterSave = false;
        isLocalMutationInProgress = false;
    }
}

// ================= PART 2: EDIT ATTENDANCE SAVE & CANCEL =================
async function executeSaveChanges() {
    if (!activeRosterSession) return;
    if (isSavingRosterAttendance) return;

    const saveBtn = document.getElementById('roster-save-btn');
    const originalBtnHtml = saveBtn ? saveBtn.innerHTML : '';

    try {
        isSavingRosterAttendance = true;
        isLocalMutationInProgress = true;

        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.classList.add('opacity-75', 'cursor-not-allowed');
            saveBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Saving Changes...';
            initIcons();
        }

        const payload = activeRosterAttendance.map(a => ({
            playerId: a.playerId,
            status: a.status,
            participation: a.status === 'absent' ? null : (a.participation || 'both')
        }));

        const res = await api(`/api/sessions/${activeRosterSession._id}/save`, {
            method: 'PATCH',
            body: { attendance: payload }
        });

        const sessionId = activeRosterSession._id;
        const updatedSession = res?.session || activeRosterSession;
        updatedSession.saved = true;
        updatedSession.locked = true; // Automatically locked again

        activeRosterSession = updatedSession;
        activeDetailsSession = updatedSession;

        hasUnsavedRosterChanges = false;
        isRosterEditMode = false;
        isNavigatingAfterSave = true;

        showToast('Attendance updated and session locked successfully.', 'success');

        // Automatically navigate back to Session Details in read-only mode
        await openSessionDetailsView(sessionId);

        // Background refresh
        Promise.all([
            loadSessions(),
            loadCoachStats(),
            loadCoachPlayers(),
            loadMatchData()
        ]).catch(() => {});

        broadcastSyncEvent('attendance', 'saved', { entityId: sessionId });
    } catch (err) {
        showToast(err.message || 'Error saving changes', 'error');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.classList.remove('opacity-75', 'cursor-not-allowed');
            saveBtn.innerHTML = originalBtnHtml || '<i data-lucide="check" class="w-4 h-4"></i> Save Changes';
            initIcons();
        }
    } finally {
        isSavingRosterAttendance = false;
        isNavigatingAfterSave = false;
        isLocalMutationInProgress = false;
    }
}

async function cancelRosterEdit() {
    if (!activeRosterSession) {
        switchPage('coach-sessions');
        return;
    }
    const sessionId = activeRosterSession._id;
    hasUnsavedRosterChanges = false;
    isRosterEditMode = false;

    // Restore the appropriate locked state: re-lock if it was unlocked
    try {
        if (!activeRosterSession.locked) {
            await api(`/api/sessions/${sessionId}/toggle-lock`, { method: 'PATCH' });
        }
    } catch (e) {
        console.warn('Could not re-lock session on cancel:', e);
    }

    showToast('Attendance edits cancelled.', 'info');
    await openSessionDetailsView(sessionId);
}

function backFromRosterView() {
    if (hasUnsavedRosterChanges) {
        const msg = isRosterEditMode
            ? 'You have unsaved attendance changes. Discard changes and go back?'
            : 'Attendance is not saved yet. Are you sure you want to go back to Sessions?';
        if (!window.confirm(msg)) {
            return;
        }
    }
    hasUnsavedRosterChanges = false;

    if (isRosterEditMode && activeRosterSession) {
        cancelRosterEdit();
    } else {
        isRosterEditMode = false;
        switchPage('coach-sessions');
    }
}

let cachedSessions = [];
let cachedPlayers = [];
let activeDetailsSession = null;
let activeDetailsPlayers = [];

// ── 1. MAIN ATTENDANCE SESSIONS PAGE: SESSION-WISE TABLE ────────────────────
async function loadSessions() {
    const tableBody = document.getElementById('session-table-body');
    if (!tableBody) return;

    // Fast render: If cachedSessions already exist, render immediately to eliminate perceived lag
    if (cachedSessions && cachedSessions.length > 0) {
        filterSessionsTable();
    } else {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="py-8 text-center text-slate-400">
                    <div class="flex items-center justify-center gap-2">
                        <i data-lucide="loader-2" class="w-4 h-4 animate-spin text-brand-600"></i>
                        <span>Loading training sessions from database...</span>
                    </div>
                </td>
            </tr>
        `;
        initIcons();
    }

    try {
        const [sessions, players] = await Promise.all([
            api('/api/sessions'),
            api('/api/players')
        ]);

        // If user navigated away to another page while loading, update cache and exit
        if (currentActivePageId && currentActivePageId !== 'coach-sessions') {
            cachedSessions = sessions || [];
            cachedPlayers = players || [];
            return;
        }

        cachedSessions = sessions || [];
        cachedPlayers = players || [];

        // Update badge count
        const badgeCount = document.getElementById('sessions-badge-count');
        if (badgeCount) badgeCount.innerText = cachedSessions.length;

        // Populate session-wise stats ribbon. Official turnout only counts
        // saved sessions; draft rosters default to present and must not inflate it.
        const totalSessions = cachedSessions.length;
        const reportedSessions = cachedSessions.filter(s => s.saved || s.locked);
        let totalPresences = 0;
        let totalPossible = 0;

        reportedSessions.forEach(s => {
            const pres = s.presentCount ?? (s.attendance || []).filter(a => a.status === 'present').length;
            const tot = s.totalCount ?? (s.attendance || []).length;
            totalPresences += pres;
            totalPossible += tot;
        });

        const avgSessionAtt = totalPossible > 0 ? Math.round((totalPresences / totalPossible) * 100) : 0;

        const statTotal = document.getElementById('session-stat-total');
        const statAvg = document.getElementById('session-stat-avg');

        if (statTotal) statTotal.innerText = totalSessions;
        if (statAvg) statAvg.innerText = `${avgSessionAtt}%`;

        // Update sport filter options
        updateSessionSportFilterOptions();

        // Render sessions table
        filterSessionsTable();
    } catch (err) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="py-6 text-center text-rose-500 font-semibold">
                    Error loading sessions: ${err.message}
                </td>
            </tr>
        `;
    }
}

function updateSessionSportFilterOptions() {
    const sportFilter = document.getElementById('session-sport-filter');
    if (!sportFilter) return;
    const currentVal = sportFilter.value;
    const sports = Array.from(new Set(cachedSessions.map(s => s.sport).filter(Boolean)));

    sportFilter.innerHTML = '<option value="ALL">All Sports</option>' +
        sports.map(s => `<option value="${s}" ${s === currentVal ? 'selected' : ''}>${s}</option>`).join('');
}

function filterSessionsTable() {
    const searchInput = document.getElementById('session-search-input');
    const sportFilter = document.getElementById('session-sport-filter');

    const sessionQuery = (searchInput?.value || '').trim().toLowerCase();
    const query = sessionQuery || (currentSearchQuery || '').trim().toLowerCase();
    const sport = sportFilter?.value || 'ALL';

    const filtered = cachedSessions.filter(s => {
        const dateStr = new Date(s.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toLowerCase();
        const matchesQuery = !query || dateStr.includes(query) || (s.sport && s.sport.toLowerCase().includes(query));
        const matchesSport = (sport === 'ALL') || (s.sport === sport);

        return matchesQuery && matchesSport;
    });

    renderSessionsTable(filtered);
}

function renderSessionsTable(sessions) {
    const tableBody = document.getElementById('session-table-body');
    const countElem = document.getElementById('session-records-count');
    if (!tableBody) return;

    if (countElem) {
        countElem.innerText = `Showing ${sessions.length} session${sessions.length === 1 ? '' : 's'}`;
    }

    if (!sessions.length) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="py-12 text-center text-slate-400">
                    <div class="flex flex-col items-center justify-center gap-1.5">
                        <i data-lucide="calendar-x" class="w-6 h-6 text-slate-300 dark:text-slate-600"></i>
                        <p class="font-semibold text-xs">No training sessions found</p>
                        <p class="text-[11px] text-slate-400">Click "Open New Session" to create your first session.</p>
                    </div>
                </td>
            </tr>
        `;
        initIcons();
        return;
    }

    tableBody.innerHTML = sessions.map((s, idx) => {
        const dateStr = new Date(s.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const hasRecordedAttendance = !!(s.saved || s.locked || s.savedAt || (s.attendance && s.attendance.length > 0));
        const presentCount = hasRecordedAttendance ? (s.presentCount ?? (s.attendance || []).filter(a => a.status === 'present').length) : 0;
        const totalCount = s.totalCount ?? (((s.attendance || []).length) || ((s.initialRosterPlayerIds || []).length) || (s.createdWithCount || 0));
        const attPct = hasRecordedAttendance ? (s.attendanceRate ?? (totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0)) : 0;

        const isGreen = totalCount > 0 && (presentCount * 4 >= totalCount * 3);
        const barColor = isGreen ? 'bg-[#10B981]' : 'bg-[#F59E0B]';
        const textColor = isGreen
            ? 'text-emerald-600 dark:text-emerald-400 font-extrabold'
            : 'text-amber-600 dark:text-amber-400 font-extrabold';

        return `
            <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors border-b border-slate-200/80 dark:border-slate-800/80">
                <!-- 1. S.No. -->
                <td class="py-4 px-4 text-center font-bold text-slate-400 text-sm border-r border-slate-200/80 dark:border-slate-800/80">
                    ${idx + 1}
                </td>

                <!-- 2. Date -->
                <td class="py-4 px-6 border-r border-slate-200/80 dark:border-slate-800/80">
                    <span class="font-bold text-slate-900 dark:text-white text-sm block whitespace-nowrap">${dateStr}</span>
                </td>

                <!-- 3. Sport Name -->
                <td class="py-4 px-5 border-r border-slate-200/80 dark:border-slate-800/80">
                    <span class="inline-flex items-center px-3 py-1 rounded-md text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        ${s.sport}
                    </span>
                </td>

                <!-- 4. Attendance (%) -->
                <td class="py-4 px-6 border-r border-slate-200/80 dark:border-slate-800/80">
                    <div class="w-full min-w-[200px] max-w-[260px]">
                        ${hasRecordedAttendance ? `
                            <div class="flex justify-between items-center mb-1.5 text-xs">
                                <span class="${textColor}">${attPct}%</span>
                            </div>
                            <div class="w-full h-2.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                                <div class="h-full rounded-full transition-all duration-500 ${barColor}" style="width: ${Math.min(100, attPct)}%"></div>
                            </div>
                            <span class="text-xs text-slate-400 mt-1.5 block font-medium">${totalCount} athlete${totalCount === 1 ? '' : 's'} recorded</span>
                        ` : `
                            <div class="flex items-center gap-1.5 mb-1.5">
                                <span class="px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 inline-flex items-center gap-1.5">
                                    <i data-lucide="clock" class="w-3.5 h-3.5"></i> Draft (Unsaved)
                                </span>
                            </div>
                            <span class="text-xs text-slate-400 block font-medium">${totalCount} athlete${totalCount === 1 ? '' : 's'} on roster</span>
                        `}
                    </div>
                </td>

                <!-- 5. Action -->
                <td class="py-4 px-5 text-center">
                    <div class="inline-flex items-center justify-center">
                        ${hasRecordedAttendance ? `
                            <button 
                                type="button"
                                onclick="openSessionDetailsView('${s._id}')" 
                                class="px-4 py-2 rounded-xl text-sm font-bold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:border-brand-500 hover:text-brand-600 dark:hover:text-brand-400 transition-colors shadow-2xs inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                            >
                                <i data-lucide="file-text" class="w-4 h-4 text-brand-600 dark:text-brand-400"></i>
                                <span>View Details</span>
                            </button>
                        ` : `
                            <button 
                                type="button"
                                onclick="openSessionRosterView('${s._id}')" 
                                class="px-4 py-2 rounded-xl text-sm font-bold bg-brand-600 hover:bg-brand-700 text-white transition-colors shadow-2xs inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                            >
                                <i data-lucide="clipboard-check" class="w-4 h-4"></i>
                                <span>Take Attendance</span>
                            </button>
                        `}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    initIcons();
}

// ── 2. SHOW DETAILS PAGE: DATE-SPECIFIC ATTENDANCE REGISTER ────────────────
function renderSessionDetailsView(session) {
    if (!session) return;
    activeDetailsSession = session;

    const hasRecordedAttendance = !!(session.saved || session.locked || session.savedAt || (session.attendance && session.attendance.length > 0));
    const isSaved = !!(session.saved || session.locked);
    const dateStr = new Date(session.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const presentCount = hasRecordedAttendance ? (session.presentCount ?? (session.attendance || []).filter(a => a.status === 'present').length) : 0;
    const totalCount = session.totalCount ?? (session.attendance || []).length;
    const absentCount = hasRecordedAttendance ? (session.absentCount ?? (totalCount - presentCount)) : 0;
    const sessionAttPct = hasRecordedAttendance ? (session.attendanceRate ?? (totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0)) : 0;

    // Header and badges
    const titleElem = document.getElementById('details-session-title');
    const sportBadge = document.getElementById('details-sport-badge');
    const dateBadge = document.getElementById('details-date-badge');
    const turnoutElem = document.getElementById('details-session-turnout');
    const lockedBadge = document.getElementById('details-locked-badge');
    const savedBadge = document.getElementById('details-saved-badge');
    const rosterNote = document.getElementById('details-roster-note');
    const editBtn = document.getElementById('details-edit-att-btn');
    const lockBtn = document.getElementById('details-lock-btn');

    if (titleElem) titleElem.innerText = `${session.sport} • ${dateStr}`;
    if (sportBadge) sportBadge.innerText = session.sport;
    if (dateBadge) dateBadge.innerText = dateStr;

    if (turnoutElem) {
        if (hasRecordedAttendance) {
            turnoutElem.innerText = `${presentCount} Present • ${absentCount} Absent (${sessionAttPct}%) • ${totalCount} recorded`;
        } else {
            turnoutElem.innerText = `Attendance Not Taken • ${totalCount} on roster`;
        }
    }

    if (savedBadge) {
        savedBadge.classList.remove('hidden');
        if (isSaved) {
            savedBadge.className = 'px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 flex items-center gap-1';
            savedBadge.innerHTML = '<i data-lucide="check-circle" class="w-3 h-3"></i> Saved';
        } else {
            savedBadge.className = 'px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 flex items-center gap-1';
            savedBadge.innerHTML = '<i data-lucide="clock" class="w-3 h-3"></i> Draft';
        }
    }

    // Conflict check for linked matches
    const conflictAlert = document.getElementById('details-conflict-alert');
    if (conflictAlert) {
        const sessionDateStr = getTodayIstString(session.date);
        const hasLinkedConflict = (cachedMatchList || []).some(m => {
            const mDateStr = getTodayIstString(m.date);
            return mDateStr === sessionDateStr && m.sport === session.sport && m.hasConflict;
        });
        if (hasLinkedConflict) {
            conflictAlert.classList.remove('hidden');
        } else {
            conflictAlert.classList.add('hidden');
        }
    }

    if (rosterNote) {
        rosterNote.innerText = hasRecordedAttendance
            ? `Historical snapshot: ${totalCount} athlete${totalCount === 1 ? '' : 's'} recorded when this session was saved. Athletes enrolled later are shown as not in roster and do not affect this session.`
            : `Draft roster: ${totalCount} athlete${totalCount === 1 ? '' : 's'}. Attendance has not been taken yet.`;
    }

    // Handle locked status: Draft sessions without attendance cannot be locked/unlocked
    const toggleLockBtn = document.getElementById('details-toggle-lock-btn');
    if (toggleLockBtn) {
        if (!isSaved) {
            toggleLockBtn.classList.add('hidden');
        } else {
            toggleLockBtn.classList.remove('hidden');
            if (session.locked) {
                toggleLockBtn.className = 'px-3.5 py-2.5 rounded-xl text-xs font-bold bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 transition-all shadow-xs flex items-center gap-1.5 cursor-pointer';
                toggleLockBtn.innerHTML = '<i data-lucide="unlock" class="w-4 h-4"></i> <span>Unlock Session</span>';
                toggleLockBtn.title = 'Session is Locked. Click to unlock attendance.';
            } else {
                toggleLockBtn.className = 'px-3.5 py-2.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 transition-all shadow-xs flex items-center gap-1.5 cursor-pointer';
                toggleLockBtn.innerHTML = '<i data-lucide="lock" class="w-4 h-4 text-slate-500"></i> <span>Lock Session</span>';
                toggleLockBtn.title = 'Session is Unlocked. Click to lock attendance.';
            }
        }
    }

    if (lockedBadge) {
        if (isSaved) {
            lockedBadge.classList.remove('hidden');
            if (session.locked) {
                lockedBadge.className = 'px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 flex items-center gap-1';
                lockedBadge.innerHTML = '<i data-lucide="lock" class="w-3 h-3"></i> Locked';
            } else {
                lockedBadge.className = 'px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 flex items-center gap-1';
                lockedBadge.innerHTML = '<i data-lucide="unlock" class="w-3 h-3"></i> Open';
            }
        } else {
            lockedBadge.classList.add('hidden');
        }
    }

    // Action button:
    // If draft session (!isSaved), show "Take Attendance".
    // If previously saved session (isSaved), show "Edit Attendance".
    if (editBtn) {
        editBtn.classList.remove('hidden');
        editBtn.disabled = false;
        editBtn.className = 'px-4 py-2.5 rounded-xl text-xs font-bold bg-brand-600 hover:bg-brand-700 text-white transition-colors shadow-xs flex items-center gap-2 cursor-pointer';
        if (isSaved) {
            editBtn.innerHTML = '<i data-lucide="edit-3" class="w-4 h-4"></i> <span>Edit Attendance</span>';
        } else {
            editBtn.innerHTML = '<i data-lucide="clipboard-check" class="w-4 h-4"></i> <span>Take Attendance</span>';
        }
    }
    if (lockBtn) {
        lockBtn.classList.add('hidden');
    }

    const sessionDayEnd = new Date(session.date);
    sessionDayEnd.setHours(23, 59, 59, 999);
    const sessionCoachId = session.coach ? (session.coach._id || session.coach).toString() : null;

    if (!hasRecordedAttendance) {
        // Attendance NOT taken yet. Every athlete registered in this sport up to this date who is eligible is in the draft roster.
        const sportAthletes = (cachedPlayers || []).filter(p => {
            return isPlayerEligibleForSession(p, session);
        }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        activeDetailsPlayers = sportAthletes.map(p => ({
            _id: p._id.toString(),
            name: p.name,
            age: p.age,
            sport: p.sport,
            isReady: !!p.isReady,
            sessionStatus: 'not_taken',
            inRoster: true
        }));

        // Also check if any initialRosterPlayerIds exist that might not be in sportAthletes
        const athleteIdSet = new Set(activeDetailsPlayers.map(p => p._id));
        (session.initialRosterPlayerIds || []).forEach(pidObj => {
            const pid = (pidObj?._id || pidObj)?.toString();
            if (pid && !athleteIdSet.has(pid)) {
                athleteIdSet.add(pid);
                const found = (cachedPlayers || []).find(p => p._id.toString() === pid);
                if (found) {
                    activeDetailsPlayers.push({
                        _id: pid,
                        name: found.name,
                        age: found.age,
                        sport: found.sport,
                        isReady: !!found.isReady,
                        sessionStatus: 'not_taken',
                        inRoster: true
                    });
                }
            }
        });

        // If sportAthletes is empty, fallback to cachedPlayers or session.attendance IDs
        if (activeDetailsPlayers.length === 0) {
            (session.attendance || []).forEach(entry => {
                const pId = entry.player ? (entry.player._id || entry.player).toString() : '';
                const found = (cachedPlayers || []).find(p => p._id.toString() === pId);
                if (pId && !athleteIdSet.has(pId)) {
                    athleteIdSet.add(pId);
                    activeDetailsPlayers.push({
                        _id: pId,
                        name: found?.name || entry?.player?.name || 'Athlete',
                        age: found?.age || entry?.player?.age || 18,
                        sport: found?.sport || entry?.player?.sport || session.sport,
                        isReady: found ? !!found.isReady : false,
                        sessionStatus: 'not_taken',
                        inRoster: true
                    });
                }
            });
        }

        if (turnoutElem) {
            turnoutElem.innerText = `Attendance Not Taken • ${activeDetailsPlayers.length} on roster`;
        }
    } else {
        // Attendance HAS been recorded.
        // Build the recorded roster for THIS session from session.attendance snapshot
        const sessionAttendance = session.attendance || [];
        const rosterIds = new Set();
        const playersForSession = sessionAttendance.map(entry => {
            const pId = entry.player ? (entry.player._id || entry.player).toString() : '';
            if (pId) rosterIds.add(pId);
            const found = (cachedPlayers || []).find(p => p._id.toString() === pId);
            const status = (entry.status || 'absent').toLowerCase();
            return {
                _id: pId,
                name: found?.name || entry?.player?.name || 'Athlete',
                age: found?.age || entry?.player?.age || 18,
                sport: found?.sport || entry?.player?.sport || session.sport,
                isReady: found ? !!found.isReady : false,
                sessionStatus: status === 'present' ? 'present' : 'absent',
                inRoster: true
            };
        });

        // Any eligible player not in session.attendance snapshot is displayed with inRoster: true and 'not_recorded'
        const otherEligiblePlayers = (cachedPlayers || []).filter(p => {
            const pid = p._id.toString();
            if (rosterIds.has(pid)) return false;
            return isPlayerEligibleForSession(p, session);
        }).sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(p => ({
            _id: p._id.toString(),
            name: p.name,
            age: p.age,
            sport: p.sport,
            isReady: !!p.isReady,
            sessionStatus: 'not_recorded',
            inRoster: true
        }));

        activeDetailsPlayers = [...playersForSession, ...otherEligiblePlayers];
    }

    // Clear search input
    const searchInput = document.getElementById('details-player-search');
    if (searchInput) searchInput.value = '';

    renderSessionPlayersTable(activeDetailsPlayers);
}

function handleEditAttendanceClick() {
    if (!activeDetailsSession) return;

    if (!activeDetailsSession.saved && !activeDetailsSession.locked) {
        // Unsaved draft session: first-time attendance
        openSessionRosterView(activeDetailsSession._id, { isEditing: false });
        return;
    }

    // Previously saved session: respect locking rules
    if (activeDetailsSession.locked) {
        showToast('Session is locked. Unlock the session first to edit attendance.', 'warning');
        return;
    }

    // Session is unlocked: open roster in Edit Mode
    openSessionRosterView(activeDetailsSession._id, { isEditing: true });
}

async function openSessionDetailsView(sessionId) {
    try {
        // Fast path: If session exists in memory, transition immediately in 0ms!
        let cached = (activeDetailsSession && activeDetailsSession._id === sessionId)
            ? activeDetailsSession
            : (cachedSessions || []).find(s => s._id === sessionId);

        if (cached) {
            renderSessionDetailsView(cached);
            switchPage('coach-session-details');
        }

        // Asynchronously fetch fresh enriched session from database
        const session = await api(`/api/sessions/${sessionId}`);
        if (!session) {
            if (!cached) showToast('Session not found', 'error');
            return;
        }

        renderSessionDetailsView(session);
        if (currentActivePageId !== 'coach-session-details') {
            switchPage('coach-session-details');
        }
    } catch (err) {
        showToast('Error opening session details: ' + err.message, 'error');
    }
}

function filterSessionPlayersTable() {
    const searchInput = document.getElementById('details-player-search');
    const query = (searchInput?.value || '').trim().toLowerCase();

    const filtered = activeDetailsPlayers.filter(p => {
        return !query || (p.name && p.name.toLowerCase().includes(query));
    });

    renderSessionPlayersTable(filtered);
}

function renderSessionPlayersTable(players) {
    const tableBody = document.getElementById('details-player-table-body');
    const countElem = document.getElementById('details-player-count');
    if (!tableBody) return;

    const hasRecordedAttendance = !!(activeDetailsSession && (
        activeDetailsSession.saved ||
        activeDetailsSession.locked ||
        activeDetailsSession.savedAt ||
        (activeDetailsSession.attendance && activeDetailsSession.attendance.length > 0)
    ));

    if (countElem) {
        if (hasRecordedAttendance) {
            const recordedCount = players.filter(p => p.inRoster !== false && p.sessionStatus !== 'not_recorded').length;
            countElem.innerText = `Showing ${players.length} athlete${players.length === 1 ? '' : 's'} • ${recordedCount} recorded in this session`;
        } else {
            countElem.innerText = `Showing ${players.length} athlete${players.length === 1 ? '' : 's'} • Attendance not taken`;
        }
    }

    if (!players.length) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="py-10 text-center text-slate-400">
                    <p class="font-semibold text-xs">No registered athletes found for this session</p>
                </td>
            </tr>
        `;
        initIcons();
        return;
    }

    tableBody.innerHTML = players.map((p, idx) => {
        const isEligible = p.inRoster !== false && p.sessionStatus !== 'not_in_roster';
        const isPresent = (p.sessionStatus || 'absent').toLowerCase() === 'present';
        const isNotTaken = !hasRecordedAttendance || p.sessionStatus === 'not_taken';
        const isNotRecorded = p.sessionStatus === 'not_recorded';

        const readinessHtml = p.isReady
            ? `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 whitespace-nowrap shadow-2xs">
                 <i data-lucide="check-circle" class="w-3 h-3 text-emerald-500"></i> READY
               </span>`
            : `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-300 dark:border-slate-700 whitespace-nowrap shadow-2xs">
                 <i data-lucide="clock" class="w-3 h-3 text-slate-400"></i> NOT READY
               </span>`;

        let statusHtml;
        if (!isEligible) {
            statusHtml = `
                <span class="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-300 dark:border-slate-700 whitespace-nowrap shadow-2xs" title="Not eligible for this session roster">
                    <i data-lucide="minus-circle" class="w-3.5 h-3.5"></i>
                    <span>NOT IN ROSTER</span>
                </span>
            `;
        } else if (isNotRecorded) {
            statusHtml = `
                <span class="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 whitespace-nowrap shadow-2xs" title="Eligible roster athlete with no attendance record saved for this session">
                    <i data-lucide="clock" class="w-3.5 h-3.5 text-amber-500"></i>
                    <span>NOT RECORDED</span>
                </span>
            `;
        } else if (isNotTaken) {
            statusHtml = `
                <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 whitespace-nowrap shadow-2xs" title="Attendance has not been taken for this session yet">
                    <i data-lucide="clock" class="w-3.5 h-3.5 text-amber-500"></i>
                    <span>NOT TAKEN</span>
                </span>
            `;
        } else if (isPresent) {
            statusHtml = `
                <span class="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-[11px] font-extrabold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 whitespace-nowrap shadow-2xs">
                    <i data-lucide="check-circle" class="w-3.5 h-3.5 text-emerald-500"></i>
                    <span>PRESENT</span>
                </span>
            `;
        } else {
            statusHtml = `
                <span class="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-[11px] font-extrabold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 whitespace-nowrap shadow-2xs">
                    <i data-lucide="alert-circle" class="w-3.5 h-3.5 text-rose-500"></i>
                    <span>ABSENT</span>
                </span>
            `;
        }

        return `
            <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors border-b border-slate-200/80 dark:border-slate-800/80">
                <!-- 1. S.No. -->
                <td class="py-3.5 px-4 text-center font-bold text-slate-400 text-xs border-r border-slate-200/80 dark:border-slate-800/80">
                    ${idx + 1}
                </td>

                <!-- 2. Player Name -->
                <td class="py-3.5 px-5 border-r border-slate-200/80 dark:border-slate-800/80">
                    <div class="flex items-center gap-2.5">
                        <div class="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 flex items-center justify-center font-bold text-xs text-slate-700 dark:text-slate-200 shrink-0">
                            ${(p.name || '?').charAt(0).toUpperCase()}
                        </div>
                        <div class="min-w-0">
                            <span class="font-bold text-slate-900 dark:text-white text-xs block leading-tight truncate">${p.name}</span>
                            <span class="text-[10px] text-slate-400">Age ${p.age || '-'}</span>
                        </div>
                    </div>
                </td>

                <!-- 3. Sport Name -->
                <td class="py-3.5 px-5 border-r border-slate-200/80 dark:border-slate-800/80">
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        ${p.sport || 'General'}
                    </span>
                </td>

                <!-- 4. Trial Eligibility (Phase 6) -->
                <td class="py-3.5 px-5 text-center border-r border-slate-200/80 dark:border-slate-800/80">
                    ${readinessHtml}
                </td>

                <!-- 5. Attendance Status (LAST COLUMN) -->
                <td class="py-3.5 px-5 text-center">
                    ${statusHtml}
                </td>
            </tr>
        `;
    }).join('');

    initIcons();
}

async function toggleDetailPlayerStatus(playerId, newStatus) {
    if (!activeDetailsSession) return;
    const sessionId = activeDetailsSession._id;
    const wasLocked = !!(activeDetailsSession.locked || activeDetailsSession.saved);

    // 1. Instant Optimistic UI Update (0ms latency)
    const playerItem = (activeDetailsPlayers || []).find(p => p._id === playerId);
    if (!playerItem) return;
    const oldStatus = playerItem.sessionStatus;
    playerItem.sessionStatus = newStatus;

    if (!activeDetailsSession.attendance) activeDetailsSession.attendance = [];
    let attEntry = activeDetailsSession.attendance.find(a => (a.player?._id || a.player)?.toString() === playerId);
    if (attEntry) {
        attEntry.status = newStatus;
    } else {
        activeDetailsSession.attendance.push({ player: playerId, status: newStatus });
    }

    const presentCount = activeDetailsSession.attendance.filter(a => a.status === 'present').length;
    const totalCount = activeDetailsSession.attendance.length;
    const absentCount = totalCount - presentCount;
    const sessionAttPct = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;
    activeDetailsSession.presentCount = presentCount;
    activeDetailsSession.absentCount = absentCount;
    activeDetailsSession.attendanceRate = sessionAttPct;

    const turnoutElem = document.getElementById('details-session-turnout');
    if (turnoutElem) {
        turnoutElem.innerText = `${presentCount} Present • ${absentCount} Absent (${sessionAttPct}%) • ${totalCount} recorded`;
    }

    renderSessionPlayersTable(activeDetailsPlayers);

    // 2. Asynchronous Background Persistence and Sync
    (async () => {
        try {
            isLocalMutationInProgress = true;
            if (wasLocked) {
                await api(`/api/sessions/${sessionId}/toggle-lock`, { method: 'PATCH' });
            }

            const res = await api(`/api/sessions/${sessionId}/mark`, {
                method: 'PATCH',
                body: { playerId, status: newStatus }
            });

            if (wasLocked) {
                await api(`/api/sessions/${sessionId}/toggle-lock`, { method: 'PATCH' });
            }

            // Silently update active session and caches
            const freshSession = await api(`/api/sessions/${sessionId}`).catch(() => null);
            if (freshSession) {
                activeDetailsSession = freshSession;
                const idx = (cachedSessions || []).findIndex(s => s._id === sessionId);
                if (idx !== -1) cachedSessions[idx] = freshSession;
            }

            loadSessions().catch(() => {});
            loadCoachStats().catch(() => {});
            loadCoachPlayers().catch(() => {});
            loadMatchData().catch(() => {});

            const pName = playerItem.name || 'Athlete';
            if (res && res.conflicts && res.conflicts.conflictsCount > 0) {
                showToast(`Marked ${pName} as ${newStatus.toUpperCase()}. ⚠️ Attendance conflict flagged on linked match record!`, 'warning');
            } else {
                showToast(`Marked ${pName} as ${newStatus.toUpperCase()}`, 'success');
            }

            broadcastSyncEvent('attendance', 'updated', { entityId: sessionId });
        } catch (err) {
            // Rollback optimistic change on error
            playerItem.sessionStatus = oldStatus;
            if (attEntry) attEntry.status = oldStatus;
            renderSessionPlayersTable(activeDetailsPlayers);
            showToast('Error updating status: ' + err.message, 'error');
        } finally {
            isLocalMutationInProgress = false;
        }
    })();
}

// ── TOGGLE LOCK / UNLOCK ATTENDANCE ──────────────────────────────────────────
async function toggleSessionLock(sessionId) {
    if (!sessionId) return;

    const toggleLockBtn = document.getElementById('details-toggle-lock-btn');
    const lockedBadge = document.getElementById('details-locked-badge');

    // Determine current locked state from active session or cached session
    const currentSession = (activeDetailsSession && activeDetailsSession._id === sessionId)
        ? activeDetailsSession
        : cachedSessions.find(s => s._id === sessionId);

    const willBeLocked = !currentSession?.locked;

    // 1. Instant Optimistic UI Update (0ms delay)
    if (toggleLockBtn) {
        if (willBeLocked) {
            toggleLockBtn.className = 'px-3.5 py-2.5 rounded-xl text-xs font-bold bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 transition-all shadow-xs flex items-center gap-1.5 cursor-pointer';
            toggleLockBtn.innerHTML = '<i data-lucide="unlock" class="w-4 h-4"></i> <span>Unlock Session</span>';
            toggleLockBtn.title = 'Session is Locked. Click to unlock attendance.';
        } else {
            toggleLockBtn.className = 'px-3.5 py-2.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 transition-all shadow-xs flex items-center gap-1.5 cursor-pointer';
            toggleLockBtn.innerHTML = '<i data-lucide="lock" class="w-4 h-4 text-slate-500"></i> <span>Lock Session</span>';
            toggleLockBtn.title = 'Session is Unlocked. Click to lock attendance.';
        }
    }

    if (lockedBadge) {
        lockedBadge.classList.remove('hidden');
        if (willBeLocked) {
            lockedBadge.className = 'px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 flex items-center gap-1';
            lockedBadge.innerHTML = '<i data-lucide="lock" class="w-3 h-3"></i> Locked';
        } else {
            lockedBadge.className = 'px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 flex items-center gap-1';
            lockedBadge.innerHTML = '<i data-lucide="unlock" class="w-3 h-3"></i> Open';
        }
    }

    initIcons();

    // 2. Perform backend API mutation
    try {
        isLocalMutationInProgress = true;
        const res = await api(`/api/sessions/${sessionId}/toggle-lock`, {
            method: 'PATCH'
        });

        const isLocked = res.locked ?? res.session?.locked ?? willBeLocked;
        const msg = isLocked ? 'Session attendance locked.' : 'Session attendance unlocked.';
        showToast(msg, 'success');

        // Update in-memory session objects
        if (activeDetailsSession && activeDetailsSession._id === sessionId) {
            activeDetailsSession.locked = isLocked;
            if (res.session) {
                activeDetailsSession = res.session;
            }
            renderSessionDetailsView(activeDetailsSession);
        }

        const cached = cachedSessions.find(s => s._id === sessionId);
        if (cached) {
            cached.locked = isLocked;
        }

        // Fast background synchronization without blocking active screen interactivity
        (async () => {
            try {
                await Promise.all([
                    loadSessions(),
                    loadCoachStats(),
                    loadCoachPlayers(),
                    loadMatchData()
                ]);
            } catch (syncErr) {
                console.warn('[Sync] Non-blocking background sync warning:', syncErr);
            }
        })();

        // Broadcast to other open tabs
        broadcastSyncEvent('session', isLocked ? 'locked' : 'unlocked', { entityId: sessionId });
    } catch (err) {
        // Revert optimistic changes on error
        showToast('Error toggling session lock: ' + err.message, 'error');
        if (activeDetailsSession && activeDetailsSession._id === sessionId) {
            await openSessionDetailsView(sessionId);
        }
    } finally {
        isLocalMutationInProgress = false;
    }
}

let activeAttendanceModalPlayerId = null;

function renderPlayerAttendanceModal(player) {
    if (!player) return;
    activeAttendanceModalPlayerId = player._id;

    // Resolve attendance history from the server-enriched player record.
    // The fallback only considers saved sessions, never drafts.
    let historyItems = (player.attendanceHistory && player.attendanceHistory.length) ? player.attendanceHistory : [];
    if (!historyItems.length && cachedSessions && cachedSessions.length) {
        historyItems = cachedSessions
            .filter(s => (s.saved || s.locked) && (s.attendance || []).some(a => (a.player ? (a.player._id || a.player).toString() : '') === player._id))
            .map(s => {
                const entry = (s.attendance || []).find(a => (a.player ? (a.player._id || a.player).toString() : '') === player._id);
                return {
                    sessionId: s._id,
                    date: s.date,
                    sport: s.sport,
                    status: entry ? entry.status : 'absent'
                };
            });
    }

    const attRate = player.attendanceRate || 0;
    const presentSessions = player.presentSessions || 0;
    const totalSessions = player.totalSessions || 0;
    const isAttGreen = totalSessions > 0 && (presentSessions * 4 >= totalSessions * 3);
    const matchesPlayed = player.totalMatchesPlayed ?? player.matchCount ?? 0;
    const isMatchGreen = matchesPlayed >= 2;
    const isReady = player.isReady === true;

    const matchHistory = player.matchHistory || [];
    const matchHistoryHtml = matchHistory.length ? matchHistory.map(m => {
        const dateStr = new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const isPlayed = m.played === true;

        return `
            <div class="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/30 flex justify-between items-center text-xs">
                <div>
                    <span class="font-bold text-slate-900 dark:text-white block">${escapeHtml(m.title)}</span>
                    <span class="text-[11px] text-slate-400">${dateStr} &bull; vs ${escapeHtml(m.opponent)} &bull; ${escapeHtml(m.venue || '')}</span>
                    ${m.remarks ? `<span class="text-[10px] text-slate-400 italic block mt-0.5">${escapeHtml(m.remarks)}</span>` : ''}
                </div>
                <div class="text-right shrink-0">
                    ${isPlayed ? `
                        <span class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 inline-block">
                            Played &bull; ${m.score ?? 0} pts/goals
                        </span>
                    ` : `
                        <span class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-500 border border-slate-200 inline-block">
                            Did Not Play
                        </span>
                    `}
                </div>
            </div>
        `;
    }).join('') : `
        <p class="text-xs text-slate-400 text-center py-4">No completed match appearances recorded yet for this athlete.</p>
    `;

    const sessionHistoryHtml = historyItems.length ? historyItems.map(s => {
        const dateStr = new Date(s.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const isPresent = s.status === 'present';

        return `
            <div class="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/30 flex justify-between items-center text-xs">
                <div>
                    <span class="font-bold text-slate-900 dark:text-white block">${dateStr}</span>
                    <span class="text-[10px] text-slate-400">${s.sport || player.sport || ''} &bull; Training Session</span>
                </div>
                <div>
                    <span class="px-2.5 py-1 rounded-full text-[11px] font-bold ${isPresent
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                : 'bg-rose-500/15 text-rose-500 dark:text-rose-400 border border-rose-500/20'
            }">
                        ${isPresent ? '✓ PRESENT' : '✗ ABSENT'}
                    </span>
                </div>
            </div>
        `;
    }).join('') : `
        <p class="text-xs text-slate-400 text-center py-4">No individual training sessions recorded yet for this athlete.</p>
    `;

    const bodyHtml = `
        <div class="space-y-4">
            <!-- Athlete Profile Banner -->
            <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-full bg-brand-500/15 border-2 border-brand-500/40 flex items-center justify-center font-extrabold text-base text-brand-600">
                        ${(player.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <h4 class="font-extrabold text-base text-slate-900 dark:text-white leading-tight">${escapeHtml(player.name)}</h4>
                        <p class="text-xs text-slate-400">Age ${player.age} &bull; ${player.sport}</p>
                    </div>
                </div>
                <div>
                    ${isReady ? `
                        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30" title="Attendance >= 75% AND Matches Played >= 2">
                            <i data-lucide="check-circle" class="w-3.5 h-3.5 text-emerald-500"></i> READY
                        </span>
                    ` : `
                        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30" title="Needs >= 75% attendance and >= 2 matches played">
                            <i data-lucide="alert-circle" class="w-3.5 h-3.5 text-amber-500"></i> NOT READY
                        </span>
                    `}
                </div>
            </div>

            <!-- Key Benchmarks Cards Grid -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div class="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-slate-900/20 text-center">
                    <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Attendance</span>
                    <span class="text-lg font-extrabold ${isAttGreen ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'} block mt-0.5">
                        ${attRate}%
                    </span>
                    <span class="text-[10px] text-slate-400">${player.presentSessions || 0}/${player.totalSessions || 0} sessions</span>
                </div>
                <div class="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-slate-900/20 text-center">
                    <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Matches Played</span>
                    <span class="text-lg font-extrabold ${isMatchGreen ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'} block mt-0.5">
                        ${matchesPlayed} / ${player.totalSportMatches ?? 0}
                    </span>
                    <span class="text-[10px] text-slate-400">${player.totalSportMatches ? Math.round((matchesPlayed / player.totalSportMatches) * 100) + '% of sport matches' : (matchesPlayed >= 2 ? 'Benchmark met' : 'Needs ' + (2 - matchesPlayed) + ' more')}</span>
                </div>
                <div class="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-slate-900/20 text-center">
                    <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Squad Selected</span>
                    <span class="text-lg font-extrabold text-brand-600 dark:text-brand-400 block mt-0.5">
                        ${player.totalMatchesSelected || 0}
                    </span>
                    <span class="text-[10px] text-slate-400">Fixtures drafted</span>
                </div>
                <div class="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-slate-900/20 text-center">
                    <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Did Not Play</span>
                    <span class="text-lg font-extrabold text-slate-500 block mt-0.5">
                        ${player.totalMatchesNotPlayed || 0}
                    </span>
                    <span class="text-[10px] text-slate-400">Bench appearances</span>
                </div>
            </div>

            <!-- Match Participation History -->
            <div>
                <h5 class="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2 flex items-center justify-between">
                    <span>Match History</span>
                    <span class="text-[10px] font-normal text-slate-400">${matchHistory.length} completed fixture${matchHistory.length === 1 ? '' : 's'}</span>
                </h5>
                <div class="space-y-2 max-h-[22vh] overflow-y-auto pr-1">
                    ${matchHistoryHtml}
                </div>
            </div>

            <!-- Detailed Session Attendance Logs -->
            <div>
                <h5 class="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2 flex items-center justify-between">
                    <span>Training Attendance Log</span>
                    <span class="text-[10px] font-normal text-slate-400">${historyItems.length} session${historyItems.length === 1 ? '' : 's'}</span>
                </h5>
                <div class="space-y-2 max-h-[22vh] overflow-y-auto pr-1">
                    ${sessionHistoryHtml}
                </div>
            </div>
        </div>
    `;

    const modalButtons = [];
    if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'coach')) {
        modalButtons.push({
            label: 'Edit Athlete',
            class: 'px-4 py-2 rounded-xl text-xs font-bold bg-brand-600 text-white hover:bg-brand-700 cursor-pointer transition-all flex items-center gap-1.5',
            action: `closeModal(); openEditPlayerModal('${player._id}')`
        });
    }
    if (currentUser && currentUser.role === 'admin') {
        modalButtons.push({
            label: 'Remove Athlete',
            class: 'px-4 py-2 rounded-xl text-xs font-bold bg-rose-500/10 text-rose-600 hover:bg-rose-600 hover:text-white border border-rose-500/20 cursor-pointer transition-all flex items-center gap-1.5',
            action: `closeModal(); confirmRemovePlayer('${player._id}', '${escapeQuotes(player.name)}')`
        });
    }
    modalButtons.push({
        label: 'Close',
        class: 'px-5 py-2 rounded-xl text-sm font-bold bg-slate-900 dark:bg-slate-800 text-white hover:bg-slate-800 dark:hover:bg-slate-700 cursor-pointer',
        action: 'closeModal()'
    });

    openModal(
        `Athlete ERP Profile • ${player.name}`,
        bodyHtml,
        modalButtons,
        'max-w-xl'
    );
}

async function openPlayerAttendanceDetailModal(playerId) {
    let player = (cachedPlayers || []).find(p => p._id === playerId);

    // Fast render: Open modal immediately with cached data (0ms delay)
    if (player) {
        renderPlayerAttendanceModal(player);
    }

    // Refresh player and sessions from API non-blockingly in the background
    try {
        const [freshPlayers, freshSessions] = await Promise.all([
            api('/api/players').catch(() => null),
            api('/api/sessions').catch(() => [])
        ]);
        if (freshPlayers && freshPlayers.length) {
            cachedPlayers = freshPlayers;
            const found = cachedPlayers.find(p => p._id === playerId);
            if (found) {
                player = found;
                // If modal is still open and showing this athlete, seamlessly update content
                const modal = document.getElementById('app-modal');
                if (modal && !modal.classList.contains('hidden') && activeAttendanceModalPlayerId === playerId) {
                    renderPlayerAttendanceModal(player);
                }
            }
        }
        if (freshSessions && freshSessions.length) {
            cachedSessions = freshSessions;
        }
    } catch (e) { }

    if (!player) {
        try {
            const fetched = await api(`/api/players/${playerId}`);
            if (fetched) {
                player = fetched;
                renderPlayerAttendanceModal(player);
            }
        } catch (e) { }
    }
}
async function markAttendance(sessionId, playerId, status) {
    try {
        isLocalMutationInProgress = true;
        await api(`/api/sessions/${sessionId}/mark`, {
            method: 'PATCH',
            body: { playerId, status }
        });
        await Promise.all([
            loadSessions(),
            loadCoachStats(),
            loadCoachPlayers(),
            loadMatchData()
        ]);
        cachedPlayers = await api('/api/players');
        broadcastSyncEvent('attendance', 'updated', { entityId: sessionId });
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        isLocalMutationInProgress = false;
    }
}

// ── MATCH MANAGEMENT DASHBOARD & CALENDAR (PHASE 7-10) ──────────────────────
let currentCalendarDate = new Date();
let cachedMatchList = [];
let selectedCalendarDateStr = null;

function switchMatchTab(tabName) {
    document.querySelectorAll('.match-tab-btn').forEach(b => {
        b.className = 'match-tab-btn px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-2 cursor-pointer transition-colors whitespace-nowrap';
    });
    const activeBtn = document.getElementById(`match-tab-btn-${tabName}`);
    if (activeBtn) {
        activeBtn.className = 'match-tab-btn active px-4 py-2 text-xs sm:text-sm font-bold border-b-2 border-brand-500 text-brand-600 dark:text-brand-400 flex items-center gap-2 cursor-pointer transition-colors whitespace-nowrap';
    }

    document.querySelectorAll('.match-tab-content').forEach(c => c.classList.add('hidden'));
    const activeContent = document.getElementById(`match-tab-content-${tabName}`);
    if (activeContent) {
        activeContent.classList.remove('hidden');
    }

    if (tabName === 'calendar') {
        renderCalendarGrid();
    } else if (tabName === 'upcoming') {
        renderUpcomingMatchesTable();
    } else if (tabName === 'completed') {
        renderCompletedMatchesTable();
    }
    initIcons();
}

async function loadMatchData() {
    try {
        const matches = await api('/api/matches');
        cachedMatchList = matches || [];
        updateMatchDashboardSummary();

        // Render current active tab
        const activeTabBtn = document.querySelector('.match-tab-btn.active');
        const activeTab = activeTabBtn ? activeTabBtn.id.replace('match-tab-btn-', '') : 'calendar';
        switchMatchTab(activeTab);
    } catch (err) {
        console.error('Error loading matches:', err);
    }
}

function updateMatchDashboardSummary() {
    const total = cachedMatchList.length;
    const upcoming = cachedMatchList.filter(m => m.status === 'upcoming').length;
    const completed = cachedMatchList.filter(m => m.status === 'completed').length;

    let totalParticipations = 0;
    cachedMatchList.forEach(m => {
        if (m.entries && m.entries.length) {
            totalParticipations += m.entries.filter(e => e.result === 'played').length;
        } else if (m.selectedPlayers && m.selectedPlayers.length) {
            totalParticipations += m.selectedPlayers.length;
        }
    });

    const totalEl = document.getElementById('stat-total-matches');
    const upEl = document.getElementById('stat-upcoming-matches');
    const compEl = document.getElementById('stat-completed-matches');
    const partEl = document.getElementById('stat-total-participations');

    if (totalEl) totalEl.innerText = total;
    if (upEl) upEl.innerText = upcoming;
    if (compEl) compEl.innerText = completed;
    if (partEl) partEl.innerText = totalParticipations;
}

// ── CALENDAR COMPONENT ────────────────────────────────────────────────────────
function changeCalendarMonth(delta) {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + delta);
    renderCalendarGrid();
}

function goToCurrentCalendarMonth() {
    currentCalendarDate = new Date();
    renderCalendarGrid();
}

// ── Match Date Extraction Helper (UTC-aligned for zero timezone skew) ──────────
function getMatchDateParts(dateVal) {
    if (!dateVal) return { year: 0, month: 0, day: 0, dateStr: '' };
    if (typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateVal)) {
        const [y, m, d] = dateVal.substring(0, 10).split('-').map(Number);
        return { year: y, month: m - 1, day: d, dateStr: dateVal.substring(0, 10) };
    }
    const dt = new Date(dateVal);
    if (isNaN(dt.getTime())) return { year: 0, month: 0, day: 0, dateStr: '' };
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth();
    const d = dt.getUTCDate();
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return { year: y, month: m, day: d, dateStr };
}

function drawCalendarCells(monthMatches, year, month) {
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;

    // Only upcoming matches should be displayed in the calendar
    const upcomingMatches = (monthMatches || []).filter(m => m && m.status === 'upcoming');

    // Match map by day of month
    const matchMapByDay = new Map();
    upcomingMatches.forEach(m => {
        const parts = getMatchDateParts(m.date);
        if (parts.year === year && parts.month === month) {
            if (!matchMapByDay.has(parts.day)) matchMapByDay.set(parts.day, []);
            matchMapByDay.get(parts.day).push(m);
        }
    });

    // Calendar math
    const firstDayIndex = new Date(year, month, 1).getDay(); // 0 is Sunday
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
    const todayDate = today.getDate();

    let cellsHtml = '';

    // Prev month padding cells
    for (let i = firstDayIndex - 1; i >= 0; i--) {
        const d = daysInPrevMonth - i;
        cellsHtml += `
            <div class="min-h-[75px] sm:min-h-[90px] p-1.5 sm:p-2 rounded-xl bg-slate-100/30 dark:bg-slate-900/20 text-slate-400 opacity-40 select-none border border-transparent">
                <span class="text-xs font-semibold">${d}</span>
            </div>
        `;
    }

    // Active month day cells
    for (let day = 1; day <= daysInMonth; day++) {
        const dayMatches = matchMapByDay.get(day) || [];
        const isToday = isCurrentMonth && day === todayDate;
        const cellDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isSelected = selectedCalendarDateStr === cellDateStr;

        let badgesHtml = '';
        dayMatches.slice(0, 3).forEach(m => {
            let badgeColor = 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30';
            if (m.status === 'completed') badgeColor = 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
            if (m.status === 'cancelled') badgeColor = 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/30';

            const mId = m._id || m.id;
            badgesHtml += `
                <div onclick="event.stopPropagation(); openMatchDetailsModal('${mId}')" class="truncate text-[10px] sm:text-[11px] font-bold px-1.5 py-0.5 rounded border ${badgeColor} cursor-pointer hover:opacity-80 transition-opacity" title="${m.title} vs ${m.opponent} (${m.time})">
                    ${m.time ? m.time + ' ' : ''}${cleanOpponentName(m.opponent, m.sport) || cleanMatchTitle(m.title, m.sport)}
                </div>
            `;
        });
        if (dayMatches.length > 3) {
            badgesHtml += `<div class="text-[9px] font-bold text-slate-400">+${dayMatches.length - 3} more</div>`;
        }

        const todayBorder = isToday ? 'border-brand-500 dark:border-brand-400 ring-2 ring-brand-500/20' : 'border-slate-200/80 dark:border-slate-800/80';
        const selectedBg = isSelected ? 'bg-brand-500/10 dark:bg-brand-500/20' : 'bg-white/60 dark:bg-slate-900/40 hover:bg-white dark:hover:bg-slate-800/60';

        cellsHtml += `
            <div onclick="selectCalendarDay('${cellDateStr}', ${day})" class="min-h-[75px] sm:min-h-[90px] p-1.5 sm:p-2 rounded-xl border ${todayBorder} ${selectedBg} flex flex-col justify-between transition-all cursor-pointer group shadow-2xs">
                <div class="flex items-center justify-between">
                    <span class="text-xs sm:text-sm font-bold ${isToday ? 'text-brand-600 dark:text-brand-400 font-extrabold' : 'text-slate-700 dark:text-slate-300'}">${day}</span>
                    ${isToday ? '<span class="text-[9px] px-1 rounded bg-brand-500 text-white font-extrabold uppercase">Today</span>' : ''}
                </div>
                <div class="space-y-1 mt-1">
                    ${badgesHtml}
                </div>
            </div>
        `;
    }

    // Next month padding cells to complete 7-column grid
    const totalRendered = firstDayIndex + daysInMonth;
    const remaining = (7 - (totalRendered % 7)) % 7;
    for (let day = 1; day <= remaining; day++) {
        cellsHtml += `
            <div class="min-h-[75px] sm:min-h-[90px] p-1.5 sm:p-2 rounded-xl bg-slate-100/30 dark:bg-slate-900/20 text-slate-400 opacity-40 select-none border border-transparent">
                <span class="text-xs font-semibold">${day}</span>
            </div>
        `;
    }

    grid.innerHTML = cellsHtml;
    initIcons();
}

function renderSelectedDayPanel() {
    const titleEl = document.getElementById('calendar-day-panel-title');
    const countEl = document.getElementById('calendar-day-panel-count');
    const listEl = document.getElementById('calendar-day-matches-list');
    if (!titleEl || !countEl || !listEl) return;

    if (!selectedCalendarDateStr) {
        titleEl.innerText = 'Select a date to view fixtures';
        countEl.innerText = '0 matches';
        listEl.innerHTML = `
            <div class="py-6 text-center text-slate-400 text-xs">
                <i data-lucide="calendar" class="w-8 h-8 mx-auto mb-2 opacity-40"></i>
                <p>Click on any calendar day above to view scheduled fixtures or add new matches.</p>
            </div>
        `;
        initIcons();
        return;
    }

    const formattedDate = new Date(selectedCalendarDateStr + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    titleEl.innerText = `Fixtures for ${formattedDate}`;

    // Filter cached matches by target date (strictly upcoming fixtures only)
    const dayMatches = (cachedMatchList || []).filter(m => {
        if (m.status !== 'upcoming') return false;
        const parts = getMatchDateParts(m.date);
        return parts.dateStr === selectedCalendarDateStr;
    });

    countEl.innerText = `${dayMatches.length} match${dayMatches.length === 1 ? '' : 'es'}`;

    if (!dayMatches.length) {
        listEl.innerHTML = `
            <div class="py-6 text-center text-slate-400 text-xs">
                <i data-lucide="calendar-x" class="w-8 h-8 mx-auto mb-2 opacity-50"></i>
                <p>No matches scheduled on this day.</p>
                <button onclick="openAddMatchModal('${selectedCalendarDateStr}')" class="mt-2 text-brand-600 dark:text-brand-400 font-bold hover:underline cursor-pointer">+ Schedule Match</button>
            </div>
        `;
        initIcons();
        return;
    }

    listEl.innerHTML = dayMatches.map(m => {
        let badgeClass = 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20';
        if (m.status === 'completed') badgeClass = 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
        if (m.status === 'cancelled') badgeClass = 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20';

        const matchId = m._id || m.id;
        const canDelete = m.status === 'cancelled' || m.status === 'upcoming';

        return `
            <div class="p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 flex items-center justify-between gap-3 hover:bg-white dark:hover:bg-slate-900 transition-colors">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/20 text-brand-600 flex items-center justify-center font-bold text-xs shrink-0">
                        ${m.time || '10:00'}
                    </div>
                    <div>
                        <div class="flex items-center gap-2">
                            <h5 class="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">${escapeHtml(cleanMatchTitle(m.title, m.sport))}</h5>
                            <span class="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border ${badgeClass}">${m.status}</span>
                        </div>
                        <p class="text-[11px] text-slate-500 mt-0.5">${m.sport} &bull; vs ${escapeHtml(cleanOpponentName(m.opponent, m.sport))} &bull; ${escapeHtml(m.venue || 'Academy Ground')}</p>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="openMatchDetailsModal('${matchId}')" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer">
                        View Details
                    </button>
                    ${canDelete ? `
                        <button onclick="confirmDeleteMatch('${matchId}', '${escapeQuotes(cleanMatchTitle(m.title, m.sport))}')" class="p-2 rounded-lg text-xs font-bold bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 border border-rose-500/20 cursor-pointer transition-colors" title="Delete Match">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
    initIcons();
}

async function renderCalendarGrid() {
    const grid = document.getElementById('calendar-grid');
    const heading = document.getElementById('calendar-month-heading');
    if (!grid || !heading) return;

    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

    heading.innerText = currentCalendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    // 1. Instant render from cached matches (strictly upcoming only)
    let monthMatches = (cachedMatchList || []).filter(m => {
        if (m.status !== 'upcoming') return false;
        const parts = getMatchDateParts(m.date);
        return parts.year === year && parts.month === month;
    });
    drawCalendarCells(monthMatches, year, month);
    renderSelectedDayPanel();

    // 2. Fetch fresh month matches in background (backend strictly returns upcoming only)
    api(`/api/matches/calendar?month=${monthStr}`).then(fresh => {
        if (Array.isArray(fresh)) {
            // Update cachedMatchList for these items
            const freshMap = new Map(fresh.map(f => [(f._id || f.id).toString(), f]));
            cachedMatchList = (cachedMatchList || []).map(m => freshMap.get((m._id || m.id).toString()) || m);
            drawCalendarCells(fresh, year, month);
            renderSelectedDayPanel();
        }
    }).catch(err => {
        console.error('Error refreshing calendar matches:', err);
    });
}

function selectCalendarDay(dateStr, dayNum) {
    selectedCalendarDateStr = dateStr;
    renderCalendarGrid();
    renderSelectedDayPanel();
}

function confirmDeleteMatch(matchId, matchTitle) {
    const html = `
        <div class="space-y-4">
            <div class="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300 text-xs">
                <p class="font-bold text-sm mb-1">Permanently remove this match?</p>
                <p class="opacity-80">"${escapeHtml(matchTitle || 'This match')}" will be completely deleted from your academy calendar and schedule records. This cannot be undone.</p>
            </div>
        </div>
    `;

    openModal(
        'Delete Match',
        html,
        [
            { label: 'Cancel', class: 'px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer', action: 'closeModal()' },
            { label: 'Yes, Delete Match', class: 'px-5 py-2 rounded-xl text-sm font-bold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer shadow-xs', action: `executeDeleteMatch('${matchId}')` }
        ],
        'max-w-md'
    );
}

async function executeDeleteMatch(matchId) {
    try {
        isLocalMutationInProgress = true;
        await api(`/api/matches/${matchId}`, {
            method: 'DELETE'
        });
        showToast('Match deleted successfully.', 'info');
        closeModal();

        // Optimistically remove from cachedMatchList immediately
        cachedMatchList = (cachedMatchList || []).filter(m => (m._id || m.id).toString() !== matchId.toString());
        updateMatchDashboardSummary();
        renderCalendarGrid();
        renderSelectedDayPanel();
        renderUpcomingMatchesTable();
        renderCompletedMatchesTable();

        await loadMatchData();
        renderCalendarGrid();
        renderSelectedDayPanel();
        if (currentActivePageId === 'coach-matches') {
            const activeTabBtn = document.querySelector('.match-tab-btn.active');
            const activeTab = activeTabBtn ? activeTabBtn.id.replace('match-tab-btn-', '') : 'upcoming';
            switchMatchTab(activeTab);
        } else {
            switchPage('coach-matches');
        }
        broadcastSyncEvent('match', 'deleted', { entityId: matchId });
    } catch (err) {
        showToast(err.message || 'Failed to delete match', 'error');
    } finally {
        isLocalMutationInProgress = false;
    }
}

// ── MATCH ELIGIBILITY & SCHEDULE HELPERS ──────────────────────────────────
function getMatchEligiblePlayersCount(m) {
    if (!m) return 0;
    if (typeof m.totalEligiblePlayers === 'number' && m.totalEligiblePlayers >= 0) {
        return m.totalEligiblePlayers;
    }
    if (typeof m.eligiblePlayersCount === 'number' && m.eligiblePlayersCount >= 0) {
        return m.eligiblePlayersCount;
    }
    if (Array.isArray(cachedSessions) && cachedSessions.length > 0) {
        const mDate = new Date(m.date);
        const mDateStr = getTodayIstString(mDate);
        const session = cachedSessions.find(s => {
            if (s.sport !== m.sport) return false;
            const sDateStr = getTodayIstString(s.date);
            return sDateStr === mDateStr && (s.saved || s.locked);
        });
        if (session && Array.isArray(session.attendance)) {
            return session.attendance.filter(a => a.player && a.status === 'present').length;
        }
    }
    return (m.selectedPlayers || []).length;
}

// ── CLEAN PROFESSIONAL MATCH & OPPONENT NAME SANITIZERS ──────────────────
function cleanMatchTitle(title, sport) {
    if (!title || typeof title !== 'string') {
        return sport ? `${sport} Championship` : 'Friendly Derby';
    }
    let t = title.trim();

    // If opponent is embedded as 'vs ...' in title, strip it
    if (/\bvs\b/i.test(t)) {
        t = t.split(/\bvs\b/i)[0].trim();
    }

    // Remove raw MongoDB ObjectIds (24 hex characters)
    if (/^[0-9a-fA-F]{24}$/.test(t)) {
        return sport ? `${sport} Championship` : 'Friendly Derby';
    }

    // Strip date formats: e.g. 2029-11-09, 2028/10/12, etc.
    t = t.replace(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g, '');

    // Strip timestamps, random IDs, numbers and trailing numeric suffixes (e.g. 1793802588342, 931077, _123, 95897)
    t = t.replace(/_+\d+/g, '').replace(/-\d+/g, '').replace(/#\d+/g, '').replace(/\b\d+\w*\b/g, '');

    // Strip test / automation keywords
    t = t.replace(/\b(Auto-Squad|Squad Update|Update Test|Squad|Update|Testing|Test|12Step|Step|Lock Rule|Reschedule|Time Test)\b/gi, '');

    // Clean remaining punctuation and whitespace
    t = t.replace(/[\-_]+/g, ' ').replace(/\s+/g, ' ').trim();

    // If title became empty or generic test artifact, provide clean professional 1-2 word name
    if (!t || /^Time(\s+Cup)?$/i.test(t) || /^Rule$/i.test(t)) {
        return sport ? `${sport} Championship` : 'Friendly Derby';
    }

    // If only single word remains that is too generic
    if (/^(Cup|Derby|Championship|Match)$/i.test(t)) {
        return sport ? `${sport} ${t}` : `Friendly ${t}`;
    }

    // If only sport remains, e.g. 'Football'
    if (sport && t.toLowerCase() === sport.toLowerCase()) {
        return `${sport} Championship`;
    }

    // Keep names ideally between 1 and 2 words (max 3 for specific cups)
    const words = t.split(' ').filter(Boolean);
    if (words.length > 2) {
        if (words[0].toLowerCase() === 'future' && words[1].toLowerCase() === 'championship') {
            return 'Future Championship';
        }
        if (words[0].toLowerCase() === 'state' && words[1].toLowerCase() === 't20') {
            return 'State T20 Cup';
        }
        if (words[0].toLowerCase() === 'inter' && words[1].toLowerCase() === 'district') {
            return 'Inter-District Cup';
        }
        return words.slice(0, 2).join(' ');
    }

    return t;
}

function cleanOpponentName(opponent, sport) {
    if (!opponent || typeof opponent !== 'string') {
        return 'Jamshedpur FC';
    }
    let op = opponent.trim();

    // Exact user requirement example: 'Jamshedpur FC' instead of 'Rivals_...'
    if (/^Rivals?(_|\b|$)/i.test(op)) {
        return 'Jamshedpur FC';
    }

    // Remove generic Opponent ...
    if (/^Opponent(\b|_|$)/i.test(op)) {
        return 'Jamshedpur FC';
    }

    // Remove MongoDB ObjectId
    if (/^[0-9a-fA-F]{24}$/.test(op)) {
        return 'Jamshedpur FC';
    }

    // Dates & Numbers
    op = op.replace(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g, '');
    op = op.replace(/_+\d+/g, '').replace(/-\d+/g, '').replace(/#\d+/g, '').replace(/\b\d+\w*\b/g, '');
    op = op.replace(/\b(Test|Dummy)\b/gi, '');
    op = op.replace(/[\-_]+/g, ' ').replace(/\s+/g, ' ').trim();

    if (!op || op.toLowerCase() === 'future') {
        return 'Future Titans';
    }

    if (/^Thunderbolts$/i.test(op)) {
        return 'Thunderbolts FC';
    }

    const words = op.split(' ').filter(Boolean);
    if (words.length > 2) {
        return words.slice(0, 2).join(' ');
    }
    return op;
}

// ── TIME-BASED MATCH SCHEDULE & STATUS HELPER ─────────────────────────────
function getClientMatchScheduleInfo(m) {
    if (!m) return { timeStatus: 'upcoming', isUnlocked: false, unlockTimeStr: '' };
    if (m.status === 'completed') return { timeStatus: 'completed', isUnlocked: true, unlockTimeStr: '' };
    if (m.status === 'cancelled') return { timeStatus: 'cancelled', isUnlocked: false, unlockTimeStr: '' };

    let unlockDate;
    if (m.unlockDateTime) {
        unlockDate = new Date(m.unlockDateTime);
    } else {
        const matchDate = new Date(m.date);
        let year = matchDate.getFullYear();
        let month = matchDate.getMonth();
        let day = matchDate.getDate();
        if (typeof m.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(m.date)) {
            const [y, mon, d] = m.date.slice(0, 10).split('-').map(Number);
            year = y; month = mon - 1; day = d;
        }
        let hours = 0, minutes = 0;
        if (m.time) {
            const tStr = m.time.trim().toLowerCase();
            const isPM = tStr.includes('pm');
            const isAM = tStr.includes('am');
            const clean = tStr.replace(/[ap]m/, '').trim();
            const parts = clean.split(':').map(p => parseInt(p, 10));
            if (!isNaN(parts[0])) {
                hours = parts[0];
                minutes = parts.length > 1 && !isNaN(parts[1]) ? parts[1] : 0;
                if (isPM && hours < 12) hours += 12;
                if (isAM && hours === 12) hours = 0;
            }
        }
        const kickoff = new Date(year, month, day, hours, minutes, 0, 0);
        unlockDate = new Date(kickoff.getTime() + 60 * 60 * 1000);
    }

    const now = new Date();
    const isUnlocked = m.isScoringUnlocked !== undefined ? m.isScoringUnlocked : (now >= unlockDate);

    let timeStatus = m.timeStatus;
    if (!timeStatus) {
        const kickoff = new Date(unlockDate.getTime() - 60 * 60 * 1000);
        if (now < kickoff) timeStatus = 'upcoming';
        else if (now < unlockDate) timeStatus = 'in_progress';
        else timeStatus = 'scoring_available';
    }

    const unlockTimeStr = unlockDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return { timeStatus, isUnlocked, unlockTimeStr, unlockDate };
}

// ── Standard Playing-Team Sizes for Sports ──────────────────────
const STANDARD_TEAM_SIZES = {
    'cricket': 11,
    'football': 11,
    'basketball': 5,
    'volleyball': 6,
    'field hockey': 11,
    'hockey': 11,
    'kabaddi': 7,
    'badminton singles': 1,
    'badminton doubles': 2,
    'badminton': 1
};

function getStandardTeamSize(sport) {
    if (!sport || typeof sport !== 'string') return 11;
    const key = sport.trim().toLowerCase();
    if (STANDARD_TEAM_SIZES[key] !== undefined) {
        return STANDARD_TEAM_SIZES[key];
    }
    return 11;
}

// ── UPCOMING MATCHES LIST ─────────────────────────────────────────────────────
function renderUpcomingMatchesTable() {
    const tbody = document.getElementById('upcoming-matches-table-body');
    if (!tbody) return;

    const upcomingMatches = cachedMatchList.filter(m => m.status === 'upcoming');
    if (!upcomingMatches.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="py-12 text-center text-slate-400">
                    <i data-lucide="calendar-check" class="w-8 h-8 mx-auto mb-2 opacity-50"></i>
                    <p class="text-xs font-semibold">No upcoming fixtures scheduled.</p>
                    <button onclick="openAddMatchModal()" class="mt-2 text-brand-600 dark:text-brand-400 text-xs font-bold hover:underline cursor-pointer">+ Schedule New Match</button>
                </td>
            </tr>
        `;
        initIcons();
        return;
    }

    tbody.innerHTML = upcomingMatches.map(m => {
        const matchId = (m._id || m.id || '').toString();
        const dateStr = new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const cleanTitle = cleanMatchTitle(m.title, m.sport);
        const cleanOpponent = cleanOpponentName(m.opponent, m.sport);

        return `
            <tr onclick="openManageMatchPlayersModal('${matchId}')" class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer border-b border-slate-200/80 dark:border-slate-800/80">
                <td class="py-4 px-5 sm:px-6 font-bold text-slate-900 dark:text-white border-r border-slate-200/80 dark:border-slate-800/80 text-sm">${escapeHtml(cleanTitle)}</td>
                <td class="py-4 px-5 sm:px-6 border-r border-slate-200/80 dark:border-slate-800/80">
                    <span class="px-2.5 py-1 rounded-md text-xs font-bold bg-brand-500/10 text-brand-600 dark:text-brand-400 border border-brand-500/20">${escapeHtml(m.sport)}</span>
                </td>
                <td class="py-4 px-5 sm:px-6 border-r border-slate-200/80 dark:border-slate-800/80 font-medium text-sm text-slate-700 dark:text-slate-300">${dateStr} &bull; ${escapeHtml(m.time)}</td>
                <td class="py-4 px-5 sm:px-6 font-semibold border-r border-slate-200/80 dark:border-slate-800/80 text-sm">${escapeHtml(cleanOpponent)}</td>
                <td class="py-4 px-5 sm:px-6 text-slate-500 dark:text-slate-400 border-r border-slate-200/80 dark:border-slate-800/80 text-sm">${escapeHtml(m.venue)}</td>
                <td class="py-4 px-5 sm:px-6 text-right">
                    <button onclick="event.stopPropagation(); openManageMatchPlayersModal('${matchId}')" class="px-4 py-2 rounded-xl text-sm font-bold bg-brand-600 hover:bg-brand-700 text-white shadow-xs transition-colors cursor-pointer inline-flex items-center gap-1.5" title="Manage Match">
                        <i data-lucide="settings-2" class="w-4 h-4"></i>
                        <span>Manage Match</span>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    initIcons();
}

// ── COMPLETED MATCHES LIST ────────────────────────────────────────────────────
function renderCompletedMatchesTable() {
    const tbody = document.getElementById('completed-matches-table-body');
    if (!tbody) return;

    const completedMatches = cachedMatchList.filter(m => m.status === 'completed');
    if (!completedMatches.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="py-12 text-center text-slate-400">
                    <i data-lucide="trophy" class="w-8 h-8 mx-auto mb-2 opacity-50"></i>
                    <p class="text-xs font-semibold">No completed fixtures recorded yet.</p>
                </td>
            </tr>
        `;
        initIcons();
        return;
    }

    tbody.innerHTML = completedMatches.map(m => {
        const dateStr = new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const parts = m.participations || [];
        const playedParts = parts.filter(p => p.played === true && !p.attendanceConflict);
        const playedCount = m.totalPlayed !== undefined ? m.totalPlayed : playedParts.length;
        const totalSquad = (m.selectedPlayers || parts || m.entries || []).length;

        const cleanTitle = cleanMatchTitle(m.title, m.sport);
        const cleanOpponent = cleanOpponentName(m.opponent, m.sport);

        const matchId = (m._id || m.id || '').toString();

        return `
            <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors border-b border-slate-200/80 dark:border-slate-800/80">
                <td class="py-4 px-5 sm:px-6 border-r border-slate-200/80 dark:border-slate-800/80">
                    <div class="flex flex-col">
                        <div class="flex items-center gap-2">
                            <span class="font-bold text-slate-900 dark:text-white text-sm sm:text-base">${escapeHtml(cleanTitle)}</span>
                            ${m.hasConflict ? `<span class="px-2 py-0.5 rounded text-xs font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20" title="${escapeHtml(m.conflictMessage || 'Attendance conflict')}">⚠️ Conflict</span>` : ''}
                        </div>
                        <span class="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">
                            <span class="font-normal text-slate-400 dark:text-slate-500">vs</span> ${escapeHtml(cleanOpponent)}
                        </span>
                    </div>
                </td>
                <td class="py-4 px-5 sm:px-6 border-r border-slate-200/80 dark:border-slate-800/80">
                    <span class="px-2.5 py-1 rounded-md text-xs font-bold bg-brand-500/10 text-brand-600 dark:text-brand-400 border border-brand-500/20">${escapeHtml(m.sport)}</span>
                </td>
                <td class="py-4 px-5 sm:px-6 border-r border-slate-200/80 dark:border-slate-800/80 font-medium text-sm text-slate-700 dark:text-slate-300">
                    ${dateStr} &bull; ${escapeHtml(m.time)}
                </td>
                <td class="py-4 px-5 sm:px-6 text-center border-r border-slate-200/80 dark:border-slate-800/80">
                    <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs sm:text-sm font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        <i data-lucide="users" class="w-4 h-4"></i>
                        <span>${playedCount} / ${totalSquad} Played</span>
                    </span>
                </td>
                <td class="py-4 px-5 sm:px-6 text-right">
                    <button onclick="openMatchResultModal('${matchId}')" class="px-4 py-2 rounded-xl text-sm font-bold bg-brand-600 hover:bg-brand-700 text-white shadow-xs transition-colors cursor-pointer inline-flex items-center gap-1.5">
                        <i data-lucide="award" class="w-4 h-4"></i>
                        <span>View Result</span>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    initIcons();
}

// ── MATCH HISTORY TAB ─────────────────────────────────────────────────────────
async function loadHistoryTab() {
    await applyHistoryFilters();
}

async function applyHistoryFilters() {
    const opponent = (document.getElementById('history-filter-opponent')?.value || '').trim();
    const sport = (document.getElementById('history-filter-sport')?.value || '').trim();
    const startDate = (document.getElementById('history-filter-start')?.value || '').trim();
    const endDate = (document.getElementById('history-filter-end')?.value || '').trim();

    const queryParams = new URLSearchParams();
    if (opponent) queryParams.set('opponent', opponent);
    if (sport) queryParams.set('sport', sport);
    if (startDate) queryParams.set('startDate', startDate);
    if (endDate) queryParams.set('endDate', endDate);

    try {
        const history = await api(`/api/matches/history?${queryParams.toString()}`);
        renderHistoryCards(history || []);
    } catch (err) {
        console.error('Error fetching match history:', err);
    }
}

function resetHistoryFilters() {
    if (document.getElementById('history-filter-opponent')) document.getElementById('history-filter-opponent').value = '';
    if (document.getElementById('history-filter-sport')) document.getElementById('history-filter-sport').value = '';
    if (document.getElementById('history-filter-start')) document.getElementById('history-filter-start').value = '';
    if (document.getElementById('history-filter-end')) document.getElementById('history-filter-end').value = '';
    applyHistoryFilters();
}

function renderHistoryCards(historyList) {
    const container = document.getElementById('history-matches-list');
    if (!container) return;

    if (!historyList.length) {
        container.innerHTML = `
            <div class="p-12 text-center text-slate-400">
                <i data-lucide="history" class="w-8 h-8 mx-auto mb-2 opacity-50"></i>
                <p class="text-xs font-semibold">No match history matches your filters.</p>
            </div>
        `;
        initIcons();
        return;
    }

    container.innerHTML = historyList.map(m => {
        const dateStr = new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const playedCount = m.totalPlayed !== undefined ? m.totalPlayed : (m.entries || []).filter(e => e.result === 'played').length;

        return `
            <div class="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-white/40 dark:hover:bg-slate-800/40 transition-colors">
                <div class="flex items-start sm:items-center gap-3">
                    <div class="w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 flex items-center justify-center font-bold shrink-0">
                        <i data-lucide="trophy" class="w-5 h-5"></i>
                    </div>
                    <div>
                        <div class="flex items-center gap-2">
                            <h4 class="font-bold text-sm sm:text-base text-slate-900 dark:text-white">${escapeHtml(cleanMatchTitle(m.title, m.sport))}</h4>
                            <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">COMPLETED</span>
                            ${m.hasConflict ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20">⚠️ Conflict</span>` : ''}
                        </div>
                        <p class="text-xs text-slate-500 mt-1">
                            ${m.sport} &bull; vs <span class="font-semibold text-slate-700 dark:text-slate-300">${escapeHtml(cleanOpponentName(m.opponent, m.sport))}</span> &bull; ${dateStr} at ${m.time} &bull; ${m.venue}
                        </p>
                    </div>
                </div>
                <div class="flex items-center gap-3 sm:self-center">
                    <span class="text-xs font-bold px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        ${playedCount} Players Scored
                    </span>
                    <button onclick="openMatchDetailsModal('${m._id || m.id}')" class="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-brand-600 hover:bg-brand-700 text-white transition-colors cursor-pointer">
                        Match Details
                    </button>
                </div>
            </div>
        `;
    }).join('');
    initIcons();
}

// ── Helper to Determine Player Performance Score and Star Qualification ──
function calculatePlayerPerformanceScore(player) {
    if (typeof player.performanceScore === 'number') {
        return player.performanceScore;
    }
    // Fallback: calculate average from player's actual Played match scores (excluding Did Not Play or conflicted matches)
    const scoredMatches = (player.matchHistory || []).filter(
        m => m.played === true && !m.attendanceConflict && m.score !== null && m.score !== undefined
    );
    if (!scoredMatches.length) return null;
    const totalScore = scoredMatches.reduce((acc, m) => acc + Number(m.score), 0);
    return Math.round((totalScore / scoredMatches.length) * 10) / 10;
}

let cachedReadyPlayersForScout = [];

// ── Scout View: Only Ready Players (Spec Check 3 & 4) ──
async function loadScoutPlayers() {
    const tbody = document.getElementById('scout-players-tbody');
    if (!tbody) return;

    try {
        tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-sm text-slate-400">Loading scout evaluations from database...</td></tr>';
        const readyPlayers = await api('/api/scout/ready');
        cachedReadyPlayersForScout = readyPlayers || [];

        if (!readyPlayers.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="px-6 py-8 text-center text-slate-500">
                        No players currently meet the Ready criteria (&ge;75% attendance and &ge;2 matches played).
                    </td>
                </tr>`;
            return;
        }

        tbody.innerHTML = readyPlayers.map(p => {
            const perfScore = calculatePlayerPerformanceScore(p);
            const hasStar = (typeof p.hasPerformanceStar === 'boolean') ? p.hasPerformanceStar : (perfScore !== null && perfScore >= 15);
            const starHtml = hasStar
                ? `<span class="inline-flex items-center text-amber-400 ml-1.5 cursor-help" title="Performance score: 15 or above${perfScore !== null ? ` (Avg: ${perfScore})` : ''}" aria-label="Performance score: 15 or above">⭐</span>`
                : '';

            return `
            <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors border-b border-slate-200/80 dark:border-slate-800/80">
                <td class="px-6 py-4.5 flex items-center gap-3.5 border-r border-slate-200/80 dark:border-slate-800/80">
                    <img src="https://i.pravatar.cc/150?u=${p._id}" class="w-11 h-11 rounded-full border-2 border-brand-500/40 shadow-xs shrink-0">
                    <div>
                        <p class="font-bold text-base text-slate-900 dark:text-white flex items-center leading-tight">
                            <span>${p.name}</span>${starHtml}
                        </p>
                        <p class="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">${p.coach ? 'Coach: ' + p.coach.name : 'Dumka Academy'}</p>
                    </div>
                </td>
                <td class="px-6 py-4.5 text-sm font-semibold text-slate-700 dark:text-slate-300 border-r border-slate-200/80 dark:border-slate-800/80">${p.sport} &bull; Age ${p.age}</td>
                <td class="px-6 py-4.5 border-r border-slate-200/80 dark:border-slate-800/80">
                    <span class="font-extrabold text-brand-600 dark:text-brand-400 text-base">${p.attendanceRate}%</span>
                    <span class="text-xs text-slate-500 dark:text-slate-400 font-medium ml-1">(${p.presentSessions || 0}/${p.totalSessions || 0} sessions)</span>
                </td>
                <td class="px-6 py-4.5 font-bold text-sm text-slate-800 dark:text-slate-200 border-r border-slate-200/80 dark:border-slate-800/80">${p.matchesPlayed ?? p.matchCount ?? 0} matches</td>
                <td class="px-6 py-4.5 text-right">
                    <span class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 shadow-2xs">
                        <i data-lucide="check-circle" class="w-3.5 h-3.5 text-emerald-500"></i>
                        <span>Trial Eligible</span>
                    </span>
                </td>
            </tr>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-4 text-rose-500">Error: ${err.message}</td></tr>`;
    }
}

// ── Export Scout Ready Players Report to PDF ────────────────────────────────
async function exportScoutReportPDF() {
    try {
        let players = cachedReadyPlayersForScout;
        if (!players || !players.length) {
            // Fetch directly if not yet in cache
            players = await api('/api/scout/ready');
            cachedReadyPlayersForScout = players || [];
        }

        if (!players || !players.length) {
            showToast('No Ready Players available to export.', 'info');
            return;
        }

        // Check jsPDF availability
        const { jsPDF } = window.jspdf || {};
        if (!jsPDF) {
            showToast('PDF generator library loading failed. Please refresh and try again.', 'error');
            return;
        }

        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'pt',
            format: 'a4'
        });

        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const generatedDate = new Date().toLocaleDateString('en-US', {
            timeZone: 'Asia/Kolkata',
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        // 1. Academy Branding Header
        doc.setFillColor(15, 23, 42); // slate-900 / dark brand
        doc.rect(0, 0, pageWidth, 85, 'F');

        // Brand Title & Tagline
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(20);
        doc.setTextColor(255, 255, 255);
        doc.text('Maidan Desk', 40, 38);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(52, 211, 153); // emerald-400
        doc.text('Dumka Sports Academy • Advanced Scouting Division', 40, 54);

        doc.setFontSize(9);
        doc.setTextColor(148, 163, 184); // slate-400
        doc.text(`Generated: ${generatedDate} (IST)`, 40, 68);

        // Report Title
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(15, 23, 42);
        doc.text('Ready Players Report', 40, 115);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(100, 116, 139);
        doc.text('Athletes meeting official trial readiness criteria (Attendance >= 75%, Matches Played >= 2)', 40, 130);

        // Legend / Indicator notice
        doc.setFontSize(8.5);
        doc.setTextColor(71, 85, 105);
        doc.text('[*] Star indicates high-performance athlete with performance score >= 15', 40, 144);

        // Prepare table data
        const tableRows = players.map(p => {
            const perfScore = calculatePlayerPerformanceScore(p);
            const hasStar = (typeof p.hasPerformanceStar === 'boolean') ? p.hasPerformanceStar : (perfScore !== null && perfScore >= 15);
            const starIndicator = hasStar ? ' [*]' : '';
            const playerNameWithStar = `${p.name || 'Unknown'}${starIndicator}`;
            const sport = p.sport || 'General';
            const age = p.age ? String(p.age) : '—';
            const attendance = `${p.attendanceRate ?? 0}% (${p.presentSessions || 0}/${p.totalSessions || 0})`;
            const matchesPlayed = `${p.matchesPlayed ?? p.matchCount ?? 0} matches`;
            const status = 'Trial Eligible';

            return [
                playerNameWithStar,
                sport,
                age,
                attendance,
                matchesPlayed,
                status
            ];
        });

        // 2. Render Table with autoTable
        doc.autoTable({
            startY: 155,
            head: [['Player Name', 'Sport', 'Age', 'Attendance Rate', 'Matches Played', 'Status']],
            body: tableRows,
            theme: 'grid',
            headStyles: {
                fillColor: [15, 23, 42],
                textColor: [255, 255, 255],
                fontStyle: 'bold',
                fontSize: 9,
                halign: 'left',
                cellPadding: 7
            },
            bodyStyles: {
                textColor: [30, 41, 59],
                fontSize: 9,
                cellPadding: 6.5
            },
            columnStyles: {
                0: { cellWidth: 140, fontStyle: 'bold' },
                1: { cellWidth: 75 },
                2: { cellWidth: 40, halign: 'center' },
                3: { cellWidth: 110 },
                4: { cellWidth: 80, halign: 'center' },
                5: { cellWidth: 70, halign: 'center', textColor: [16, 185, 129], fontStyle: 'bold' }
            },
            alternateRowStyles: {
                fillColor: [248, 250, 252]
            },
            margin: { left: 40, right: 40 },
            didDrawPage: (data) => {
                // Page numbers & footer
                const pageCount = doc.internal.getNumberOfPages();
                doc.setFontSize(8);
                doc.setTextColor(148, 163, 184);
                doc.text(
                    `Page ${data.pageNumber} of ${pageCount}`,
                    pageWidth - 40,
                    pageHeight - 20,
                    { align: 'right' }
                );
                doc.text(
                    'Maidan Desk – Confidential Scout Assessment Report',
                    40,
                    pageHeight - 20
                );
            }
        });

        // 3. Save / Download PDF
        const safeDateStr = getTodayIstString();
        doc.save(`Maidan_Desk_Ready_Players_Report_${safeDateStr}.pdf`);
        showToast('Ready Players Report exported successfully.', 'success');
    } catch (err) {
        console.error('Error exporting PDF:', err);
        showToast(`PDF Export failed: ${err.message}`, 'error');
    }
}

// ── Player View: Shows ONLY their own row and matches (Spec Check 4) ──
async function loadPlayerData() {
    try {
        const me = await api('/api/players/me');
        if (!me) return;

        // Top Header and Dashboard greetings
        const nameDisplay = document.getElementById('player-profile-name');
        const attDisplay = document.getElementById('player-stat-attendance');
        const matchDisplay = document.getElementById('player-stat-matches');
        const sessDisplay = document.getElementById('player-stat-sessions');
        const readyDisplay = document.getElementById('player-stat-ready');

        const matchesPlayed = me.totalMatchesPlayed ?? me.matchCount ?? 0;
        const matchesSelected = me.totalMatchesSelected || 0;

        const playerUsername = me.playerId || me.username || currentUser?.username || '';
        const userBadge = document.getElementById('player-username-badge');
        if (userBadge) {
            userBadge.innerText = playerUsername ? `@${playerUsername}` : '';
            userBadge.style.display = playerUsername ? 'inline-block' : 'none';
        }

        if (nameDisplay) nameDisplay.innerText = me.name;
        if (attDisplay) attDisplay.innerText = `${me.attendanceRate || 0}%`;
        const attDesc = document.getElementById('player-stat-attendance-desc');
        if (attDesc) attDesc.innerText = `${me.presentSessions || 0} of ${me.totalSessions || 0} sessions`;
        if (matchDisplay) matchDisplay.innerText = matchesPlayed;
        if (sessDisplay) sessDisplay.innerText = me.presentSessions || 0;
        if (readyDisplay) {
            readyDisplay.innerText = me.isReady ? 'Ready for Trial' : 'In Training';
            readyDisplay.className = me.isReady ? 'text-xl font-extrabold text-emerald-400' : 'text-xl font-extrabold text-slate-400';
        }

        // Side Profile Summary Card (Inside Player Overview)
        const cardName = document.getElementById('player-profile-card-name');
        const cardSub = document.getElementById('player-profile-card-sub');
        const cardStatus = document.getElementById('player-profile-card-status');
        const journeyStatus = document.getElementById('player-journey-status');

        if (cardName) cardName.innerText = me.name;
        if (cardSub) cardSub.innerText = `${me.sport} \u2022 Age ${me.age} \u2022 ${playerUsername}`;
        if (cardStatus) {
            cardStatus.innerText = me.isReady ? 'Trial Eligible' : 'Active Athlete';
            cardStatus.className = me.isReady
                ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-3 py-1 rounded-md text-xs font-bold border border-emerald-500/30'
                : 'bg-brand-500/20 text-brand-700 dark:text-brand-400 px-3 py-1 rounded-md text-xs font-bold border border-brand-500/30';
        }
        if (journeyStatus) journeyStatus.innerText = me.isReady ? 'Ready for Scout Trial' : 'In Training';

        // Dedicated "My Profile" Page View (view-player-profile)
        const detailName = document.getElementById('player-profile-detail-name');
        const detailSub = document.getElementById('player-profile-detail-sub');
        const detailCoach = document.getElementById('player-profile-detail-coach');
        const detailBatch = document.getElementById('player-profile-detail-batch');
        const detailReady = document.getElementById('player-profile-detail-ready');
        const detailMatches = document.getElementById('player-profile-detail-matches');
        const detailUsername = document.getElementById('player-profile-detail-username');
        const ratingDisplay = document.getElementById('player-stat-rating');

        if (ratingDisplay) ratingDisplay.innerText = me.rating ? me.rating : 'Pending';
        if (detailUsername) detailUsername.innerText = playerUsername || 'Not Assigned';
        if (detailName) detailName.innerText = me.name;
        if (detailSub) detailSub.innerText = `${me.sport} \u2022 Age ${me.age} \u2022 Username: ${playerUsername}`;
        if (detailCoach) detailCoach.innerText = me.coach ? (me.coach.name || me.coach || 'Head Coach') : 'Head Coach';
        if (detailBatch) detailBatch.innerText = me.squad || me.batch || 'Official Roster';
        if (detailReady) {
            detailReady.innerText = me.isReady ? 'Ready (Eligible for Scouting)' : 'In Training (< 75% or < 2 matches)';
            detailReady.className = me.isReady ? 'font-bold text-emerald-500 mt-1' : 'font-bold text-amber-500 mt-1';
        }
        if (detailMatches) detailMatches.innerText = `${matchesPlayed} played (${matchesSelected} selected)`;

    } catch (err) {
        console.error('Error loading player data:', err);
    }
}

async function loadPlayerAttendancePage() {
    try {
        const me = await api('/api/players/me');
        if (!me) return;

        // Populate top cards
        const rateElem = document.getElementById('player-att-page-rate');
        const presentElem = document.getElementById('player-att-page-present');
        const totalElem = document.getElementById('player-att-page-total');
        const readyElem = document.getElementById('player-att-page-ready');
        const pctElem = document.getElementById('player-progress-pct');
        const barElem = document.getElementById('player-progress-bar');
        const critAtt = document.getElementById('player-criteria-att');
        const critMatch = document.getElementById('player-criteria-matches');

        const rate = me.attendanceRate || 0;
        const presentSessions = me.presentSessions || 0;
        const totalSessions = me.totalSessions || 0;
        const matchesPlayed = me.totalMatchesPlayed ?? me.matchCount ?? 0;
        const attMet = totalSessions > 0 && (presentSessions * 4 >= totalSessions * 3);
        const matchMet = matchesPlayed >= 2;

        if (rateElem) rateElem.innerText = `${rate}%`;
        if (presentElem) presentElem.innerText = presentSessions;
        if (totalElem) totalElem.innerText = `/ ${totalSessions} total sessions`;
        if (pctElem) pctElem.innerText = `${rate}%`;
        if (barElem) barElem.style.width = `${Math.min(rate, 100)}%`;

        if (readyElem) {
            readyElem.innerText = me.isReady ? 'Ready' : 'Not Ready';
            readyElem.className = me.isReady ? 'text-3xl font-extrabold text-emerald-400' : 'text-3xl font-extrabold text-slate-400';
        }

        if (critAtt) {
            critAtt.innerHTML = attMet
                ? '<span class="text-emerald-500 font-bold">✓ Met (' + presentSessions + '/' + totalSessions + ' sessions, ' + rate + '%)</span>'
                : '<span class="text-rose-500 font-bold">✗ Below 75% (' + presentSessions + '/' + totalSessions + ' sessions, ' + rate + '%)</span>';
        }
        if (critMatch) {
            critMatch.innerHTML = matchMet
                ? '<span class="text-emerald-500 font-bold">✓ Met (' + matchesPlayed + ' matches)</span>'
                : '<span class="text-rose-500 font-bold">✗ Need &ge;2 (' + matchesPlayed + ' matches)</span>';
        }

        // Attendance history table
        const tbody = document.getElementById('player-attendance-history-tbody');
        if (tbody) {
            const history = Array.isArray(me.attendanceHistory) ? me.attendanceHistory : [];

            if (history.length) {
                tbody.innerHTML = history.map(item => {
                    const isPresent = item.status === 'present';
                    const dateStr = new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    return `
                        <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors border-b border-slate-200/80 dark:border-slate-800/80">
                            <td class="px-5 py-3.5 font-bold text-sm text-slate-900 dark:text-slate-100">${dateStr}</td>
                            <td class="px-5 py-3.5 text-sm font-medium text-slate-700 dark:text-slate-300">${item.sport || me.sport || ''}</td>
                            <td class="px-5 py-3.5 text-right">
                                <span class="px-3.5 py-1 rounded-full text-xs font-extrabold ${isPresent ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30'}">
                                    ${isPresent ? '✓ PRESENT' : '✗ ABSENT'}
                                </span>
                            </td>
                        </tr>
                    `;
                }).join('');
            } else {
                tbody.innerHTML = `
                    <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                        <td colspan="3" class="px-6 py-8 text-center text-slate-400 font-medium">
                            No saved training sessions recorded yet
                        </td>
                    </tr>
                `;
            }
        }
    } catch (err) {
        console.error('Error loading player attendance page:', err);
    }
}

async function loadPlayerMatches() {
    const tbody = document.getElementById('player-matches-tbody');
    if (!tbody) return;

    try {
        tbody.innerHTML = '<tr><td colspan="3" class="px-6 py-4 text-sm text-slate-400">Loading your matches...</td></tr>';
        const me = await api('/api/players/me');
        const history = me?.matchHistory || [];

        if (!history.length) {
            tbody.innerHTML = '<tr><td colspan="3" class="px-6 py-8 text-center text-slate-500 font-medium">No completed match appearances recorded yet.</td></tr>';
            return;
        }

        tbody.innerHTML = history.map(m => {
            const dateStr = new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const isPlayed = m.played === true;
            return `
                <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors border-b border-slate-200/80 dark:border-slate-800/80">
                    <td class="px-6 py-4.5 font-bold text-sm text-slate-900 dark:text-white border-r border-slate-200/80 dark:border-slate-800/80">${dateStr} &bull; ${m.time || ''}</td>
                    <td class="px-6 py-4.5 border-r border-slate-200/80 dark:border-slate-800/80">
                        <span class="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base block">${escapeHtml(cleanMatchTitle(m.title, m.sport))}</span>
                        <span class="text-xs text-slate-500 dark:text-slate-400 font-medium block mt-0.5">${m.sport} &bull; vs ${escapeHtml(cleanOpponentName(m.opponent, m.sport))} &bull; ${escapeHtml(m.venue || 'Academy Ground')}</span>
                    </td>
                    <td class="px-6 py-4.5 text-right">
                        ${isPlayed ? `
                            <span class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                                <i data-lucide="check" class="w-3.5 h-3.5"></i>
                                <span>Played (${m.score ?? 0} pts/goals)</span>
                            </span>
                        ` : `
                            <span class="inline-flex items-center px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
                                Did Not Play
                            </span>
                        `}
                        ${m.remarks ? `<span class="text-xs text-slate-400 block mt-1 italic">${escapeHtml(m.remarks)}</span>` : ''}
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="3" class="px-6 py-4 text-sm text-rose-500">Error: ${err.message}</td></tr>`;
    }
}

function fillDemo(email, password = 'coach123') {
    const emailField = document.getElementById('login-email') || document.getElementById('login-username');
    const passField = document.getElementById('login-password');
    if (emailField) emailField.value = email;
    if (passField) {
        if (email.startsWith('coach')) passField.value = 'coach123';
        else if (email.startsWith('scout')) passField.value = 'scout123';
        else if (email.startsWith('admin')) passField.value = 'admin123';
        else passField.value = 'player123';
    }
    showToast(`Filled credentials for ${email}`, 'info');
}

function quickFill(email, password) {
    fillDemo(email, password);
}

function handleAvatarUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        const base64 = e.target.result;
        const avatar1 = document.getElementById('player-profile-card-avatar');
        const avatar2 = document.getElementById('player-profile-detail-avatar');
        const headerAvatar = document.getElementById('header-avatar');

        if (avatar1) avatar1.src = base64;
        if (avatar2) avatar2.src = base64;
        if (headerAvatar) headerAvatar.src = base64;

        localStorage.setItem(`avatar_${currentUser?.username || 'player'}`, base64);
        showToast('Profile photo updated successfully!', 'success');
    };
    reader.readAsDataURL(file);
}

// Global window bindings
window.handleAvatarUpload = handleAvatarUpload;
window.fillDemo = fillDemo;
window.quickFill = quickFill;
window.handleFormLogin = handleFormLogin;
window.handleRegisterPlayer = handleRegisterPlayer;
window.openPlayerCredentialsModal = openPlayerCredentialsModal;
window.closePlayerCredentialsModal = closePlayerCredentialsModal;
window.copyCredentialField = copyCredentialField;
window.copyAllCredentials = copyAllCredentials;
window.togglePasswordVisibility = togglePasswordVisibility;
window.openMandatoryPasswordChangeModal = openMandatoryPasswordChangeModal;
window.handleMandatoryPasswordChange = handleMandatoryPasswordChange;
window.openCreateSessionModal = openCreateSessionModal;
window.submitCreateSession = submitCreateSession;
window.openSessionRosterView = openSessionRosterView;
window.setPlayerStatus = setPlayerStatus;
window.togglePlayerAttendance = togglePlayerAttendance;
window.setAllAttendance = setAllAttendance;
if (typeof executeSaveAttendance !== 'undefined') window.executeSaveAttendance = executeSaveAttendance;
if (typeof executeSaveChanges !== 'undefined') window.executeSaveChanges = executeSaveChanges;
if (typeof cancelRosterEdit !== 'undefined') window.cancelRosterEdit = cancelRosterEdit;
if (typeof saveRosterAttendance !== 'undefined') window.saveRosterAttendance = saveRosterAttendance;
window.loadSessions = loadSessions;
window.filterSessionsTable = filterSessionsTable;
window.renderSessionsTable = renderSessionsTable;
window.openSessionDetailsView = openSessionDetailsView;
window.filterSessionPlayersTable = filterSessionPlayersTable;
window.renderSessionPlayersTable = renderSessionPlayersTable;
window.openPlayerAttendanceDetailModal = openPlayerAttendanceDetailModal;
window.markAttendance = markAttendance;
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeQuotes(str) {
    if (!str) return '';
    return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

let activeMatchCreationEligibility = null;

async function checkMatchCreationEligibility() {
    const sportEl = document.getElementById('modal-match-sport');
    const dateEl = document.getElementById('modal-match-date');
    const container = document.getElementById('modal-match-eligibility-container');
    const submitBtn = document.getElementById('modal-submit-create-match-btn');
    if (!sportEl || !dateEl || !container) return;

    const sport = (sportEl.value || '').trim();
    const date = dateEl.value;
    if (!sport || !date) return;

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }

    container.innerHTML = `
        <div class="p-3 text-center text-xs text-slate-400">
            <span class="inline-block animate-spin mr-1">⌛</span> Checking player eligibility...
        </div>
    `;

    try {
        const res = await api(`/api/matches/check-eligibility?sport=${encodeURIComponent(sport)}&date=${date}`);
        activeMatchCreationEligibility = res;

        const minTeamSize = res.minTeamSize || getStandardTeamSize(sport);

        if (res.isBlocked) {
            // Blocked: total eligible < minTeamSize or academy roster < minTeamSize
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
            }
            container.innerHTML = `
                <div class="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300 text-xs space-y-1.5">
                    <div class="flex items-center justify-between">
                        <span class="font-bold uppercase tracking-wider text-[10px] text-rose-600">Standard Minimum: ${minTeamSize} Players</span>
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-600 text-white">Match Creation Blocked</span>
                    </div>
                    <div class="flex items-start gap-2">
                        <i data-lucide="alert-circle" class="w-4 h-4 shrink-0 text-rose-600 mt-0.5"></i>
                        <div>
                            <p class="font-bold">${escapeHtml(res.message || `${sport} requires at least ${minTeamSize} eligible players.`)}</p>
                            <p class="text-[11px] opacity-80 mt-0.5">${res.sessionFinalized ? 'Only players marked Present in the training session for this date can be selected.' : 'Register more athletes for this sport in your roster to schedule matches.'}</p>
                        </div>
                    </div>
                </div>
            `;
            initIcons();
            return;
        }

        if (!res.sessionFinalized) {
            // Future match or practice session attendance not recorded yet
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            }
            container.innerHTML = `
                <div class="p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-800 dark:text-sky-300 text-xs space-y-1.5">
                    <div class="flex items-center justify-between">
                        <span class="font-bold uppercase tracking-wider text-[10px] text-sky-600">Standard Team: ${minTeamSize} Players (Minimum)</span>
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-600/15 text-sky-700 dark:text-sky-200">Advance Scheduling</span>
                    </div>
                    <div class="flex items-start gap-2">
                        <i data-lucide="info" class="w-4 h-4 shrink-0 text-sky-600 mt-0.5"></i>
                        <p class="text-xs">Player selection will be available after practice attendance is recorded for the match date.</p>
                    </div>
                </div>
            `;
            initIcons();
            return;
        }

        // Finalized and eligible players >= minTeamSize
        const players = res.players || [];
        container.innerHTML = `
            <div class="space-y-2 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800">
                <div class="flex items-center justify-between text-xs">
                    <div>
                        <span class="font-bold text-slate-700 dark:text-slate-200">Eligible Practice Athletes</span>
                        <span class="text-slate-400 block text-[11px]">
                            Standard Minimum: <strong class="text-brand-600 dark:text-brand-400">${minTeamSize} Players</strong> &bull;
                            <span id="modal-live-squad-count" class="font-bold text-emerald-600">${players.length}</span> / ${players.length} selected
                        </span>
                    </div>
                    <div class="flex items-center gap-2 text-xs">
                        <button type="button" onclick="toggleAllModalSquadCheckboxes(true)" class="text-brand-600 dark:text-brand-400 font-bold hover:underline cursor-pointer">Select All</button>
                    </div>
                </div>

                <div id="modal-squad-warning" class="hidden p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs font-semibold">
                    <!-- Warning dynamically injected -->
                </div>

                <div class="max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                    ${players.map(p => `
                        <label class="flex items-center justify-between p-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer">
                            <div class="flex items-center gap-2.5">
                                <input 
                                    type="checkbox" 
                                    value="${p.playerId}" 
                                    checked 
                                    class="modal-squad-player-checkbox w-4 h-4 rounded text-brand-600 border-slate-300 dark:border-slate-700 focus:ring-brand-500 cursor-pointer"
                                    onchange="onModalSquadCheckboxChange()"
                                >
                                <span class="text-xs font-bold text-slate-800 dark:text-slate-100">${escapeHtml(p.name)}</span>
                            </div>
                            <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">Present</span>
                        </label>
                    `).join('')}
                </div>
            </div>
        `;
        initIcons();
        onModalSquadCheckboxChange();
    } catch (err) {
        container.innerHTML = `
            <div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 text-xs text-slate-500">
                Notice: ${escapeHtml(err.message || 'Unable to derive practice session eligibility.')}
            </div>
        `;
    }
}

function onModalSquadCheckboxChange() {
    const checked = document.querySelectorAll('.modal-squad-player-checkbox:checked');
    const countEl = document.getElementById('modal-live-squad-count');
    const warningEl = document.getElementById('modal-squad-warning');
    const submitBtn = document.getElementById('modal-submit-create-match-btn');

    const count = checked.length;
    if (countEl) countEl.innerText = count;

    const minTeamSize = activeMatchCreationEligibility?.minTeamSize || 11;
    const sport = (document.getElementById('modal-match-sport')?.value || '').trim();

    if (count < minTeamSize) {
        if (warningEl) {
            warningEl.classList.remove('hidden');
            warningEl.innerText = `${sport} requires at least ${minTeamSize} players, but only ${count} are selected.`;
        }
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
        }
    } else {
        if (warningEl) {
            warningEl.classList.add('hidden');
            warningEl.innerText = '';
        }
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    }
}

function toggleAllModalSquadCheckboxes(selectAll) {
    const checkboxes = document.querySelectorAll('.modal-squad-player-checkbox');
    checkboxes.forEach(cb => { cb.checked = selectAll; });
    onModalSquadCheckboxChange();
}

function openAddMatchModal(prefillDate = null) {
    const defaultDate = prefillDate || (selectedCalendarDateStr || getTodayIstString());
    activeMatchCreationEligibility = null;

    const html = `
        <div class="space-y-4">
            <div>
                <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Match Title <span class="text-rose-500">*</span></label>
                <input id="modal-match-title" type="text" placeholder="e.g. State League vs Ranchi FC" class="w-full bg-white/50 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 dark:text-slate-100">
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Sport <span class="text-rose-500">*</span></label>
                    <select id="modal-match-sport" class="w-full bg-white/50 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 dark:text-slate-100">
                        <option value="Football">Football (11 players)</option>
                        <option value="Cricket">Cricket (11 players)</option>
                        <option value="Basketball">Basketball (5 players)</option>
                        <option value="Volleyball">Volleyball (6 players)</option>
                        <option value="Field Hockey">Field Hockey (11 players)</option>
                        <option value="Kabaddi">Kabaddi (7 players)</option>
                        <option value="Badminton Singles">Badminton Singles (1 player)</option>
                        <option value="Badminton Doubles">Badminton Doubles (2 players)</option>
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Opponent <span class="text-rose-500">*</span></label>
                    <input id="modal-match-opponent" type="text" placeholder="e.g. Ranchi FC" class="w-full bg-white/50 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 dark:text-slate-100">
                </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Fixture Date <span class="text-rose-500">*</span></label>
                    <input id="modal-match-date" type="date" value="${defaultDate}" class="w-full bg-white/50 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 dark:text-slate-100">
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Kickoff / Start Time <span class="text-rose-500">*</span></label>
                    <input id="modal-match-time" type="text" value="16:00" placeholder="e.g. 16:00" class="w-full bg-white/50 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 dark:text-slate-100">
                </div>
            </div>

            <div>
                <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Venue / Ground <span class="text-rose-500">*</span></label>
                <input id="modal-match-venue" type="text" placeholder="e.g. Birsa Munda Football Stadium" class="w-full bg-white/50 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 dark:text-slate-100">
            </div>

            <div>
                <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Description / Match Notes</label>
                <textarea id="modal-match-description" rows="2" placeholder="Optional tactical notes, kit assignments, tournament details..." class="w-full bg-white/50 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 dark:text-slate-100"></textarea>
            </div>

            <!-- Live Eligibility & Squad Selection Container -->
            <div id="modal-match-eligibility-container"></div>
        </div>
    `;

    openModal(
        'Schedule New Match',
        html,
        [
            { label: 'Cancel', class: 'px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer', action: 'closeModal()' },
            { id: 'modal-submit-create-match-btn', label: 'Schedule Match', class: 'px-5 py-2 rounded-xl text-sm font-bold bg-brand-600 text-white hover:bg-brand-700 cursor-pointer shadow-xs opacity-50 cursor-not-allowed', action: 'submitCreateMatch()' }
        ],
        'max-w-xl'
    );

    const initialSubmitBtn = document.getElementById('modal-submit-create-match-btn');
    if (initialSubmitBtn) initialSubmitBtn.disabled = true;

    setTimeout(() => {
        const sportSelect = document.getElementById('modal-match-sport');
        const dateInput = document.getElementById('modal-match-date');
        if (sportSelect) sportSelect.addEventListener('change', checkMatchCreationEligibility);
        if (dateInput) {
            dateInput.addEventListener('change', checkMatchCreationEligibility);
            dateInput.addEventListener('input', checkMatchCreationEligibility);
        }
        checkMatchCreationEligibility();
    }, 50);
}

async function submitCreateMatch() {
    let title = (document.getElementById('modal-match-title')?.value || '').trim();
    const sport = (document.getElementById('modal-match-sport')?.value || '').trim();
    const date = document.getElementById('modal-match-date')?.value;
    const time = (document.getElementById('modal-match-time')?.value || '').trim();
    let opponent = (document.getElementById('modal-match-opponent')?.value || '').trim();
    let venue = (document.getElementById('modal-match-venue')?.value || '').trim();
    const description = (document.getElementById('modal-match-description')?.value || '').trim();

    // Clean defaults if coach leaves title or opponent empty
    if (!title && sport) {
        title = `${sport} Championship`;
    }
    if (!opponent) {
        opponent = 'Jamshedpur FC';
    }
    if (!venue) {
        venue = 'Academy Ground';
    }

    if (!title || !sport || !date || !time || !opponent || !venue) {
        showToast('Please fill in all required fields (title, sport, date, time, opponent, venue)', 'error');
        return;
    }

    const minTeamSize = activeMatchCreationEligibility?.minTeamSize || getStandardTeamSize(sport);

    // 1. Check if match creation is blocked by eligibility check
    if (activeMatchCreationEligibility?.isBlocked) {
        showToast(activeMatchCreationEligibility.message || `${sport} requires at least ${minTeamSize} players. Match creation is blocked.`, 'error');
        return;
    }

    // 2. Check if finalized session has fewer than required eligible players
    if (activeMatchCreationEligibility && activeMatchCreationEligibility.sessionFinalized && activeMatchCreationEligibility.totalEligible < minTeamSize) {
        showToast(`${sport} requires at least ${minTeamSize} eligible players, but only ${activeMatchCreationEligibility.totalEligible} are available.`, 'error');
        return;
    }

    // 3. Check squad checkboxes if rendered
    const squadCheckboxes = document.querySelectorAll('.modal-squad-player-checkbox');
    let selectedPlayerIds = null;
    if (squadCheckboxes.length > 0) {
        const checked = document.querySelectorAll('.modal-squad-player-checkbox:checked');
        selectedPlayerIds = Array.from(checked).map(cb => cb.value);
        if (selectedPlayerIds.length < minTeamSize) {
            showToast(`${sport} requires at least ${minTeamSize} players, but only ${selectedPlayerIds.length} were selected.`, 'error');
            return;
        }
    } else {
        // If advance scheduling (no checkboxes rendered), verify total roster players in academy
        if (Array.isArray(cachedPlayers) && cachedPlayers.length > 0) {
            const rosterForSport = cachedPlayers.filter(p => (p.sport || '').trim().toLowerCase() === sport.toLowerCase());
            if (rosterForSport.length < minTeamSize) {
                showToast(`${sport} requires at least ${minTeamSize} players, but your academy only has ${rosterForSport.length} registered for this sport.`, 'error');
                return;
            }
        }
    }

    const submitBtn = document.getElementById('modal-submit-create-match-btn');
    if (submitBtn && submitBtn.disabled) {
        showToast(`Cannot schedule match: ${sport} requires at least ${minTeamSize} players.`, 'error');
        return;
    }

    try {
        isLocalMutationInProgress = true;
        const newMatch = await api('/api/matches', {
            method: 'POST',
            body: {
                title,
                sport,
                date,
                time,
                opponent,
                venue,
                description,
                selectedPlayerIds
            }
        });

        showToast('Match scheduled successfully!', 'success');
        closeModal();

        // If the date is set, update calendar selection and jump to that month
        if (date) {
            const [y, m] = date.split('-').map(Number);
            currentCalendarDate = new Date(y, m - 1, 1);
            selectedCalendarDateStr = date;
        }

        // Keep current active tab instead of blindly forcing 'upcoming'
        const activeTabBtn = document.querySelector('.match-tab-btn.active');
        const activeTab = activeTabBtn ? activeTabBtn.id.replace('match-tab-btn-', '') : 'calendar';

        await loadMatchData();
        switchMatchTab(activeTab);
        if (activeTab === 'calendar') {
            renderCalendarGrid();
            renderSelectedDayPanel();
        }

        broadcastSyncEvent('match', 'created', { entityId: newMatch?._id });
    } catch (err) {
        showToast(err.message || 'Failed to schedule match', 'error');
    } finally {
        isLocalMutationInProgress = false;
    }
}

// ── COMPLETED MATCH VIEW RESULT MODAL ─────────────────────────────────────────
async function openMatchResultModal(matchId, editMode = false) {
    if (!matchId) return;

    try {
        // Always fetch fresh data from the API to get accurate participations
        let match = await api(`/api/matches/${matchId}`);
        if (!match) {
            match = (cachedMatchList || []).find(m => (m._id || m.id).toString() === matchId.toString());
        }
        if (!match) return;

        // Store the match data for use by save/cancel functions
        window._matchResultEditData = match;

        const dateFormatted = new Date(match.date).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });

        const cleanTitle = cleanMatchTitle(match.title, match.sport);
        const cleanOpponent = cleanOpponentName(match.opponent, match.sport);

        const participations = match.participations || [];
        const playedParts = participations.filter(p => p.played === true && !p.attendanceConflict);
        const dnpParts = participations.filter(p => p.played === false);

        // Fallback for legacy match entries if participations empty
        let legacyPlayed = [];
        if (participations.length === 0 && Array.isArray(match.entries) && match.entries.length > 0) {
            legacyPlayed = match.entries.filter(e => e.result === 'played');
        }

        const totalSelected = (match.selectedPlayers && match.selectedPlayers.length)
            || participations.length
            || (match.entries && match.entries.length)
            || 0;

        const playedCount = match.totalPlayed !== undefined ? match.totalPlayed : (playedParts.length || legacyPlayed.length);
        const dnpCount = match.totalDidNotPlay !== undefined ? match.totalDidNotPlay : dnpParts.length;

        const mId = (match._id || match.id).toString();

        const html = `
            <div class="space-y-5">
                <!-- Header Card: Match Name, Opponent & Status -->
                <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                        <div class="flex items-center gap-2">
                            <h4 class="text-base sm:text-lg font-bold text-slate-900 dark:text-white">${escapeHtml(cleanTitle)}</h4>
                            <span class="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">Completed</span>
                        </div>
                        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                            <span class="font-bold text-brand-600 dark:text-brand-400">${escapeHtml(match.sport)}</span>
                            <span>&bull;</span>
                            <span>vs <b class="text-slate-700 dark:text-slate-200">${escapeHtml(cleanOpponent)}</b></span>
                        </p>
                    </div>
                    <div class="text-left sm:text-right text-xs">
                        <p class="font-bold text-slate-800 dark:text-slate-200">${dateFormatted}</p>
                        <p class="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">${escapeHtml(match.time)} &bull; ${escapeHtml(match.venue || 'Academy Ground')}</p>
                    </div>
                </div>

                <!-- Match Notes if present -->
                ${match.description ? `
                    <div class="p-3 rounded-xl bg-white/40 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                        <span class="font-bold text-slate-400 uppercase text-[10px] block mb-0.5">Match Notes</span>
                        ${escapeHtml(match.description)}
                    </div>
                ` : ''}

                ${editMode ? `
                    <!-- Edit Mode Banner -->
                    <div class="p-3.5 rounded-xl border flex items-center justify-between text-xs bg-amber-500/10 border-amber-500/20 text-amber-800 dark:text-amber-300">
                        <div class="flex items-center gap-2">
                            <i data-lucide="edit-3" class="w-4 h-4 shrink-0 text-amber-600"></i>
                            <span><strong>Editing Scores.</strong> Update player scores below, then click <strong>Save Changes</strong>.</span>
                        </div>
                        <span class="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-amber-600 text-white shrink-0">Edit Mode</span>
                    </div>
                ` : ''}

                <!-- Summary Overview Metric Cards -->
                <div class="grid grid-cols-3 gap-3">
                    <div class="p-3.5 rounded-xl bg-white/50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 text-center">
                        <div class="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Total Selected</div>
                        <div class="text-xl font-extrabold text-indigo-600 dark:text-indigo-400 mt-1">${totalSelected}</div>
                        <div class="text-[10px] text-slate-400 mt-0.5">Squad Athletes</div>
                    </div>
                    <div class="p-3.5 rounded-xl bg-white/50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 text-center">
                        <div class="text-[11px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider">Played</div>
                        <div class="text-xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-1">${playedCount}</div>
                        <div class="text-[10px] text-slate-400 mt-0.5">Active Participants</div>
                    </div>
                    <div class="p-3.5 rounded-xl bg-white/50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 text-center">
                        <div class="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Did Not Play</div>
                        <div class="text-xl font-extrabold text-slate-500 dark:text-slate-400 mt-1">${dnpCount}</div>
                        <div class="text-[10px] text-slate-400 mt-0.5">Bench / Reserves</div>
                    </div>
                </div>

                <!-- Individual Player Breakdown -->
                <div class="space-y-4">
                    <!-- Players Who Played -->
                    <div>
                        <div class="flex items-center justify-between mb-2">
                            <h5 class="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                                <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i>
                                <span>Players Who Played (${playedCount})</span>
                            </h5>
                            <span class="text-[11px] font-semibold text-slate-400">${editMode ? 'Edit Scores (0-20)' : 'Scores & Performance'}</span>
                        </div>

                        ${(() => {
                if (playedParts.length > 0) {
                    return `
                                    <div class="rounded-xl border border-slate-200/80 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 bg-white/40 dark:bg-slate-900/30 overflow-hidden">
                                        ${playedParts.map(p => {
                        const pid = (p.player?._id || p.playerId || p.player || '').toString();
                        const pName = p.player?.name || p.name || 'Player';
                        const pSport = p.player?.sport || p.sport || match.sport;
                        const scoreVal = (p.score !== null && p.score !== undefined) ? p.score : 0;
                        if (editMode) {
                            return `
                                                <div class="px-3.5 py-2.5 flex items-center justify-between text-xs" data-player-score-row="${pid}">
                                                    <div class="flex items-center gap-2.5">
                                                        <div class="w-7 h-7 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold text-xs shrink-0">
                                                            ${escapeHtml((pName || 'A')[0])}
                                                        </div>
                                                        <div>
                                                            <span class="font-bold text-slate-800 dark:text-slate-100">${escapeHtml(pName)}</span>
                                                            <span class="text-slate-400 text-[11px] block">${escapeHtml(pSport)}</span>
                                                        </div>
                                                    </div>
                                                    <div class="flex items-center gap-2">
                                                        <input 
                                                            type="number" 
                                                            min="0" max="20" 
                                                            value="${scoreVal}" 
                                                            data-edit-score-pid="${pid}"
                                                            class="w-16 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1 text-xs text-center outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 dark:text-slate-100 font-bold"
                                                        >
                                                        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                                            Played
                                                        </span>
                                                    </div>
                                                </div>
                                            `;
                        } else {
                            return `
                                                <div class="px-3.5 py-2.5 flex items-center justify-between text-xs">
                                                    <div class="flex items-center gap-2.5">
                                                        <div class="w-7 h-7 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold text-xs shrink-0">
                                                            ${escapeHtml((pName || 'A')[0])}
                                                        </div>
                                                        <div>
                                                            <span class="font-bold text-slate-800 dark:text-slate-100">${escapeHtml(pName)}</span>
                                                            <span class="text-slate-400 text-[11px] block">${escapeHtml(pSport)}${p.remarks ? ` &bull; <span class="italic text-slate-500 font-normal">"${escapeHtml(p.remarks)}"</span>` : ''}</span>
                                                        </div>
                                                    </div>
                                                    <div class="flex items-center gap-2">
                                                        <span class="px-2.5 py-1 rounded-lg text-xs font-extrabold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                                                            Score: ${scoreVal}
                                                        </span>
                                                        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                                            Played
                                                        </span>
                                                    </div>
                                                </div>
                                            `;
                        }
                    }).join('')}
                                    </div>
                                `;
                } else if (legacyPlayed.length > 0) {
                    return `
                                    <div class="rounded-xl border border-slate-200/80 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 bg-white/40 dark:bg-slate-900/30 overflow-hidden">
                                        ${legacyPlayed.map(e => `
                                            <div class="px-3.5 py-2.5 flex items-center justify-between text-xs">
                                                <div class="flex items-center gap-2">
                                                    <div class="w-7 h-7 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold text-xs shrink-0">
                                                        ${escapeHtml((e.player?.name || 'P')[0])}
                                                    </div>
                                                    <span class="font-bold text-slate-800 dark:text-slate-100">${escapeHtml(e.player?.name || 'Player')}</span>
                                                </div>
                                                <div class="flex items-center gap-2">
                                                    <span class="px-2.5 py-1 rounded-lg text-xs font-extrabold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                                                        Score: ${e.score || 0}
                                                    </span>
                                                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                                        Played
                                                    </span>
                                                </div>
                                            </div>
                                        `).join('')}
                                    </div>
                                `;
                } else {
                    return `<div class="p-4 text-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-xs text-slate-400">No players recorded as played.</div>`;
                }
            })()}
                    </div>

                    <!-- Players Who Did Not Play -->
                    <div>
                        <h5 class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <i data-lucide="x-circle" class="w-3.5 h-3.5"></i>
                            <span>Players Who Did Not Play (${dnpParts.length})</span>
                        </h5>

                        ${(() => {
                if (dnpParts.length > 0) {
                    return `
                                    <div class="rounded-xl border border-slate-200/80 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 bg-white/40 dark:bg-slate-900/30 overflow-hidden">
                                        ${dnpParts.map(p => {
                        const pName = p.player?.name || p.name || 'Player';
                        const pSport = p.player?.sport || p.sport || match.sport;
                        return `
                                                <div class="px-3.5 py-2.5 flex items-center justify-between text-xs">
                                                    <div class="flex items-center gap-2.5">
                                                        <div class="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-500 flex items-center justify-center font-bold text-xs shrink-0">
                                                            ${escapeHtml((pName || 'A')[0])}
                                                        </div>
                                                        <div>
                                                            <span class="font-bold text-slate-800 dark:text-slate-100">${escapeHtml(pName)}</span>
                                                            <span class="text-slate-400 text-[11px] block">${escapeHtml(pSport)}${p.remarks ? ` &bull; <span class="italic text-slate-500 font-normal">"${escapeHtml(p.remarks)}"</span>` : ''}</span>
                                                        </div>
                                                    </div>
                                                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700">
                                                        Did Not Play
                                                    </span>
                                                </div>
                                            `;
                    }).join('')}
                                    </div>
                                `;
                } else {
                    return `<div class="p-3 text-center rounded-xl border border-slate-200/60 dark:border-slate-800/60 text-xs text-slate-400 italic">None (all selected players played).</div>`;
                }
            })()}
                    </div>
                </div>
            </div>
        `;

        let footerButtons;
        if (editMode) {
            footerButtons = [
                { label: 'Cancel', class: 'px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer', action: `openMatchResultModal('${mId}', false)` },
                { label: 'Save Changes', class: 'px-5 py-2 rounded-xl text-sm font-bold bg-brand-600 hover:bg-brand-700 text-white cursor-pointer shadow-xs', action: `saveMatchResultScores('${mId}')` }
            ];
        } else {
            footerButtons = [
                { label: 'Edit Scores', class: 'px-4 py-2 rounded-xl text-xs font-bold bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 cursor-pointer transition-colors', action: `openMatchResultModal('${mId}', true)` },
                { label: 'Close', class: 'px-5 py-2 rounded-xl text-sm font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer transition-colors', action: 'closeModal()' }
            ];
        }

        openModal(
            editMode ? `Edit Scores: ${escapeHtml(cleanTitle)}` : `Match Result: ${escapeHtml(cleanTitle)}`,
            html,
            footerButtons,
            'max-w-2xl'
        );
        initIcons();
    } catch (err) {
        showToast(err.message || 'Error loading match result', 'error');
    }
}

async function saveMatchResultScores(matchId) {
    if (!matchId) return;

    // Collect all score inputs from the modal
    const scoreInputs = document.querySelectorAll('[data-edit-score-pid]');
    if (scoreInputs.length === 0) {
        showToast('No score inputs found', 'error');
        return;
    }

    const scores = [];
    for (const input of scoreInputs) {
        const playerId = input.getAttribute('data-edit-score-pid');
        const val = input.value;
        const numVal = Number(val);

        if (val === '' || isNaN(numVal)) {
            showToast('All score fields must contain a valid number', 'error');
            return;
        }
        if (numVal < 0 || numVal > 20) {
            showToast('Scores must be between 0 and 20', 'error');
            return;
        }

        scores.push({ playerId, score: numVal });
    }

    try {
        isLocalMutationInProgress = true;
        const res = await api(`/api/matches/${matchId}/edit-scores`, {
            method: 'PATCH',
            body: { scores }
        });

        showToast('Scores updated successfully!', 'success');

        // Update the cached match list with new data
        if (res.match) {
            const idx = (cachedMatchList || []).findIndex(m => (m._id || m.id).toString() === matchId.toString());
            if (idx >= 0) {
                cachedMatchList[idx] = { ...cachedMatchList[idx], ...res.match };
            }
        }

        // Re-render the modal in read-only mode with updated data
        await openMatchResultModal(matchId, false);

        // Refresh match data in background
        await Promise.all([
            loadMatchData(),
            loadCoachStats()
        ]);
        broadcastSyncEvent('match', 'updated', { entityId: matchId });
    } catch (err) {
        showToast(err.message || 'Failed to save scores', 'error');
    } finally {
        isLocalMutationInProgress = false;
    }
}

async function openMatchDetailsModal(matchId) {
    if (!matchId) return;

    try {
        let match = (cachedMatchList || []).find(m => (m._id || m.id).toString() === matchId.toString());
        if (!match) {
            match = await api(`/api/matches/${matchId}`);
        }
        if (!match) return;

        const dateFormatted = new Date(match.date).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });

        const sched = getClientMatchScheduleInfo(match);
        let timeStatusDisplay = match.status;
        let statusBadgeClass = 'bg-amber-500/10 text-amber-600 border-amber-500/20';

        if (match.status === 'completed') {
            timeStatusDisplay = 'Completed';
            statusBadgeClass = 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
        } else if (match.status === 'cancelled') {
            timeStatusDisplay = 'Cancelled';
            statusBadgeClass = 'bg-rose-500/10 text-rose-600 border-rose-500/20';
        } else if (sched.timeStatus === 'upcoming') {
            timeStatusDisplay = 'Upcoming';
            statusBadgeClass = 'bg-sky-500/10 text-sky-600 border-sky-500/20';
        } else if (sched.timeStatus === 'in_progress') {
            timeStatusDisplay = 'In Progress';
            statusBadgeClass = 'bg-amber-500/10 text-amber-600 border-amber-500/20';
        } else if (sched.timeStatus === 'scoring_available') {
            timeStatusDisplay = 'Scoring Available';
            statusBadgeClass = 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
        }

        const isUpcoming = match.status === 'upcoming';
        const isCompleted = match.status === 'completed';
        const isCancelled = match.status === 'cancelled';

        const cleanTitle = cleanMatchTitle(match.title, match.sport);
        const cleanOpponent = cleanOpponentName(match.opponent, match.sport);

        const selectedPlayersList = match.selectedPlayers || [];

        const html = `
            <div class="space-y-5">
                <!-- Header Banner -->
                <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                        <div class="flex items-center gap-2">
                            <h4 class="text-base sm:text-lg font-bold text-slate-900 dark:text-white">${escapeHtml(cleanTitle)}</h4>
                            <span class="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border ${statusBadgeClass}">${timeStatusDisplay}</span>
                        </div>
                        <p class="text-xs text-slate-500 mt-1">
                            <span class="font-semibold text-brand-600 dark:text-brand-400">${match.sport}</span> &bull; vs ${escapeHtml(cleanOpponent)}
                        </p>
                    </div>
                    <div class="text-left sm:text-right">
                        <p class="text-xs font-bold text-slate-800 dark:text-slate-200">${dateFormatted}</p>
                        <p class="text-[11px] text-slate-500">${escapeHtml(match.time)} &bull; ${escapeHtml(match.venue)}</p>
                    </div>
                </div>

                <!-- Timing / Scoring Availability Banner -->
                ${!isCompleted && match.status !== 'cancelled' ? `
                    <div class="p-3.5 rounded-xl border flex items-center justify-between text-xs ${sched.isUnlocked ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-800 dark:text-emerald-300' : 'bg-sky-500/10 border-sky-500/20 text-sky-800 dark:text-sky-300'}">
                        <div class="flex items-center gap-2.5">
                            <i data-lucide="${sched.isUnlocked ? 'check-circle-2' : 'clock'}" class="w-4 h-4 shrink-0 ${sched.isUnlocked ? 'text-emerald-600' : 'text-sky-600'}"></i>
                            <div>
                                <span class="font-bold">${sched.isUnlocked ? 'Scoring is now available.' : `Scoring will unlock at ${sched.unlockTimeStr}.`}</span>
                                <span class="block text-[11px] opacity-80 mt-0.5">${sched.isUnlocked ? 'Participation status (Played / Did Not Play) and player scores can now be recorded.' : 'Participation status and score inputs remain locked until 60 minutes after match kickoff.'}</span>
                            </div>
                        </div>
                        ${sched.isUnlocked ? `<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-600 text-white uppercase shrink-0">Unlocked</span>` : `<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-sky-600 text-white uppercase shrink-0">Locked</span>`}
                    </div>
                ` : ''}

                <!-- Description / Notes -->
                ${match.description ? `
                    <div class="p-3 rounded-xl bg-white/40 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                        <span class="font-bold text-slate-400 uppercase text-[10px] block mb-0.5">Match Notes</span>
                        ${escapeHtml(match.description)}
                    </div>
                ` : ''}

                <!-- Linked Session Card -->
                <div class="p-3 rounded-xl border flex items-center justify-between text-xs ${match.sessionId ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-800 dark:text-emerald-300' : 'bg-slate-50 dark:bg-slate-800/20 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'}">
                    <div class="flex items-center gap-2">
                        <i data-lucide="${match.sessionId ? 'check-circle' : 'info'}" class="w-4 h-4 ${match.sessionId ? 'text-emerald-500' : 'text-slate-400'}"></i>
                        <span>${match.sessionId ? 'Training Attendance Session linked for eligibility derivation.' : 'No finalized training session linked yet. Players can still be drafted.'}</span>
                    </div>
                </div>

                <!-- Attendance Conflict Banner -->
                ${match.hasConflict ? `
                    <div class="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5">
                        <i data-lucide="alert-triangle" class="w-4 h-4 shrink-0 text-amber-600 mt-0.5"></i>
                        <div>
                            <div class="font-bold text-amber-800 dark:text-amber-300">⚠️ Attendance Conflict Detected</div>
                            <div class="mt-0.5 text-[11px] leading-relaxed">${escapeHtml(match.conflictMessage || 'One or more players marked absent in linked attendance session.')}</div>
                        </div>
                    </div>
                ` : ''}

                <!-- Stats Overview Bar -->
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div class="p-3 rounded-xl bg-white/50 dark:bg-slate-800/30 border border-slate-200/80 dark:border-slate-800 text-center">
                        <div class="text-xs text-slate-400 font-semibold uppercase">Eligible Players</div>
                        <div class="text-lg font-extrabold text-indigo-600 dark:text-indigo-400">${getMatchEligiblePlayersCount(match)} Players</div>
                    </div>
                    <div class="p-3 rounded-xl bg-white/50 dark:bg-slate-800/30 border border-slate-200/80 dark:border-slate-800 text-center">
                        <div class="text-xs text-slate-400 font-semibold uppercase">Selected Squad</div>
                        <div class="text-lg font-extrabold text-brand-600 dark:text-brand-400">${selectedPlayersList.length} Players</div>
                    </div>
                    <div class="p-3 rounded-xl bg-white/50 dark:bg-slate-800/30 border border-slate-200/80 dark:border-slate-800 text-center">
                        <div class="text-xs text-slate-400 font-semibold uppercase">Actual Played</div>
                        <div class="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">${match.totalPlayed || 0}</div>
                    </div>
                    <div class="p-3 rounded-xl bg-white/50 dark:bg-slate-800/30 border border-slate-200/80 dark:border-slate-800 text-center">
                        <div class="text-xs text-slate-400 font-semibold uppercase">Did Not Play</div>
                        <div class="text-lg font-extrabold text-slate-500">${match.totalDidNotPlay || 0}</div>
                    </div>
                </div>

                <!-- Squad & Scorecard Details Section -->
                <div>
                    ${isCompleted ? `
                        <div class="space-y-4">
                            <!-- Players Who Played Section -->
                            <div>
                                <div class="flex items-center justify-between mb-2">
                                    <h5 class="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                                        <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i>
                                        Players Who Actually Played (${(match.participations || []).filter(p => p.played === true && !p.attendanceConflict).length})
                                    </h5>
                                    <span class="text-[11px] font-semibold text-slate-400">Recorded Scores & Performance</span>
                                </div>

                                ${(() => {
                    const parts = match.participations || [];
                    const playedParts = parts.filter(p => p.played === true && !p.attendanceConflict);
                    if (playedParts.length > 0) {
                        return `
                                            <div class="rounded-xl border border-slate-200/80 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 bg-white/40 dark:bg-slate-900/30 overflow-hidden">
                                                ${playedParts.map(p => {
                            const pName = p.player?.name || p.name || 'Player';
                            const pSport = p.player?.sport || p.sport || match.sport;
                            const scoreVal = (p.score !== null && p.score !== undefined) ? p.score : 0;
                            return `
                                                        <div class="px-3.5 py-2.5 flex items-center justify-between text-xs">
                                                            <div class="flex items-center gap-2.5">
                                                                <div class="w-7 h-7 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold text-xs">
                                                                    ${(pName || 'A')[0]}
                                                                </div>
                                                                <div>
                                                                    <span class="font-bold text-slate-800 dark:text-slate-100">${escapeHtml(pName)}</span>
                                                                    <span class="text-slate-400 text-[11px] block">${pSport}${p.remarks ? ` &bull; <span class="italic text-slate-500 font-normal">"${escapeHtml(p.remarks)}"</span>` : ''}</span>
                                                                </div>
                                                            </div>
                                                            <div class="flex items-center gap-2">
                                                                <span class="px-2.5 py-1 rounded-lg text-xs font-extrabold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                                                                    Score: ${scoreVal}
                                                                </span>
                                                                <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                                                    Played
                                                                </span>
                                                            </div>
                                                        </div>
                                                    `;
                        }).join('')}
                                            </div>
                                        `;
                    } else if ((match.entries || []).length > 0) {
                        const playedEntries = match.entries.filter(e => e.result === 'played');
                        return `
                                            <div class="rounded-xl border border-slate-200/80 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 bg-white/40 dark:bg-slate-900/30 overflow-hidden">
                                                ${playedEntries.map(e => `
                                                    <div class="px-3.5 py-2.5 flex items-center justify-between text-xs">
                                                        <span class="font-bold text-slate-800 dark:text-slate-100">${escapeHtml(e.player?.name || 'Player')}</span>
                                                        <span class="px-2.5 py-1 rounded-lg text-xs font-extrabold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                                                            Score: ${e.score || 0}
                                                        </span>
                                                    </div>
                                                `).join('')}
                                            </div>
                                        `;
                    } else {
                        return `<div class="p-4 text-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-xs text-slate-400">No players recorded as played.</div>`;
                    }
                })()}
                            </div>

                            <!-- Players Who Did Not Play Section -->
                            <div>
                                <h5 class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <i data-lucide="x-circle" class="w-3.5 h-3.5"></i>
                                    Players Who Did Not Play (${(match.participations || []).filter(p => p.played === false).length})
                                </h5>

                                ${(() => {
                    const parts = match.participations || [];
                    const dnpParts = parts.filter(p => p.played === false);
                    if (dnpParts.length > 0) {
                        return `
                                            <div class="rounded-xl border border-slate-200/80 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 bg-white/40 dark:bg-slate-900/30 overflow-hidden">
                                                ${dnpParts.map(p => {
                            const pName = p.player?.name || p.name || 'Player';
                            const pSport = p.player?.sport || p.sport || match.sport;
                            return `
                                                        <div class="px-3.5 py-2.5 flex items-center justify-between text-xs">
                                                            <div class="flex items-center gap-2.5">
                                                                <div class="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-500 flex items-center justify-center font-bold text-xs">
                                                                    ${(pName || 'A')[0]}
                                                                </div>
                                                                <div>
                                                                    <span class="font-bold text-slate-800 dark:text-slate-100">${escapeHtml(pName)}</span>
                                                                    <span class="text-slate-400 text-[11px] block">${pSport}${p.remarks ? ` &bull; <span class="italic text-slate-500 font-normal">"${escapeHtml(p.remarks)}"</span>` : ''}</span>
                                                                </div>
                                                            </div>
                                                            <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700">
                                                                Did Not Play
                                                            </span>
                                                        </div>
                                                    `;
                        }).join('')}
                                            </div>
                                        `;
                    } else {
                        return `<div class="p-3 text-center rounded-xl border border-slate-200/60 dark:border-slate-800/60 text-xs text-slate-400 italic">None (all selected players played).</div>`;
                    }
                })()}
                            </div>
                        </div>
                    ` : `
                        <div>
                            <div class="flex items-center justify-between mb-2">
                                <h5 class="text-xs font-bold text-slate-500 uppercase">Selected Match Squad (${selectedPlayersList.length})</h5>
                                <button onclick="openManageMatchPlayersModal('${match._id}')" class="text-xs font-bold text-brand-600 dark:text-brand-400 hover:underline cursor-pointer">
                                    + Edit Squad
                                </button>
                            </div>

                            ${selectedPlayersList.length ? `
                                <div class="max-h-48 overflow-y-auto rounded-xl border border-slate-200/80 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                                    ${selectedPlayersList.map(p => `
                                        <div class="px-3.5 py-2.5 flex items-center justify-between bg-white/40 dark:bg-slate-900/30 text-xs">
                                            <div class="flex items-center gap-2">
                                                <div class="w-6 h-6 rounded-full bg-brand-500/10 text-brand-600 flex items-center justify-center font-bold text-[10px]">
                                                    ${(p.name || 'A')[0]}
                                                </div>
                                                <span class="font-bold text-slate-800 dark:text-slate-200">${escapeHtml(p.name)}</span>
                                            </div>
                                            <span class="text-slate-400 text-[11px]">${p.sport || match.sport}</span>
                                        </div>
                                    `).join('')}
                                </div>
                            ` : `
                                <div class="p-6 text-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-xs text-slate-400">
                                    No athletes selected for this fixture yet.
                                </div>
                            `}
                        </div>
                    `}
                </div>
            </div>
        `;

        const mId = (match._id || match.id).toString();
        const footerButtons = [
            { label: 'Close', class: 'px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer', action: 'closeModal()' }
        ];

        if (isUpcoming) {
            footerButtons.unshift(
                { label: 'Delete Match', class: 'px-3 py-2 rounded-xl text-xs font-bold bg-rose-600/10 hover:bg-rose-600 text-rose-600 hover:text-white border border-rose-500/20 cursor-pointer transition-colors', action: `confirmDeleteMatch('${mId}', '${escapeQuotes(cleanMatchTitle(match.title, match.sport))}')` },
                { label: 'Cancel Fixture', class: 'px-3 py-2 rounded-xl text-xs font-bold bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 cursor-pointer transition-colors', action: `confirmCancelMatch('${mId}', '${escapeQuotes(cleanMatchTitle(match.title, match.sport))}')` },
                { label: 'Edit Details', class: 'px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 cursor-pointer transition-colors', action: `openEditMatchModal('${mId}')` }
            );
            if (sched.isUnlocked) {
                footerButtons.unshift({
                    label: 'Enter Scores & Complete',
                    class: 'px-5 py-2 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer shadow-xs',
                    action: `openManageMatchPlayersModal('${mId}', 'scoring')`
                });
            } else {
                footerButtons.unshift({
                    label: 'Manage Squad',
                    class: 'px-5 py-2 rounded-xl text-sm font-bold bg-brand-600 text-white hover:bg-brand-700 cursor-pointer shadow-xs',
                    action: `openManageMatchPlayersModal('${mId}', 'squad')`
                });
            }
        } else if (isCancelled) {
            footerButtons.unshift({
                label: 'Delete Match',
                class: 'px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer shadow-xs transition-colors',
                action: `confirmDeleteMatch('${mId}', '${escapeQuotes(cleanMatchTitle(match.title, match.sport))}')`
            });
        } else if (isCompleted) {
            footerButtons.unshift(
                { label: 'Edit Scores', class: 'px-4 py-2 rounded-xl text-xs font-bold bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 cursor-pointer transition-colors', action: `openMatchResultModal('${mId}', true)` },
                { label: 'View Result', class: 'px-5 py-2 rounded-xl text-sm font-bold bg-brand-600 text-white hover:bg-brand-700 cursor-pointer shadow-xs', action: `openMatchResultModal('${mId}', false)` }
            );
        }

        openModal(
            `Fixture Details`,
            html,
            footerButtons,
            'max-w-2xl'
        );
    } catch (err) {
        showToast(err.message || 'Error loading match details', 'error');
    }
}

async function openEditMatchModal(matchId) {
    if (!matchId) return;

    try {
        let match = (cachedMatchList || []).find(m => (m._id || m.id).toString() === matchId.toString());
        if (!match) {
            match = await api(`/api/matches/${matchId}`);
        }
        if (!match) return;

        const matchDateIso = getTodayIstString(match.date);

        const html = `
            <div class="space-y-4">
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Match Title <span class="text-rose-500">*</span></label>
                    <input id="modal-edit-match-title" type="text" value="${escapeHtml(match.title || '')}" class="w-full bg-white/50 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 dark:text-slate-100">
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Sport <span class="text-rose-500">*</span></label>
                        <select id="modal-edit-match-sport" class="w-full bg-white/50 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 dark:text-slate-100">
                            <option value="Football" ${match.sport === 'Football' ? 'selected' : ''}>Football</option>
                            <option value="Cricket" ${match.sport === 'Cricket' ? 'selected' : ''}>Cricket</option>
                            <option value="Basketball" ${match.sport === 'Basketball' ? 'selected' : ''}>Basketball</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Opponent <span class="text-rose-500">*</span></label>
                        <input id="modal-edit-match-opponent" type="text" value="${escapeHtml(match.opponent || '')}" class="w-full bg-white/50 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 dark:text-slate-100">
                    </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Fixture Date <span class="text-rose-500">*</span></label>
                        <input id="modal-edit-match-date" type="date" value="${matchDateIso}" class="w-full bg-white/50 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 dark:text-slate-100">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Kickoff / Start Time <span class="text-rose-500">*</span></label>
                        <input id="modal-edit-match-time" type="text" value="${escapeHtml(match.time || '')}" class="w-full bg-white/50 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 dark:text-slate-100">
                    </div>
                </div>

                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Venue / Ground <span class="text-rose-500">*</span></label>
                    <input id="modal-edit-match-venue" type="text" value="${escapeHtml(match.venue || '')}" class="w-full bg-white/50 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 dark:text-slate-100">
                </div>

                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Description / Match Notes</label>
                    <textarea id="modal-edit-match-description" rows="2" class="w-full bg-white/50 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 dark:text-slate-100">${escapeHtml(match.description || '')}</textarea>
                </div>
            </div>
        `;

        openModal(
            'Edit Match Details',
            html,
            [
                { label: 'Back to Match', class: 'px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer', action: `openManageMatchPlayersModal('${matchId}')` },
                { label: 'Save Changes', class: 'px-5 py-2 rounded-xl text-sm font-bold bg-brand-600 text-white hover:bg-brand-700 cursor-pointer shadow-xs', action: `submitEditMatch('${matchId}')` }
            ],
            'max-w-xl'
        );
    } catch (err) {
        showToast(err.message || 'Error opening edit modal', 'error');
    }
}

async function submitEditMatch(matchId) {
    const title = (document.getElementById('modal-edit-match-title')?.value || '').trim();
    const sport = (document.getElementById('modal-edit-match-sport')?.value || '').trim();
    const date = document.getElementById('modal-edit-match-date')?.value;
    const time = (document.getElementById('modal-edit-match-time')?.value || '').trim();
    const opponent = (document.getElementById('modal-edit-match-opponent')?.value || '').trim();
    const venue = (document.getElementById('modal-edit-match-venue')?.value || '').trim();
    const description = (document.getElementById('modal-edit-match-description')?.value || '').trim();

    if (!title || !sport || !date || !time || !opponent || !venue) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    try {
        isLocalMutationInProgress = true;
        await api(`/api/matches/${matchId}`, {
            method: 'PATCH',
            body: { title, sport, date, time, opponent, venue, description }
        });

        showToast('Match updated successfully!', 'success');
        closeModal();
        await loadMatchData();
        openMatchDetailsModal(matchId);
        broadcastSyncEvent('match', 'updated', { entityId: matchId });
    } catch (err) {
        showToast(err.message || 'Failed to update match', 'error');
    } finally {
        isLocalMutationInProgress = false;
    }
}

function confirmCancelMatch(matchId, matchTitle) {
    const html = `
        <div class="space-y-4 py-1">
            <div class="flex items-start gap-3 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-800 dark:text-rose-300">
                <i data-lucide="alert-octagon" class="w-5 h-5 text-rose-500 shrink-0 mt-0.5"></i>
                <div class="text-xs">
                    <p class="font-bold">Remove Match</p>
                    <p class="text-slate-600 dark:text-slate-300 mt-1">
                        Are you sure you want to remove <strong>${escapeHtml(matchTitle || 'this match')}</strong>?
                        This fixture will be completely removed from your match schedule and calendar.
                    </p>
                </div>
            </div>
        </div>
    `;

    openModal(
        'Remove Match',
        html,
        [
            { label: 'Keep Fixture', class: 'px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer', action: 'closeModal()' },
            { label: 'Yes, Remove Match', class: 'px-5 py-2 rounded-xl text-sm font-bold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer shadow-xs', action: `executeCancelMatch('${matchId}')` }
        ],
        'max-w-md'
    );
}

async function executeCancelMatch(matchId) {
    try {
        isLocalMutationInProgress = true;
        await api(`/api/matches/${matchId}`, {
            method: 'DELETE'
        });
        showToast('Match removed successfully.', 'info');
        closeModal();

        cachedMatchList = (cachedMatchList || []).filter(x => (x._id || x.id).toString() !== matchId.toString());
        updateMatchDashboardSummary();
        renderCalendarGrid();
        renderSelectedDayPanel();
        renderUpcomingMatchesTable();
        renderCompletedMatchesTable();

        await loadMatchData();
        renderCalendarGrid();
        renderSelectedDayPanel();
        if (currentActivePageId === 'coach-matches') {
            const activeTabBtn = document.querySelector('.match-tab-btn.active');
            const activeTab = activeTabBtn ? activeTabBtn.id.replace('match-tab-btn-', '') : 'upcoming';
            switchMatchTab(activeTab);
        } else {
            switchPage('coach-matches');
        }
        broadcastSyncEvent('match', 'deleted', { entityId: matchId });
    } catch (err) {
        showToast(err.message || 'Failed to remove match', 'error');
    } finally {
        isLocalMutationInProgress = false;
    }
}

async function reopenMatchForEdit(matchId) {
    if (!matchId) return;
    try {
        isLocalMutationInProgress = true;
        const res = await api(`/api/matches/${matchId}/reopen-for-edit`, {
            method: 'PATCH'
        });
        showToast('Match reopened for editing for 5 minutes.', 'success');

        // Update in-memory match cached status and unlock timestamp
        const cached = (cachedMatchList || []).find(m => (m._id || m.id).toString() === matchId.toString());
        if (cached && res?.editUnlockedUntil) {
            cached.editUnlockedUntil = res.editUnlockedUntil;
        }

        // Directly open the editing page with Save Changes button
        await openManageMatchPlayersModal(matchId);
        broadcastSyncEvent('match', 'updated', { entityId: matchId });
    } catch (err) {
        showToast(err.message || 'Failed to reopen match', 'error');
    } finally {
        isLocalMutationInProgress = false;
    }
}

// ── MATCH MANAGEMENT PHASE 9: UNIFIED SQUAD SELECTION, PARTICIPATION & COMPLETION ──
let activeMatchModalId = null;
let activeMatchData = null;
let activeEligibleData = null;
let activeParticipationData = [];

async function openManageMatchPlayersModal(matchId) {
    if (!matchId || matchId === 'undefined') return;
    activeMatchModalId = matchId;

    try {
        const matchPromise = api(`/api/matches/${matchId}`);
        const eligiblePromise = api(`/api/matches/${matchId}/eligible-players`);
        const partPromise = api(`/api/matches/${matchId}/participation`).catch(() => []);

        const [matchRes, eligibleRes, partRes] = await Promise.all([matchPromise, eligiblePromise, partPromise]);
        activeMatchData = matchRes;
        activeEligibleData = eligibleRes;
        activeParticipationData = Array.isArray(partRes) ? partRes : (partRes?.participations || []);

        renderManageMatchPlayersModal();
    } catch (err) {
        showToast(err.message || 'Error loading match data', 'error');
    }
}

function renderManageMatchPlayersModal() {
    if (!activeMatchData) return;

    const match = activeMatchData;
    const isCompleted = match.status === 'completed';
    const isCancelled = match.status === 'cancelled';
    const isEditReopened = isCompleted && match.editUnlockedUntil && new Date(match.editUnlockedUntil).getTime() > Date.now();
    const sched = getClientMatchScheduleInfo(match);
    const isScoringUnlocked = isCompleted || sched.isUnlocked;

    let timeStatusDisplay = match.status;
    let statusBadgeClass = 'bg-amber-500/10 text-amber-600 border-amber-500/20';

    if (isEditReopened) {
        timeStatusDisplay = 'Reopened for Edit';
        statusBadgeClass = 'bg-amber-500/10 text-amber-600 border-amber-500/20';
    } else if (match.status === 'completed') {
        timeStatusDisplay = 'Completed';
        statusBadgeClass = 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
    } else if (match.status === 'cancelled') {
        timeStatusDisplay = 'Cancelled';
        statusBadgeClass = 'bg-rose-500/10 text-rose-600 border-rose-500/20';
    } else if (sched.timeStatus === 'upcoming') {
        timeStatusDisplay = 'Upcoming';
        statusBadgeClass = 'bg-sky-500/10 text-sky-600 border-sky-500/20';
    } else if (sched.timeStatus === 'in_progress') {
        timeStatusDisplay = 'In Progress';
        statusBadgeClass = 'bg-amber-500/10 text-amber-600 border-amber-500/20';
    } else if (sched.timeStatus === 'scoring_available') {
        timeStatusDisplay = 'Scoring Available';
        statusBadgeClass = 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
    }

    const elig = activeEligibleData || {};
    const eligiblePlayers = [...(elig.players || [])];

    // Ensure all players already participating or selected in this match are included
    (activeParticipationData || []).forEach(part => {
        const pObj = part.player || {};
        const pid = (part.playerId || pObj._id || pObj.id || part.player)?.toString();
        if (pid && !eligiblePlayers.some(ep => ep.playerId.toString() === pid)) {
            eligiblePlayers.push({
                playerId: pid,
                name: pObj.name || 'Athlete',
                sport: pObj.sport || match.sport,
                attendanceStatus: 'present',
                participation: pObj.defaultParticipation || 'both'
            });
        }
    });
    (match.selectedPlayers || []).forEach(p => {
        const pid = (p._id || p.id || p).toString();
        if (pid && !eligiblePlayers.some(ep => ep.playerId.toString() === pid)) {
            eligiblePlayers.push({
                playerId: pid,
                name: p.name || 'Athlete',
                sport: p.sport || match.sport,
                attendanceStatus: 'present',
                participation: p.defaultParticipation || 'both'
            });
        }
    });

    const eligibleIdSet = new Set(eligiblePlayers.map(p => p.playerId.toString()));

    // Filter selectedIds to only those who are actually eligible (or existing participants if completed)
    const rawSelected = (match.selectedPlayers || []).map(p => (p._id || p.id || p).toString());
    const validSelected = isCompleted ? rawSelected : rawSelected.filter(id => eligibleIdSet.has(id));
    const selectedIds = new Set(validSelected);
    (activeParticipationData || []).forEach(p => {
        const pid = (p.playerId || p.player?._id || p.player)?.toString();
        if (pid) selectedIds.add(pid);
    });

    // Automatic player selection: If squad was not manually configured yet, pre-select all eligible players
    if (selectedIds.size === 0 && eligiblePlayers.length > 0 && !isCompleted && !isCancelled) {
        eligiblePlayers.forEach(p => {
            selectedIds.add(p.playerId.toString());
        });
    }

    const partMap = new Map();
    (activeParticipationData || []).forEach(p => {
        const pid = (p.playerId || p.player?._id || p.player || '').toString();
        if (pid) partMap.set(pid, p);
    });

    const minTeamSize = match.standardTeamSize || getStandardTeamSize(match.sport);

    let rosterHtml = '';
    if (!elig.sessionFound && !elig.noSessionRequired && !eligiblePlayers.length) {
        const isNotSaved = elig.reason === 'not_saved';
        rosterHtml = `
            <div class="p-6 text-center space-y-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200/80 dark:border-slate-800">
                <div class="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-600 flex items-center justify-center mx-auto">
                    <i data-lucide="${isNotSaved ? 'lock' : 'calendar-x'}" class="w-6 h-6"></i>
                </div>
                <div>
                    <h4 class="font-bold text-sm text-slate-800 dark:text-slate-100 mb-1">
                        ${isNotSaved ? 'Practice Attendance Not Finalized' : 'No Practice Session on Match Date'}
                    </h4>
                    <p class="text-xs text-slate-500 max-w-md mx-auto">
                        ${isNotSaved
                ? 'A dated practice session exists for this fixture date, but its attendance roster has not been saved yet. Save attendance to draft eligible players.'
                : `No practice session was recorded on ${new Date(match.date).toLocaleDateString()} for ${match.sport}. Player eligibility requires practice attendance.`}
                    </p>
                </div>
                <div class="pt-2">
                    ${isNotSaved ? `
                        <button onclick="closeModal(); switchPage('coach-sessions');" class="px-5 py-2.5 rounded-xl text-xs font-bold bg-brand-600 hover:bg-brand-700 text-white cursor-pointer shadow-xs">
                            Go to Sessions & Attendance
                        </button>
                    ` : `
                        <button onclick="closeModal(); openCreateSessionModal();" class="px-5 py-2.5 rounded-xl text-xs font-bold bg-brand-600 hover:bg-brand-700 text-white cursor-pointer shadow-xs">
                            + Open New Training Session
                        </button>
                    `}
                </div>
            </div>
        `;
    } else if (!eligiblePlayers.length) {
        rosterHtml = `
            <div class="p-8 text-center text-slate-400 text-xs space-y-2 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200/80 dark:border-slate-800">
                <i data-lucide="users" class="w-8 h-8 mx-auto opacity-50"></i>
                <p class="font-semibold text-slate-700 dark:text-slate-300">No Eligible Players</p>
                <p>No players were marked Present in the training session for this match date.</p>
            </div>
        `;
    } else {
        const isSelectionLocked = (isCompleted && !isEditReopened) || isCancelled;
        const isUnderMinimumEligible = eligiblePlayers.length < minTeamSize;
        rosterHtml = `
            <div class="space-y-3">
                ${!elig.sessionFound ? `
                    <div class="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300 text-xs flex items-center gap-2">
                        <i data-lucide="info" class="w-4 h-4 shrink-0 text-blue-500"></i>
                        <span>Upcoming Fixture &bull; Draft squad from registered <strong>${escapeHtml(match.sport)}</strong> athletes.</span>
                    </div>
                ` : ''}
                ${isUnderMinimumEligible ? `
                    <div class="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2.5">
                        <i data-lucide="alert-circle" class="w-4 h-4 shrink-0 text-rose-600 mt-0.5"></i>
                        <div>
                            <span class="font-bold">Insufficient Eligible Players for ${escapeHtml(match.sport)}</span>
                            <p class="text-[11px] opacity-90 mt-0.5">
                                ${escapeHtml(match.sport)} requires a minimum of <strong>${minTeamSize} players</strong>, but only <strong>${eligiblePlayers.length}</strong> attended practice on this date.
                                You must mark more players as Present in practice attendance before this match can be completed.
                            </p>
                        </div>
                    </div>
                ` : ''}
                <div class="flex items-center justify-between text-xs px-1">
                    <span class="text-slate-500 dark:text-slate-400">
                        Eligible Squad &bull; <strong id="squad-selection-count" class="text-brand-600 dark:text-brand-400">${selectedIds.size}</strong> selected of ${eligiblePlayers.length} eligible (Minimum: <strong>${minTeamSize} Players</strong>)
                    </span>
                    ${!isSelectionLocked ? `
                        <div class="flex items-center gap-2">
                            <button type="button" onclick="selectAllEligibleSquad(true)" class="text-brand-600 dark:text-brand-400 hover:underline font-bold cursor-pointer">Select All</button>
                            <span class="text-slate-300 dark:text-slate-700">&bull;</span>
                            <button type="button" onclick="selectAllEligibleSquad(false)" class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer">Clear</button>
                        </div>
                    ` : ''}
                </div>

                <div class="max-h-80 overflow-y-auto rounded-xl border border-slate-200/80 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                    ${eligiblePlayers.map(p => {
            const pid = p.playerId.toString();
            const isChecked = selectedIds.has(pid);
            const isCheckboxDisabled = isSelectionLocked;
            const part = partMap.get(pid) || {};
            const playedVal = part.played; // true, false, or null/undefined
            const scoreVal = (part.score !== null && part.score !== undefined) ? part.score : '';
            const remarksVal = part.remarks || '';
            const isReadOnly = (isCompleted && !isEditReopened) || isCancelled;
            const statusBadge = p.attendanceStatus === 'present'
                ? '<span class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">Present</span>'
                : '<span class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-blue-500/10 text-blue-600 border border-blue-500/20">Registered</span>';

            return `
                            <div class="p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors ${isChecked ? 'bg-brand-50/20 dark:bg-brand-950/10' : ''}" data-player-row="${pid}">
                                <!-- Player checkbox & info -->
                                <div class="flex items-center gap-3 min-w-[200px]">
                                    <input 
                                        type="checkbox" 
                                        value="${pid}" 
                                        class="squad-player-checkbox w-4 h-4 rounded text-brand-600 border-slate-300 dark:border-slate-700 focus:ring-brand-500 cursor-pointer disabled:cursor-not-allowed"
                                        ${isChecked ? 'checked' : ''}
                                        ${isCheckboxDisabled ? 'disabled' : ''}
                                        onchange="onToggleSquadCheckbox('${pid}')"
                                        title="Select player for squad"
                                    >
                                    <div>
                                        <div class="flex items-center gap-2">
                                            <span class="font-bold text-xs text-slate-800 dark:text-slate-100">${escapeHtml(p.name)}</span>
                                            ${statusBadge}
                                        </div>
                                        <span class="text-[11px] text-slate-400 block">${escapeHtml(p.sport)}</span>
                                    </div>
                                </div>

                                <!-- Right side: Before unlock vs After unlock -->
                                <div class="flex-1 flex items-center justify-end">
                                    ${!isScoringUnlocked ? `
                                        <!-- Before Unlock: Show clean squad badge only, no scoring inputs -->
                                        <div id="row-locked-badge-${pid}">
                                            ${isChecked ? `
                                                <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-brand-500/10 text-brand-600 border border-brand-500/20">
                                                    <i data-lucide="check" class="w-3.5 h-3.5"></i> Selected in Squad
                                                </span>
                                            ` : `
                                                <span class="text-xs text-slate-400">Available</span>
                                            `}
                                        </div>
                                    ` : `
                                        <!-- After Unlock: Interactive Played / Did Not Play & Score Input (Score input visible only if Played) -->
                                        <div id="row-scoring-controls-${pid}" class="${isChecked ? 'flex' : 'hidden'} items-center gap-2 flex-wrap justify-end">
                                            <!-- Status Toggle -->
                                            <div class="flex items-center rounded-xl border border-slate-200 dark:border-slate-700 p-1 bg-slate-100 dark:bg-slate-800">
                                                <button 
                                                    type="button" 
                                                    onclick="setUnifiedParticipationStatus('${pid}', true)"
                                                    class="part-status-btn-played-${pid} px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${playedVal === true ? 'bg-emerald-600 text-white shadow-2xs' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}"
                                                    ${isReadOnly ? 'disabled' : ''}
                                                >
                                                    Played
                                                </button>
                                                <button 
                                                    type="button" 
                                                    onclick="setUnifiedParticipationStatus('${pid}', false)"
                                                    class="part-status-btn-dnp-${pid} px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${playedVal === false ? 'bg-rose-600 text-white shadow-2xs' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}"
                                                    ${isReadOnly ? 'disabled' : ''}
                                                >
                                                    Did Not Play
                                                </button>
                                            </div>

                                            <!-- Score Input: Only displayed when player is marked Played -->
                                            <div id="part-score-wrap-${pid}" class="${playedVal === true ? 'w-24' : 'w-24 hidden'}">
                                                <input 
                                                    id="part-score-${pid}" 
                                                    type="number" 
                                                    min="0"
                                                    max="20"
                                                    placeholder="0-20" 
                                                    value="${scoreVal}"
                                                    class="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 text-sm font-bold outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 dark:text-slate-100 disabled:opacity-40 disabled:bg-slate-100 dark:disabled:bg-slate-900"
                                                    ${playedVal !== true || isReadOnly ? 'disabled' : ''}
                                                >
                                            </div>
                                        </div>
                                        <div id="row-unselected-msg-${pid}" class="${isChecked ? 'hidden' : 'block'} text-xs text-slate-400 italic">
                                            (Not in squad)
                                        </div>
                                    `}
                                </div>
                            </div>
                        `;
        }).join('')}
                </div>
            </div>
        `;
    }

    const html = `
        <div class="space-y-4">
            <!-- A. Match Details Overview Card -->
            <div class="p-4 rounded-2xl bg-slate-50/90 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 space-y-3">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-200/60 dark:border-slate-700/60">
                    <div>
                        <div class="flex items-center gap-2 flex-wrap">
                            <h4 class="font-bold text-base text-slate-900 dark:text-white">${escapeHtml(cleanMatchTitle(match.title, match.sport))}</h4>
                            <span class="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border ${statusBadgeClass}">${timeStatusDisplay}</span>
                        </div>
                        <p class="text-xs text-slate-500 mt-0.5">
                            <span class="font-bold text-brand-600 dark:text-brand-400">${escapeHtml(match.sport)}</span> &bull; 
                            <span class="font-semibold text-slate-700 dark:text-slate-300">vs ${escapeHtml(cleanOpponentName(match.opponent, match.sport))}</span>
                        </p>
                    </div>
                    <div class="flex items-center gap-2 self-start sm:self-auto">
                        <span class="px-2.5 py-1 rounded-xl text-xs font-bold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shadow-2xs">
                            Eligible: <b class="text-indigo-600 dark:text-indigo-400">${eligiblePlayers.length} Players</b>
                        </span>
                    </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <div class="flex items-center gap-2">
                        <i data-lucide="calendar" class="w-3.5 h-3.5 text-slate-400 shrink-0"></i>
                        <span><strong>Date & Time:</strong> ${new Date(match.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} &bull; ${escapeHtml(match.time)}</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <i data-lucide="map-pin" class="w-3.5 h-3.5 text-slate-400 shrink-0"></i>
                        <span><strong>Venue:</strong> ${escapeHtml(match.venue || 'Standard Ground')}</span>
                    </div>
                </div>

                ${match.description ? `
                    <div class="pt-2 text-[11px] text-slate-500 dark:text-slate-400 border-t border-slate-200/50 dark:border-slate-800/50 flex items-start gap-1.5">
                        <i data-lucide="file-text" class="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5"></i>
                        <span class="italic">${escapeHtml(match.description)}</span>
                    </div>
                ` : ''}
            </div>

            <!-- C. Timing / Scoring Availability Banner -->
            ${isEditReopened ? `
                <div class="p-3.5 rounded-xl border flex items-center justify-between text-xs bg-amber-500/10 border-amber-500/20 text-amber-800 dark:text-amber-300">
                    <div class="flex items-center gap-2">
                        <i data-lucide="edit-3" class="w-4 h-4 shrink-0 text-amber-600"></i>
                        <span><strong>Match Reopened for Editing.</strong> Update player participation or scores, then click <strong>Save Changes</strong>.</span>
                    </div>
                    <span class="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-amber-600 text-white shrink-0">Edit Mode</span>
                </div>
            ` : (isCompleted ? `
                <div class="p-3.5 rounded-xl border flex items-center justify-between text-xs bg-emerald-500/10 border-emerald-500/20 text-emerald-800 dark:text-emerald-300">
                    <div class="flex items-center gap-2">
                        <i data-lucide="award" class="w-4 h-4 shrink-0 text-emerald-600"></i>
                        <span><strong>Match Completed.</strong> Player scores and participation records are saved permanently.</span>
                    </div>
                </div>
            ` : (!isScoringUnlocked ? `
                <div class="p-3.5 rounded-xl border flex items-start sm:items-center justify-between text-xs bg-sky-500/10 border-sky-500/20 text-sky-800 dark:text-sky-300 gap-2">
                    <div class="flex items-center gap-2.5">
                        <i data-lucide="lock" class="w-4 h-4 shrink-0 text-sky-600 mt-0.5 sm:mt-0"></i>
                        <div>
                            <span class="font-bold">Scoring will unlock at ${sched.unlockTimeStr}</span>
                            <span class="block text-[11px] opacity-80 mt-0.5">Participation status and score inputs remain locked until 60 minutes after match kickoff.</span>
                        </div>
                    </div>
                    <span class="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-sky-600 text-white shrink-0">Locked</span>
                </div>
            ` : `
                <div class="p-3.5 rounded-xl border flex items-start sm:items-center justify-between text-xs bg-emerald-500/10 border-emerald-500/20 text-emerald-800 dark:text-emerald-300 gap-2">
                    <div class="flex items-center gap-2.5">
                        <i data-lucide="unlock" class="w-4 h-4 shrink-0 text-emerald-600 mt-0.5 sm:mt-0"></i>
                        <div>
                            <span class="font-bold">Scoring is now available</span>
                            <span class="block text-[11px] opacity-80 mt-0.5">Mark selected squad members as Played or Did Not Play and enter their scores.</span>
                        </div>
                    </div>
                    <span class="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-emerald-600 text-white shrink-0">Unlocked</span>
                </div>
            `))}

            <!-- B. Single Unified Match Management Roster -->
            <div id="unified-match-roster-container">
                ${rosterHtml}
            </div>
        </div>
    `;

    // D. Action Buttons
    const footerButtons = [];
    const mId = (match._id || match.id).toString();

    if (!isCompleted && !isCancelled) {
        // Cancel Fixture (left-aligned via mr-auto)
        footerButtons.push({
            label: 'Cancel Fixture',
            class: 'mr-auto px-3.5 py-2 rounded-xl text-xs font-bold bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 cursor-pointer transition-colors',
            action: `confirmCancelMatch('${mId}', '${escapeQuotes(cleanMatchTitle(match.title, match.sport))}')`
        });

        if (elig.sessionFound || elig.noSessionRequired || eligiblePlayers.length > 0) {
            if (!isScoringUnlocked) {
                // Before scoring unlock: only Save Squad
                footerButtons.push({
                    label: 'Save Squad',
                    class: 'px-5 py-2 rounded-xl text-xs sm:text-sm font-bold bg-brand-600 hover:bg-brand-700 text-white cursor-pointer shadow-xs',
                    action: `saveUnifiedMatch('${mId}', false)`
                });
            } else {
                // After scoring unlock: Save & Complete Match only
                const isUnderMinimum = eligiblePlayers.length < minTeamSize;
                footerButtons.push({
                    label: 'Save & Complete Match',
                    class: isUnderMinimum 
                        ? 'px-5 py-2 rounded-xl text-xs sm:text-sm font-bold bg-emerald-600/50 text-white/70 cursor-not-allowed shadow-xs'
                        : 'px-5 py-2 rounded-xl text-xs sm:text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-xs',
                    action: isUnderMinimum 
                        ? `showToast('${escapeQuotes(match.sport)} requires at least ${minTeamSize} eligible players to complete, but only ${eligiblePlayers.length} attended practice.', 'error')` 
                        : `saveUnifiedMatch('${mId}', true)`
                });
            }
        }
    } else if (isEditReopened) {
        footerButtons.push({
            label: 'Cancel',
            class: 'px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer',
            action: 'closeModal()'
        });
        footerButtons.push({
            label: 'Save Changes',
            class: 'px-5 py-2 rounded-xl text-sm font-bold bg-brand-600 hover:bg-brand-700 text-white cursor-pointer shadow-xs',
            action: `saveUnifiedMatch('${mId}', false)`
        });
    }

    openModal(
        isEditReopened ? 'Edit Match Scores & Participation' : (isCompleted ? 'Match Scorecard' : 'Manage Match'),
        html,
        footerButtons,
        'max-w-3xl'
    );
}

function onToggleSquadCheckbox(playerId) {
    if (!activeMatchData) return;
    const checkedBoxes = document.querySelectorAll('.squad-player-checkbox:checked');
    const count = checkedBoxes.length;

    const countEl = document.getElementById('squad-selection-count');
    if (countEl) countEl.innerText = count;

    const sched = getClientMatchScheduleInfo(activeMatchData);
    const isUnlocked = activeMatchData.status === 'completed' || sched.isUnlocked;
    if (isUnlocked && playerId) {
        const rowCb = document.querySelector(`.squad-player-checkbox[value="${playerId}"]`);
        const scoringControls = document.getElementById(`row-scoring-controls-${playerId}`);
        const unselectedMsg = document.getElementById(`row-unselected-msg-${playerId}`);
        if (rowCb && scoringControls && unselectedMsg) {
            if (rowCb.checked) {
                scoringControls.classList.remove('hidden');
                scoringControls.classList.add('flex');
                unselectedMsg.classList.add('hidden');
                unselectedMsg.classList.remove('block');
            } else {
                scoringControls.classList.add('hidden');
                scoringControls.classList.remove('flex');
                unselectedMsg.classList.remove('hidden');
                unselectedMsg.classList.add('block');
            }
        }
    }
}

function setUnifiedParticipationStatus(playerId, isPlayed) {
    const scoreInput = document.getElementById(`part-score-${playerId}`);
    const scoreWrap = document.getElementById(`part-score-wrap-${playerId}`);
    const playedBtn = document.querySelector(`.part-status-btn-played-${playerId}`);
    const dnpBtn = document.querySelector(`.part-status-btn-dnp-${playerId}`);

    if (isPlayed) {
        if (playedBtn) playedBtn.className = `part-status-btn-played-${playerId} px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer bg-emerald-600 text-white shadow-2xs`;
        if (dnpBtn) dnpBtn.className = `part-status-btn-dnp-${playerId} px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer text-slate-500 hover:text-slate-800 dark:hover:text-slate-200`;
        if (scoreWrap) scoreWrap.classList.remove('hidden');
        if (scoreInput) {
            scoreInput.disabled = false;
            if (!scoreInput.value) scoreInput.value = '0';
        }
    } else {
        if (playedBtn) playedBtn.className = `part-status-btn-played-${playerId} px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer text-slate-500 hover:text-slate-800 dark:hover:text-slate-200`;
        if (dnpBtn) dnpBtn.className = `part-status-btn-dnp-${playerId} px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer bg-rose-600 text-white shadow-2xs`;
        if (scoreWrap) scoreWrap.classList.add('hidden');
        if (scoreInput) {
            scoreInput.value = '';
            scoreInput.disabled = true;
        }
    }

    let part = (activeParticipationData || []).find(p => (p.playerId || p.player?._id || p.player)?.toString() === playerId);
    if (!part) {
        part = { playerId, played: isPlayed, score: isPlayed ? 0 : null, remarks: '' };
        activeParticipationData.push(part);
    } else {
        part.played = isPlayed;
        if (!isPlayed) part.score = null;
    }
}

function selectAllEligibleSquad(selectAll) {
    if (!activeMatchData) return;
    const checkboxes = Array.from(document.querySelectorAll('.squad-player-checkbox'));

    checkboxes.forEach(cb => {
        if (!cb.disabled) cb.checked = selectAll;
    });

    checkboxes.forEach(cb => {
        onToggleSquadCheckbox(cb.value);
    });
}

async function saveUnifiedMatch(matchId, complete = false) {
    if (!matchId) return;
    const checkboxes = document.querySelectorAll('.squad-player-checkbox:checked');
    const selectedPlayerIds = Array.from(checkboxes).map(cb => cb.value);

    const match = activeMatchData || {};
    const isCompleted = match.status === 'completed';
    const isEditReopened = isCompleted && match.editUnlockedUntil && new Date(match.editUnlockedUntil).getTime() > Date.now();
    const minTeamSize = match.standardTeamSize || getStandardTeamSize(match.sport);
    if (selectedPlayerIds.length < minTeamSize) {
        showToast(`${match.sport || 'This sport'} requires at least ${minTeamSize} players in the squad, but only ${selectedPlayerIds.length} are selected.`, 'error');
        return;
    }

    const sched = getClientMatchScheduleInfo(match);
    const isUnlocked = isCompleted || sched.isUnlocked;

    const participations = [];
    if (isUnlocked) {
        for (const pid of selectedPlayerIds) {
            const playedBtn = document.querySelector(`.part-status-btn-played-${pid}`);
            const dnpBtn = document.querySelector(`.part-status-btn-dnp-${pid}`);
            const isPlayedActive = playedBtn?.classList.contains('bg-emerald-600');
            const isDnpActive = dnpBtn?.classList.contains('bg-rose-600');

            let played = null;
            if (isPlayedActive) played = true;
            else if (isDnpActive) played = false;

            const scoreVal = document.getElementById(`part-score-${pid}`)?.value;
            const remarks = (document.getElementById(`part-remarks-${pid}`)?.value || '').trim();

            let score = null;
            if (played === true) {
                if (scoreVal !== '' && !isNaN(scoreVal)) {
                    const parsed = parseInt(scoreVal, 10);
                    if (parsed < 0 || parsed > 20) {
                        showToast('Scores must be strictly between 0 and 20.', 'error');
                        return;
                    }
                    score = parsed;
                } else {
                    score = 0;
                }
            }

            participations.push({ playerId: pid, played, score, remarks });
        }
    }

    if (complete) {
        if (!isUnlocked) {
            showToast('Cannot complete match before scoring unlock time', 'error');
            return;
        }
        if (selectedPlayerIds.length === 0) {
            showToast('Please select at least one player in the squad before completing the match.', 'error');
            return;
        }
        const unset = participations.filter(p => p.played === null || p.played === undefined);
        if (unset.length > 0) {
            showToast('All selected players must have Played or Did Not Play status recorded before completing the match.', 'error');
            return;
        }
    }

    try {
        isLocalMutationInProgress = true;
        const res = await api(`/api/matches/${matchId}/save-all`, {
            method: 'POST',
            body: { selectedPlayerIds, participations, complete }
        });

        if (complete) {
            showToast('Match saved and completed successfully!', 'success');
            closeModal();
            switchPage('coach-matches');
            switchMatchTab('completed');
        } else if (isCompleted || isEditReopened) {
            showToast('Match changes saved successfully!', 'success');
            closeModal();
            switchPage('coach-matches');
            switchMatchTab('completed');
        } else {
            showToast(isUnlocked ? 'Draft saved successfully!' : 'Squad saved successfully!', 'success');
            closeModal();
            switchPage('coach-matches');
            switchMatchTab('upcoming');
        }

        await Promise.all([
            loadMatchData(),
            loadCoachPlayers(),
            loadSessions(),
            loadCoachStats()
        ]);
        cachedPlayers = await api('/api/players');
        broadcastSyncEvent('match', complete ? 'completed' : 'updated', { entityId: matchId });
    } catch (err) {
        showToast(err.message || 'Failed to save match data', 'error');
    } finally {
        isLocalMutationInProgress = false;
    }
}

// Backward compatibility wrappers
async function switchSquadModalTab(tab) {
    return;
}
function updateSquadSelectionCounter() {
    onToggleSquadCheckbox();
}
async function submitSaveMatchSquad(matchId) {
    return saveUnifiedMatch(matchId, false);
}
function setParticipationStatus(playerId, isPlayed) {
    setUnifiedParticipationStatus(playerId, isPlayed);
}
async function saveAllParticipationRows(matchId, silent = false) {
    return saveUnifiedMatch(matchId, false);
}
async function submitCompleteMatch(matchId) {
    return saveUnifiedMatch(matchId, true);
}

function onMatchDateChange() {
    // Handled in Phase 8/9
}

function handleRecordMatch(e) {
    if (e && e.preventDefault) e.preventDefault();
}

window.escapeHtml = escapeHtml;
window.escapeQuotes = escapeQuotes;
window.openAddMatchModal = openAddMatchModal;
window.submitCreateMatch = submitCreateMatch;
window.openMatchDetailsModal = openMatchDetailsModal;
window.openMatchResultModal = openMatchResultModal;
window.saveMatchResultScores = saveMatchResultScores;
window.cleanMatchTitle = cleanMatchTitle;
window.cleanOpponentName = cleanOpponentName;
window.openEditMatchModal = openEditMatchModal;
window.submitEditMatch = submitEditMatch;
window.confirmCancelMatch = confirmCancelMatch;
window.executeCancelMatch = executeCancelMatch;
window.confirmDeleteMatch = confirmDeleteMatch;
window.executeDeleteMatch = executeDeleteMatch;
window.reopenMatchForEdit = reopenMatchForEdit;
window.openManageMatchPlayersModal = openManageMatchPlayersModal;
window.saveUnifiedMatch = saveUnifiedMatch;
window.onToggleSquadCheckbox = onToggleSquadCheckbox;
window.setUnifiedParticipationStatus = setUnifiedParticipationStatus;
window.switchSquadModalTab = switchSquadModalTab;
window.selectAllEligibleSquad = selectAllEligibleSquad;
window.updateSquadSelectionCounter = updateSquadSelectionCounter;
window.submitSaveMatchSquad = submitSaveMatchSquad;
window.setParticipationStatus = setParticipationStatus;
window.saveAllParticipationRows = saveAllParticipationRows;
window.submitCompleteMatch = submitCompleteMatch;
window.onMatchDateChange = onMatchDateChange;
window.handleRecordMatch = handleRecordMatch;
window.switchPage = switchPage;
window.toggleDarkMode = toggleDarkMode;
window.toggleNotifications = toggleNotifications;
window.logout = logout;
window.closeModal = closeModal;
window.toggleDetailPlayerStatus = toggleDetailPlayerStatus;
window.backFromRosterView = backFromRosterView;
window.toggleSessionLock = toggleSessionLock;
if (typeof confirmLockSession !== 'undefined') window.confirmLockSession = confirmLockSession;
if (typeof executeLockSession !== 'undefined') window.executeLockSession = executeLockSession;
if (typeof saveAndLockRosterAttendance !== 'undefined') window.saveAndLockRosterAttendance = saveAndLockRosterAttendance;
if (typeof executeSaveAndLockRoster !== 'undefined') window.executeSaveAndLockRoster = executeSaveAndLockRoster;
if (typeof confirmRemovePlayer !== 'undefined') window.confirmRemovePlayer = confirmRemovePlayer;
if (typeof executeRemovePlayer !== 'undefined') window.executeRemovePlayer = executeRemovePlayer;
window.openEditPlayerModal = openEditPlayerModal;
window.submitEditPlayer = submitEditPlayer;
window.openTodayRegisterModal = openTodayRegisterModal;
window.openTakeAttendanceAction = openTakeAttendanceAction;
window.searchGlobalAcademy = searchGlobalAcademy;
window.performGlobalSearch = performGlobalSearch;
window.clearGlobalSearch = clearGlobalSearch;
window.handleGlobalSearchInput = handleGlobalSearchInput;
window.handleGlobalSearchKeyDown = handleGlobalSearchKeyDown;
window.filterPlayersByQuery = filterPlayersByQuery;
try {
    Object.defineProperty(window, 'currentSearchQuery', {
        get: () => currentSearchQuery,
        set: (v) => { currentSearchQuery = v; },
        configurable: true
    });
} catch (_) {}
window.exportScoutReportPDF = exportScoutReportPDF;
window.loadAdminStaff = loadAdminStaff;
window.renderAdminStaffTable = renderAdminStaffTable;
window.openAddStaffModal = openAddStaffModal;
window.submitAddStaff = submitAddStaff;
window.generateNewPasswordForInput = generateNewPasswordForInput;
window.openEditStaffModal = openEditStaffModal;
window.submitEditStaff = submitEditStaff;
window.openResetStaffPasswordModal = openResetStaffPasswordModal;
window.submitResetStaffPassword = submitResetStaffPassword;
window.showStaffCredentialsModal = showStaffCredentialsModal;
window.confirmDeleteStaff = confirmDeleteStaff;
window.executeDeleteStaff = executeDeleteStaff;
window.executeDeleteStaffWithReassign = executeDeleteStaffWithReassign;

// ── Resizable Left Sidebar ──────────────────────────────────────────────────
function initSidebarResizer() {
    const sidebar = document.getElementById('app-sidebar');
    const resizer = document.getElementById('sidebar-resizer');
    if (!sidebar || !resizer) return;

    const MIN_WIDTH = 190;
    const MAX_WIDTH = 320;
    const DEFAULT_WIDTH = 260;

    // Restore saved width from localStorage
    try {
        const savedWidth = parseInt(localStorage.getItem('maidan_sidebar_width'), 10);
        if (!isNaN(savedWidth) && savedWidth >= MIN_WIDTH && savedWidth <= MAX_WIDTH) {
            sidebar.style.width = `${savedWidth}px`;
        } else {
            sidebar.style.width = `${DEFAULT_WIDTH}px`;
        }
    } catch {
        sidebar.style.width = `${DEFAULT_WIDTH}px`;
    }

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = sidebar.getBoundingClientRect().width;

        // Prevent text selection and lag while dragging
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
        sidebar.style.transition = 'none';

        const onMouseMove = (moveEvent) => {
            if (!isResizing) return;
            const delta = moveEvent.clientX - startX;
            let newWidth = startWidth + delta;
            if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH;
            if (newWidth > MAX_WIDTH) newWidth = MAX_WIDTH;
            sidebar.style.width = `${newWidth}px`;
        };

        const onMouseUp = () => {
            if (!isResizing) return;
            isResizing = false;
            document.body.style.userSelect = '';
            document.body.style.cursor = '';

            // Restore smooth transition after drag completes
            sidebar.style.transition = 'width 0.15s ease, background-color 0.2s ease, border-color 0.2s ease';

            const finalWidth = Math.round(sidebar.getBoundingClientRect().width);
            try {
                localStorage.setItem('maidan_sidebar_width', finalWidth.toString());
            } catch { }

            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    });

    // Double-click to quickly reset to default width (260px)
    resizer.addEventListener('dblclick', () => {
        sidebar.style.transition = 'width 0.2s ease';
        sidebar.style.width = `${DEFAULT_WIDTH}px`;
        try {
            localStorage.setItem('maidan_sidebar_width', DEFAULT_WIDTH.toString());
        } catch { }
    });
}

window.addEventListener('beforeunload', () => {
    stopGreetingTimer();
});

function hideLoadingSplash() {
    const splash = document.getElementById('app-loading-splash');
    if (splash) {
        splash.style.opacity = '0';
        setTimeout(() => {
            splash.remove();
            document.documentElement.classList.remove('app-splash-active');
        }, 180);
    } else {
        document.documentElement.classList.remove('app-splash-active');
    }
}

function handleAuthInitFailure(reason) {
    console.warn('[AuthInit] Redirecting to login:', reason);
    try {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
    } catch (_) {}

    const redirected = sessionStorage.getItem('maidan_auth_redirected');
    if (!redirected) {
        sessionStorage.setItem('maidan_auth_redirected', 'true');
        window.location.replace('/');
    } else {
        hideLoadingSplash();
        window.location.replace('/');
    }
}

function initGlobalSearchListeners() {
    const searchInput = document.getElementById('header-global-search');
    if (!searchInput || searchInput.dataset.searchBound) return;
    searchInput.dataset.searchBound = 'true';

    searchInput.addEventListener('input', (e) => {
        handleGlobalSearchInput(e.target.value);
    });

    searchInput.addEventListener('keydown', (e) => {
        handleGlobalSearchKeyDown(e);
    });
}

// On page load: check if already logged in with JWT
document.addEventListener('DOMContentLoaded', async () => {
    applySavedTheme();
    initIcons();
    initSidebarResizer();
    initGlobalSearchListeners();

    const storedUser = localStorage.getItem('user');
    if (!authToken || !storedUser) {
        handleAuthInitFailure('Missing auth credentials');
        return;
    }

    try {
        currentUser = JSON.parse(storedUser);
        if (currentUser.role === 'scout') {
            window.location.replace('/app/scout');
            return;
        }

        // Render immediately with cached profile for instantaneous display
        renderAppForUser(currentUser.role, currentUser);
        if (currentUser.role === 'player' && currentUser.mustChangePassword) {
            openMandatoryPasswordChangeModal();
        }

        // Validate token with /api/auth/me to ensure it's still valid
        try {
            const meRes = await fetch('/api/auth/me', {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            if (meRes.status === 401 || meRes.status === 403) {
                handleAuthInitFailure('Session expired or unauthorized');
                return;
            }
            if (meRes.ok) {
                const freshUser = await meRes.json();
                if (freshUser && freshUser.role) {
                    currentUser = { ...currentUser, ...freshUser };
                    localStorage.setItem('user', JSON.stringify(currentUser));
                    sessionStorage.removeItem('maidan_auth_redirected');
                }
            }
        } catch (fetchErr) {
            console.warn('[AuthInit] Network error checking /api/auth/me; continuing with cached session:', fetchErr);
        }
    } catch (parseErr) {
        console.error('[AuthInit] Corrupt user profile JSON in localStorage:', parseErr);
        handleAuthInitFailure('Corrupt session');
        return;
    } finally {
        hideLoadingSplash();
    }
});
