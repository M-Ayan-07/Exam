/* login.js — Professional auth flow with session management */

// ── Session expiry check (fix resume bug) ────────────────────────────────────
// Clears localStorage if token is expired or older than 8 hours
function isTokenExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true; // If we can't parse it, treat as expired
  }
}

function clearAuth() {
  localStorage.removeItem('token');
  localStorage.removeItem('role');
  localStorage.removeItem('userName');
  localStorage.removeItem('lastSessionId');
}

// ── Check existing session on page load ───────────────────────────────────────
(function checkExistingSession() {
  const token = localStorage.getItem('token');
  const role  = localStorage.getItem('role');

  if (!token || !role) return; // No session — show login normally

  // If token is expired, clear everything and show login
  if (isTokenExpired(token)) {
    clearAuth();
    return;
  }

  // Valid token exists — show session banner instead of auto-redirecting
  const banner  = document.getElementById('session-banner');
  const bannerMsg = document.getElementById('session-banner-msg');

  if (role === 'student') {
    bannerMsg.textContent = `You are signed in as a Student. Resume your exam or sign out to switch accounts.`;
  } else {
    bannerMsg.textContent = `You are signed in as an Invigilator. Go to your dashboard or sign out to switch accounts.`;
  }

  banner.classList.add('show');
})();

// ── Session banner actions ────────────────────────────────────────────────────
function resumeSession() {
  const role = localStorage.getItem('role');
  window.location.href = role === 'invigilator' ? '/dashboard.html' : '/preexam.html';
}

function clearSession() {
  clearAuth();
  document.getElementById('session-banner').classList.remove('show');
  showPortalSelector();
}

// ── Handle landing page redirect (register tab) ───────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const openTab = sessionStorage.getItem('openTab');
  if (openTab === 'register') {
    sessionStorage.removeItem('openTab');
    selectPortal('invigilator');
    switchInvigilatorTab('register');
  }
});

// ── Portal selector ───────────────────────────────────────────────────────────
let currentPortal = null;

function selectPortal(role) {
  currentPortal = role;

  // Highlight selected card
  document.getElementById('card-student').classList.remove('selected', 'selected-green');
  document.getElementById('card-invigilator').classList.remove('selected', 'selected-green');

  if (role === 'student') {
    document.getElementById('card-student').classList.add('selected');
  } else {
    document.getElementById('card-invigilator').classList.add('selected-green');
  }

  // Small delay for card animation to feel responsive
  setTimeout(() => {
    document.getElementById('portal-selector').style.display = 'none';
    document.getElementById(`auth-${role}`).classList.add('visible');
  }, 150);
}

function backToSelector() {
  document.getElementById('auth-student').classList.remove('visible');
  document.getElementById('auth-invigilator').classList.remove('visible');
  document.getElementById('portal-selector').style.display = 'block';
  document.getElementById('card-student').classList.remove('selected', 'selected-green');
  document.getElementById('card-invigilator').classList.remove('selected', 'selected-green');
  hideAlert('student');
  hideAlert('invigilator');
  currentPortal = null;
}

function showPortalSelector() {
  backToSelector();
}

// ── Tab switchers ─────────────────────────────────────────────────────────────
function switchStudentTab(tab) {
  document.getElementById('stab-signin').classList.remove('active', 'active-blue');
  document.getElementById('stab-register').classList.remove('active', 'active-blue');
  document.getElementById('spanel-signin').classList.remove('active');
  document.getElementById('spanel-register').classList.remove('active');
  document.getElementById(`stab-${tab}`).classList.add('active', 'active-blue');
  document.getElementById(`spanel-${tab}`).classList.add('active');
  hideAlert('student');
}

function switchInvigilatorTab(tab) {
  document.getElementById('itab-signin').classList.remove('active', 'active-green');
  document.getElementById('itab-register').classList.remove('active', 'active-green');
  document.getElementById('ipanel-signin').classList.remove('active');
  document.getElementById('ipanel-register').classList.remove('active');
  document.getElementById(`itab-${tab}`).classList.add('active', 'active-green');
  document.getElementById(`ipanel-${tab}`).classList.add('active');
  hideAlert('invigilator');
}

