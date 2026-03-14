/* report.js — renders the student credibility report */

const token     = localStorage.getItem('token');
const role      = localStorage.getItem('role');
const sessionId = localStorage.getItem('lastSessionId');

// Auth guard
if (!token || role !== 'student') {
  window.location.href = '/login.html';
}

function logout() {
  localStorage.clear();
  window.location.href = '/login.html';
}

function show(id) { document.getElementById(id).style.display = 'block'; }
function hide(id) { document.getElementById(id).style.display = 'none'; }

// Severity label config
const SEVERITY_LABELS = {
  tab_switch:          { label: 'Tab Switch',            sev: 'high' },
  window_blur:         { label: 'Window Blur',           sev: 'medium' },
  window_resize:       { label: 'Window Resize',         sev: 'low' },
  right_click:         { label: 'Right Click',           sev: 'low' },
  copy_shortcut:       { label: 'Copy (Ctrl+C)',         sev: 'high' },
  paste_shortcut:      { label: 'Paste (Ctrl+V)',        sev: 'high' },
  cut_shortcut:        { label: 'Cut (Ctrl+X)',          sev: 'high' },
  select_all_shortcut: { label: 'Select All (Ctrl+A)',   sev: 'low' },
  devtools_open:       { label: 'DevTools Opened',       sev: 'high' },
  fullscreen_exit:     { label: 'Fullscreen Exit',       sev: 'medium' },
  mouse_leave:         { label: 'Mouse Left Window',     sev: 'low' },
  clipboard_copy:      { label: 'Clipboard Copy',        sev: 'medium' },
  face_not_detected:   { label: '👁 No Face Detected',    sev: 'high' },
  multiple_faces:      { label: '👥 Multiple Faces',      sev: 'high' },
  face_looking_away:   { label: '👀 Looking Away',        sev: 'medium' },
  face_left_frame:     { label: '🚶 Left Camera Frame',   sev: 'high' }
};

function severityBadge(sev) {
  const map = { high: 'badge-danger', medium: 'badge-warning', low: 'badge-info' };
  return `<span class="badge ${map[sev] || 'badge-info'}">${sev || 'low'}</span>`;
}

function formatTime(isoStr) {
  try {
    return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return isoStr; }
}

function formatDuration(startIso, endIso) {
  try {
    const diff = new Date(endIso) - new Date(startIso);
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${mins}m ${secs}s`;
  } catch { return 'N/A'; }
}

function renderCredibilityGauge(score) {
  const circle = document.getElementById('cred-circle');
  const scoreEl = document.getElementById('cred-score');
  const badge = document.getElementById('cred-badge');

  scoreEl.textContent = score;

  if (score >= 75) {
    circle.className = 'score-circle high';
    scoreEl.style.color = 'var(--success)';
    badge.className = 'badge badge-success';
    badge.textContent = '✅ Trustworthy';
  } else if (score >= 50) {
    circle.className = 'score-circle medium';
    scoreEl.style.color = 'var(--warning)';
    badge.className = 'badge badge-warning';
    badge.textContent = '⚠️ Suspicious';
  } else {
    circle.className = 'score-circle low';
    scoreEl.style.color = 'var(--danger)';
    badge.className = 'badge badge-danger';
    badge.textContent = '🚨 Flagged';
  }
}

async function loadReport() {
  if (!sessionId) {
    hide('report-loading');
    show('report-error');
    document.getElementById('report-error-msg').textContent = 'No session found. Please complete an exam first.';
    return;
  }

  try {
    const res = await fetch(`/api/dashboard/session/${sessionId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to load report');
    }

    const session = await res.json();

    // Fill student name
    document.getElementById('report-student-name').textContent = session.student?.name || '';
    document.getElementById('report-subtitle').textContent =
      `${session.exam?.title || 'Exam'} — Submitted ${new Date(session.endTime).toLocaleString()}`;

    // Credibility gauge
    renderCredibilityGauge(session.credibilityScore);

    // Stats
    document.getElementById('exam-score-val').textContent = `${session.score}%`;
    document.getElementById('total-violations-val').textContent = session.violations?.length || 0;
    document.getElementById('exam-duration-val').textContent = formatDuration(session.startTime, session.endTime);

    // AI report
    document.getElementById('ai-report-text').textContent =
      session.credibilityReport || 'No AI report available.';

    // Violations table
    const violations = session.violations || [];
    if (violations.length === 0) {
      hide('violations-table-wrap');
      show('no-violations-msg');
    } else {
      document.getElementById('violation-table-subtitle').textContent =
        `${violations.length} event(s) recorded`;

      const tbody = document.getElementById('violations-tbody');
      tbody.innerHTML = violations.map((v, i) => {
        const info = SEVERITY_LABELS[v.type] || { label: v.type, sev: 'low' };
        return `
          <tr>
            <td>${i + 1}</td>
            <td>${info.label}</td>
            <td>${formatTime(v.timestamp)}</td>
            <td style="font-size:0.82rem; color:var(--text-secondary); max-width:220px; word-break:break-word;">${v.detail || '—'}</td>
            <td>${severityBadge(info.sev)}</td>
          </tr>
        `;
      }).join('');
    }

    // Heatmap — cap to actual exam duration
    renderHeatmap(violations, session.startTime, session.endTime, session.exam?.duration || 30);

    hide('report-loading');
    show('report-content');
  } catch (err) {
    hide('report-loading');
    show('report-error');
    document.getElementById('report-error-msg').textContent = err.message;
  }
}

