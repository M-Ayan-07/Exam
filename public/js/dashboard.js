/* dashboard.js — invigilator dashboard logic */

const token    = localStorage.getItem('token');
const role     = localStorage.getItem('role');
const userName = localStorage.getItem('userName') || 'Invigilator';

// Auth guard — dashboard is invigilator only
if (!token || role !== 'invigilator') {
  window.location.href = '/login.html';
}

document.getElementById('inv-name').textContent = userName;

function logout() {
  localStorage.clear();
  window.location.href = '/login.html';
}

function show(id) { document.getElementById(id).style.display = 'block'; }
function hide(id) { document.getElementById(id).style.display = 'none'; }

function credBadge(score) {
  if (score >= 75) return `<span class="badge badge-success">${score}</span>`;
  if (score >= 50) return `<span class="badge badge-warning">${score}</span>`;
  return `<span class="badge badge-danger">${score}</span>`;
}

function formatDate(iso) {
  try { return new Date(iso).toLocaleString(); }
  catch { return iso; }
}

// ── Load All Sessions ─────────────────────────────────────────────────────────
async function loadSessions() {
  hide('dash-content');
  hide('dash-error');
  show('dash-loading');

  try {
    const res = await fetch('/api/dashboard/sessions', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to load sessions');
    }

    const sessions = await res.json();
    hide('dash-loading');
    show('dash-content');

    renderDashboard(sessions);
  } catch (err) {
    hide('dash-loading');
    show('dash-error');
    document.getElementById('dash-error-msg').textContent = err.message;
  }
}

function renderDashboard(sessions) {
  const total = sessions.length;
  document.getElementById('stat-total').textContent = total;

  if (total === 0) {
    document.getElementById('stat-avg-exam').textContent = '—';
    document.getElementById('stat-avg-cred').textContent = '—';
    document.getElementById('stat-flagged').textContent = '0';
    hide('sessions-table-wrap');
    show('no-sessions');
    return;
  }

  // Calculate summary stats
  const avgExam = Math.round(sessions.reduce((s, r) => s + (r.score || 0), 0) / total);
  const avgCred = Math.round(sessions.reduce((s, r) => s + (r.credibilityScore || 0), 0) / total);
  const flagged = sessions.filter(r => (r.credibilityScore || 100) < 50).length;

  document.getElementById('stat-avg-exam').textContent = `${avgExam}%`;
  document.getElementById('stat-avg-cred').textContent = avgCred;
  document.getElementById('stat-flagged').textContent  = flagged;

  show('sessions-table-wrap');
  hide('no-sessions');

  const tbody = document.getElementById('sessions-tbody');
  tbody.innerHTML = sessions.map((s, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${s.student?.name || 'Unknown'}</strong></td>
      <td style="font-size:0.85rem; color:var(--text-secondary);">${s.student?.email || '—'}</td>
      <td>
        <strong>${s.score}%</strong>
      </td>
      <td>${credBadge(s.credibilityScore)}</td>
      <td>
        <span class="${(s.violations?.length || 0) > 10 ? 'badge badge-danger' : (s.violations?.length || 0) > 4 ? 'badge badge-warning' : 'badge badge-success'}">
          ${s.violations?.length || 0}
        </span>
      </td>
      <td style="font-size:0.82rem; color:var(--text-secondary);">${formatDate(s.endTime)}</td>
      <td>
        <button class="btn btn-outline" onclick="openDetail('${s._id}')"
          style="font-size:0.8rem; padding:0.3rem 0.75rem;">
          View Report
        </button>
      </td>
    </tr>
  `).join('');
}

// ── Session Detail Modal ──────────────────────────────────────────────────────
async function openDetail(id) {
  document.getElementById('detail-modal').classList.add('open');
  document.getElementById('modal-title').textContent = 'Loading...';
  document.getElementById('modal-body').innerHTML = '<div class="spinner" style="margin:3rem auto;"></div>';

  try {
    const res = await fetch(`/api/dashboard/session/${id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to load session');
    }
    const session = await res.json();
    renderDetail(session);
  } catch (err) {
    document.getElementById('modal-body').innerHTML = `
      <div class="text-center" style="padding:2rem;">
        <p class="badge badge-danger" style="font-size:0.9rem;">${err.message}</p>
      </div>
    `;
  }
}

function closeModal() {
  document.getElementById('detail-modal').classList.remove('open');
}

// Close modal on overlay click
document.getElementById('detail-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('detail-modal')) closeModal();
});