// ── Alert helpers ─────────────────────────────────────────────────────────────
function showAlert(portal, msg, type = 'error') {
  const el = document.getElementById(`lp-alert-${portal}`);
  if (!el) return;
  el.textContent = (type === 'error' ? '⚠️ ' : type === 'success' ? '✓ ' : 'ℹ️ ') + msg;
  el.className = `lp-alert ${type} show`;
}

function hideAlert(portal) {
  const el = document.getElementById(`lp-alert-${portal}`);
  if (el) el.className = 'lp-alert';
}

// ── Button loading state ──────────────────────────────────────────────────────
function setLoading(btnId, loading, label = 'Sign In') {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled    = loading;
  btn.textContent = loading ? 'Please wait...' : label;
}

// ── Sign In ───────────────────────────────────────────────────────────────────
async function handleSignIn(e, portal) {
  e.preventDefault();
  hideAlert(portal);

  const prefix   = portal === 'student' ? 's' : 'i';
  const email    = document.getElementById(`${prefix}-signin-email`).value.trim();
  const password = document.getElementById(`${prefix}-signin-password`).value;
  const btnId    = `${prefix}-signin-btn`;

  if (!email || !password) return showAlert(portal, 'Please enter your email and password.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showAlert(portal, 'Please enter a valid email address (e.g. name@example.com).');

  setLoading(btnId, true, 'Sign In');
  try {
    const res  = await fetch('/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password, expectedRole: portal })
    });
    const data = await res.json();

    if (!res.ok) return showAlert(portal, data.error || 'Sign in failed. Please try again.');

    // Role mismatch — user signed in via wrong portal
    if (data.role !== portal) {
      return showAlert(portal,
        `This account is registered as a ${data.role}. Please use the ${data.role} portal.`
      );
    }

    // Store auth
    localStorage.setItem('token',    data.token);
    localStorage.setItem('role',     data.role);
    localStorage.setItem('userName', data.name);
    localStorage.setItem('loginTime', Date.now().toString());

    showAlert(portal, 'Signed in successfully! Redirecting...', 'success');
    setTimeout(() => {
      window.location.href = data.role === 'invigilator' ? '/dashboard.html' : '/preexam.html';
    }, 600);

  } catch {
    showAlert(portal, 'Network error. Is the server running?');
  } finally {
    setLoading(btnId, false, 'Sign In');
  }
}

// ── Register ──────────────────────────────────────────────────────────────────
async function handleRegister(e, portal) {
  e.preventDefault();
  hideAlert(portal);

  const prefix   = portal === 'student' ? 's' : 'i';
  const name     = document.getElementById(`${prefix}-reg-name`).value.trim();
  const email    = document.getElementById(`${prefix}-reg-email`).value.trim();
  const password = document.getElementById(`${prefix}-reg-password`).value;
  const btnId    = `${prefix}-reg-btn`;
  const label    = portal === 'student' ? 'Create Student Account' : 'Create Invigilator Account';

  if (!name || !email || !password) return showAlert(portal, 'All fields are required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showAlert(portal, 'Please enter a valid email address (e.g. name@example.com).');
  if (password.length < 6) return showAlert(portal, 'Password must be at least 6 characters.');

  setLoading(btnId, true, label);
  try {
    const res  = await fetch('/api/auth/register', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, email, password, role: portal })
    });
    const data = await res.json();

    if (!res.ok) return showAlert(portal, data.error || 'Registration failed.');

    // Store auth
    localStorage.setItem('token',    data.token);
    localStorage.setItem('role',     data.role);
    localStorage.setItem('userName', data.name);
    localStorage.setItem('loginTime', Date.now().toString());

    showAlert(portal, 'Account created! Redirecting...', 'success');
    setTimeout(() => {
      window.location.href = data.role === 'invigilator' ? '/dashboard.html' : '/preexam.html';
    }, 700);

  } catch {
    showAlert(portal, 'Network error. Is the server running?');
  } finally {
    setLoading(btnId, false, label);
  }
}