// ── Violation Timeline Heatmap ─────────────────────────────────────────────
function renderHeatmap(violations, startIso, endIso, examDurationMins = 30) {
  const container = document.getElementById('heatmap-container');
  const subtitle  = document.getElementById('heatmap-subtitle');

  if (!violations || violations.length === 0) {
    container.innerHTML = '<div class="heatmap-empty">✅ No violations to display on the timeline.</div>';
    subtitle.textContent = '';
    return;
  }

  const start    = new Date(startIso);
  const end      = new Date(endIso);
  const totalMs  = Math.max(0, end - start);

  // Use exam duration as the cap — never show more columns than the exam length
  const totalMins = Math.min(examDurationMins, Math.max(1, Math.ceil(totalMs / 60000)));
  subtitle.textContent = `${totalMins} minute(s) · ${violations.length} event(s)`;

  // Bucket violations into per-minute slots
  const buckets     = new Array(totalMins).fill(0);
  const bucketTypes = Array.from({ length: totalMins }, () => []);

  violations.forEach(v => {
    const vTime  = new Date(v.timestamp);
    const rawIdx = Math.floor((vTime - start) / 60000);
    const minIdx = Math.max(0, Math.min(rawIdx, totalMins - 1));
    buckets[minIdx]++;
    const info = SEVERITY_LABELS[v.type] || { label: v.type };
    bucketTypes[minIdx].push(info.label);
  });

  const maxCount = Math.max(...buckets, 1);

  // Column width: auto-fill if ≤30 min, fixed 10px (scrollable) if longer
  const useScroll  = totalMins > 30;
  const colWidth   = useScroll ? '10px' : `calc((100% - ${(totalMins - 1) * 2}px) / ${totalMins})`;
  const flexShrink = useScroll ? '0'    : '1';

  // Generate columns
  const cols = buckets.map((count, i) => {
    const heightPct = count === 0 ? 8 : Math.max(14, Math.round((count / maxCount) * 100));
    const ratio     = count / maxCount;

    let color;
    if (count === 0)        color = '#3fb950';
    else if (ratio <= 0.33) color = '#d29922';
    else if (ratio <= 0.66) color = '#e3713a';
    else                    color = '#f85149';

    const opacity = count === 0 ? 0.28 : (0.55 + ratio * 0.45).toFixed(2);
    const uniqueTypes = [...new Set(bucketTypes[i])];
    const tip = count === 0
      ? `Min ${i + 1}: Clean ✓`
      : `Min ${i + 1}: ${count} violation${count > 1 ? 's' : ''} — ${uniqueTypes.join(', ')}`;

    return `<div class="hm-col" style="width:${colWidth};flex-shrink:${flexShrink};height:${heightPct}%;background:${color};opacity:${opacity};" title="${tip}">
      <div class="hm-tooltip">${tip}</div>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div class="heatmap-wrap">
      <div class="heatmap-label-row">
        <span>Min 1</span>
        ${totalMins > 10 ? `<span>Min ${Math.round(totalMins/2)}</span>` : ''}
        <span>Min ${totalMins}</span>
      </div>
      <div class="heatmap-scroll">
        <div class="heatmap-bar" style="width:${useScroll ? totalMins * 12 + 'px' : '100%'};">${cols}</div>
      </div>
      <div class="heatmap-legend">
        <span style="color:#3fb950;font-size:.7rem;">● Clean</span>
        <span style="color:#d29922;font-size:.7rem;">● Low</span>
        <span style="color:#e3713a;font-size:.7rem;">● Medium</span>
        <span style="color:#f85149;font-size:.7rem;">● High</span>
        <span style="margin-left:auto;font-size:.68rem;color:var(--text-muted);">1 column = 1 min${useScroll ? ' · scroll →' : ''}</span>
      </div>
    </div>
  `;
}


loadReport();