const SEVERITY_LABELS = {
  tab_switch:          { label: 'Tab Switch',          sev: 'high' },
  window_blur:         { label: 'Window Blur',         sev: 'medium' },
  window_resize:       { label: 'Window Resize',       sev: 'low' },
  right_click:         { label: 'Right Click',         sev: 'low' },
  copy_shortcut:       { label: 'Copy (Ctrl+C)',       sev: 'high' },
  paste_shortcut:      { label: 'Paste (Ctrl+V)',      sev: 'high' },
  cut_shortcut:        { label: 'Cut (Ctrl+X)',        sev: 'high' },
  select_all_shortcut: { label: 'Select All',          sev: 'low' },
  devtools_open:       { label: 'DevTools Opened',     sev: 'high' },
  fullscreen_exit:     { label: 'Fullscreen Exit',     sev: 'medium' },
  mouse_leave:         { label: 'Mouse Left Window',   sev: 'low' },
  clipboard_copy:      { label: 'Clipboard Copy',      sev: 'medium' },
  face_not_detected:   { label: '👁 No Face Detected',  sev: 'high' },
  multiple_faces:      { label: '👥 Multiple Faces',    sev: 'high' },
  face_looking_away:   { label: '👀 Looking Away',      sev: 'medium' },
  face_left_frame:     { label: '🚶 Left Camera Frame', sev: 'high' }
};

function severityBadge(sev) {
  const map = { high: 'badge-danger', medium: 'badge-warning', low: 'badge-info' };
  return `<span class="badge ${map[sev] || 'badge-info'}">${sev || 'low'}</span>`;
}

function formatTime(iso) {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return iso; }
}

function renderDetail(s) {
  document.getElementById('modal-title').textContent =
    `${s.student?.name || 'Student'} — ${s.exam?.title || 'Exam'}`;

  const credClass = s.credibilityScore >= 75 ? 'success' : s.credibilityScore >= 50 ? 'warning' : 'danger';
  const violations = s.violations || [];

  const violationRows = violations.length === 0
    ? `<tr><td colspan="5" class="text-center" style="padding:1.5rem; color:var(--text-muted);">No violations recorded ✅</td></tr>`
    : violations.map((v, i) => {
        const info = SEVERITY_LABELS[v.type] || { label: v.type, sev: 'low' };
        return `
          <tr>
            <td>${i + 1}</td>
            <td>${info.label}</td>
            <td>${formatTime(v.timestamp)}</td>
            <td style="font-size:0.8rem; color:var(--text-secondary); max-width:180px; word-break:break-word;">${v.detail || '—'}</td>
            <td>${severityBadge(info.sev)}</td>
          </tr>
        `;
      }).join('');

  document.getElementById('modal-body').innerHTML = `
    <!-- Scores -->
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:1rem; margin-bottom:1.5rem;">
      <div class="stat-card">
        <div class="stat-icon">📝</div>
        <div><div class="stat-value">${s.score}%</div><div class="stat-label">Exam Score</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🛡️</div>
        <div>
          <div class="stat-value" style="color:var(--${credClass})">${s.credibilityScore}</div>
          <div class="stat-label">Credibility Score</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">⚠️</div>
        <div><div class="stat-value">${violations.length}</div><div class="stat-label">Violations</div></div>
      </div>
    </div>

    <!-- AI Report -->
    <h3 style="margin-bottom:0.75rem; font-size:0.95rem;">🤖 AI Analysis</h3>
    <div class="ai-report-box" style="margin-bottom:1.5rem; font-size:0.9rem;">${s.credibilityReport || 'No report available.'}</div>

    <!-- Violations Timeline -->
    <h3 style="margin-bottom:0.75rem; font-size:0.95rem;">🔍 Violation Timeline</h3>
    <div class="table-wrap">
      <table style="font-size:0.85rem;">
        <thead>
          <tr>
            <th>#</th><th>Type</th><th>Time</th><th>Detail</th><th>Severity</th>
          </tr>
        </thead>
        <tbody>${violationRows}</tbody>
      </table>
    </div>
  `;
}

// ── Entry ─────────────────────────────────────────────────────────────────────
loadSessions();
