/* exam.js — Exam page logic + browser monitoring + face detection */

// ── Auth Guard ────────────────────────────────────────────────────────────────
const token    = localStorage.getItem('token');
const role     = localStorage.getItem('role');
const userName = localStorage.getItem('userName') || 'Student';

if (!token || role !== 'student') {
  window.location.href = '/login.html';
}

// ── State ─────────────────────────────────────────────────────────────────────
let sessionId     = null;
let examDuration  = 30 * 60;
let timerInterval = null;
let timeLeft      = 0;
let submitted     = false;
let exited        = false;
let violations    = [];
let examQuestions = [];

// ── Face Detection State ──────────────────────────────────────────────────────
let faceDetectionLoop  = null;
let cameraStream       = null;
let noFaceSeconds      = 0;
let lookingAwaySeconds = 0;
let faceAlertTimeout   = null;
let faceModelsLoaded   = false;

const NO_FACE_THRESHOLD   = 3;   // checks before "no face" violation
const LOOK_AWAY_THRESHOLD = 2;   // FIX: was 6 (9s), now 3 (4.5s) — much more responsive
const GAZE_MARGIN         = 0.08; // FIX: was 0.15 (too tight), now 0.20 — easier to trigger
const FACE_CHECK_MS       = 1500;
const FACE_COOLDOWN_MS    = 5000;

// ── Violation Logger ──────────────────────────────────────────────────────────
function logViolation(type, detail = '') {
  if (submitted || exited) return;
  violations.push({ type, timestamp: new Date().toISOString(), detail });
  updateCounter(type);
  showToast(formatViolationType(type));
  console.warn(`[PROCTOR] ${type}`, detail);
}

function formatViolationType(type) {
  const labels = {
    tab_switch:          'Tab switch detected',
    window_blur:         'Window lost focus',
    window_resize:       'Window resized',
    right_click:         'Right-click blocked',
    copy_shortcut:       'Copy (Ctrl+C) blocked',
    paste_shortcut:      'Paste (Ctrl+V) blocked',
    cut_shortcut:        'Cut (Ctrl+X) blocked',
    select_all_shortcut: 'Select-All detected',
    devtools_open:       'DevTools may be open',
    fullscreen_exit:     'Fullscreen exited',
    mouse_leave:         'Cursor left exam window',
    clipboard_copy:      'Content copied to clipboard',
    face_not_detected:   '⚠️ No face detected',
    multiple_faces:      '⚠️ Multiple faces detected',
    face_looking_away:   '⚠️ Please look at the screen',
    face_left_frame:     '⚠️ Face left the camera frame'
  };
  return labels[type] || type;
}

function updateCounter(type) {
  const map = {
    tab_switch:        'cnt-tab_switch',
    window_blur:       'cnt-window_blur',
    window_resize:     'cnt-window_resize',
    right_click:       'cnt-right_click',
    devtools_open:     'cnt-devtools_open',
    fullscreen_exit:   'cnt-fullscreen_exit',
    mouse_leave:       'cnt-mouse_leave',
    face_not_detected: 'cnt-face_not_detected',
    multiple_faces:    'cnt-multiple_faces',
    face_looking_away: 'cnt-face_looking_away',
    face_left_frame:   'cnt-face_left_frame'
  };
  const el = document.getElementById(map[type]);
  if (el) el.textContent = parseInt(el.textContent || '0') + 1;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimeout = null;
function showToast(msg) {
  const toast = document.getElementById('violation-toast');
  const msgEl = document.getElementById('toast-msg');
  if (!toast || !msgEl) return;
  msgEl.textContent = msg;
  toast.classList.add('show');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ══════════════════════════════════════════════════════════════════════════════
// ── EXIT EXAM ─────────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

function exitExam() {
  document.getElementById('exit-modal').classList.add('open');
}
function closeExitModal() {
  document.getElementById('exit-modal').classList.remove('open');
}
function confirmExit() {
  exited = true;
  stopCamera();
  clearInterval(timerInterval);
  if (devToolsCheckInterval) clearInterval(devToolsCheckInterval);
  if (document.fullscreenElement) {
    try { document.exitFullscreen(); } catch (_) {}
  }
  localStorage.removeItem('lastSessionId');
  window.location.href = '/login.html';
}

// ══════════════════════════════════════════════════════════════════════════════
// ── FACE DETECTION ────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

async function initFaceDetection() {
  const video   = document.getElementById('camera-video');
  const overlay = document.getElementById('camera-overlay');

  try {
    setCamStatus('loading', 'Loading AI models...');
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('/face-models'),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri('/face-models')
    ]);
    faceModelsLoaded = true;
  } catch {
    try {
      const CDN = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(CDN),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(CDN)
      ]);
      faceModelsLoaded = true;
    } catch {
      setCamStatus('error', 'Models unavailable');
      overlay.innerHTML = '<span style="font-size:1.5rem">⚠️</span><span>Face detection unavailable.<br/>Exam can still proceed.</span>';
      return;
    }
  }

  try {
    setCamStatus('loading', 'Requesting camera...');
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' },
      audio: false
    });
    video.srcObject = cameraStream;
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      setTimeout(reject, 8000);
    });
    overlay.style.display = 'none';
    setCamStatus('active', 'Camera ready');
    // Mirror stream to floating bubble (mobile)
    const bubbleVideo = document.getElementById('cam-bubble-video');
    const bubbleOverlay = document.getElementById('cam-bubble-overlay');
    if (bubbleVideo) {
      bubbleVideo.srcObject = cameraStream;
      if (bubbleOverlay) bubbleOverlay.style.display = 'none';
    }
  } catch {
    setCamStatus('error', 'Camera denied');
    overlay.innerHTML = '<span style="font-size:1.5rem">🚫</span><span>Camera access denied.<br/>Please allow camera in browser settings.</span>';
  }
}

function setCamStatus(state, text) {
  // Sidebar dot + label
  const dot   = document.getElementById('cam-dot');
  const label = document.getElementById('cam-status-text');
  if (dot) {
    dot.className = 'status-dot';
    if (state === 'active')  dot.classList.add('active');
    if (state === 'warning') dot.classList.add('warning');
    if (state === 'error')   dot.classList.add('danger');
  }
  if (label) {
    const colors = { active:'var(--success)', warning:'var(--warning)', error:'var(--danger)', loading:'var(--text-muted)' };
    label.style.color = colors[state] || 'var(--text-muted)';
    label.textContent = text;
  }
  // Bubble dot + border
  const bubbleDot = document.getElementById('cam-bubble-dot');
  const bubble    = document.getElementById('cam-bubble');
  if (bubbleDot) {
    bubbleDot.className = '';
    if (state === 'active')  bubbleDot.classList.add('active');
    if (state === 'warning') bubbleDot.classList.add('warning');
    if (state === 'error')   bubbleDot.classList.add('danger');
  }
  if (bubble) {
    bubble.className = '';
    if (state === 'warning') bubble.classList.add('warning');
    if (state === 'error')   bubble.classList.add('danger');
  }
}

function showFaceAlert(msg) {
  // Sidebar banner
  const banner = document.getElementById('face-alert-banner');
  if (banner) {
    banner.textContent = '⚠️ ' + msg;
    banner.classList.add('show');
  }
  // Bubble alert
  const bubbleAlert = document.getElementById('cam-bubble-alert');
  if (bubbleAlert) {
    bubbleAlert.textContent = '⚠️ ' + msg;
    bubbleAlert.classList.add('show');
  }
  if (faceAlertTimeout) clearTimeout(faceAlertTimeout);
  faceAlertTimeout = setTimeout(() => {
    if (banner) banner.classList.remove('show');
    if (bubbleAlert) bubbleAlert.classList.remove('show');
  }, 3000);
}

const faceCooldowns = {};
function logFaceViolation(type, detail) {
  if (faceCooldowns[type]) return;
  logViolation(type, detail);
  faceCooldowns[type] = true;
  setTimeout(() => { faceCooldowns[type] = false; }, FACE_COOLDOWN_MS);
}

function startFaceLoop(video) {
  // On mobile the sidebar video is hidden — use bubble video if visible
  const bubbleVideo = document.getElementById('cam-bubble-video');
  const activeVideo = (bubbleVideo && bubbleVideo.srcObject && window.innerWidth <= 768)
    ? bubbleVideo : video;
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.3 });

  faceDetectionLoop = setInterval(async () => {
    if (submitted || exited) { clearInterval(faceDetectionLoop); stopCamera(); return; }
    if (!video.readyState || video.readyState < 2) return;

    try {
      const detections = await faceapi.detectAllFaces(activeVideo, options)
        .withFaceLandmarks(true);

      const count = detections.length;

      // ── No face ──
      if (count === 0) {
        noFaceSeconds++;
        lookingAwaySeconds = 0;
        setCamStatus('warning', 'No face visible');
        if (noFaceSeconds >= NO_FACE_THRESHOLD) {
          showFaceAlert('No face detected — please stay in frame');
          logFaceViolation('face_not_detected', `No face for ${noFaceSeconds} checks`);

          noFaceSeconds = 0;
        }
        return;
      }

      noFaceSeconds = 0;

      // ── Multiple faces ──
      if (count > 1) {
  setCamStatus('warning', `${count} faces in frame`);
  showFaceAlert(`${count} faces detected`);
  logFaceViolation('multiple_faces', `${count} faces detected`);
     }

      // ── Single face — check gaze ──
      const lookingAway = checkGaze(detections[0].landmarks);

      if (lookingAway) {
        lookingAwaySeconds++;
        setCamStatus('warning', `Looking away (${lookingAwaySeconds}/${LOOK_AWAY_THRESHOLD})`);

        if (lookingAwaySeconds >= LOOK_AWAY_THRESHOLD) {
          showFaceAlert('Please look at the screen');
          logFaceViolation('face_looking_away', `Looking away for ${lookingAwaySeconds} checks`);
          lookingAwaySeconds = 0; // reset after logging so it can trigger again
        }
      } else {
        setCamStatus('active', 'Face detected ✓');
        // Decay slowly — don't reset instantly so brief glances don't wipe the count
        if (lookingAwaySeconds > 0) lookingAwaySeconds = Math.max(0, lookingAwaySeconds - 1);
      }

    } catch { /* silent */ }
  }, FACE_CHECK_MS);
}

// FIX: improved gaze detection using eye landmark centre vs eye width ratio
function checkGaze(landmarks) {
  try {
    const leftEye  = landmarks.getLeftEye();
    const rightEye = landmarks.getRightEye();
    const nose     = landmarks.getNose();

    const lw = Math.abs(leftEye[3].x - leftEye[0].x);
    const rw = Math.abs(rightEye[3].x - rightEye[0].x);
    if (lw < 3 || rw < 3) return false;

    // Horizontal gaze using nose tip vs eye midpoint
    const eyeMidX = (leftEye[0].x + leftEye[3].x + rightEye[0].x + rightEye[3].x) / 4;
    const faceWidth = Math.abs(rightEye[3].x - leftEye[0].x);
    const noseTip = nose[3]; // bottom of nose bridge
    const horizontalShift = Math.abs(noseTip.x - eyeMidX) / faceWidth;
    const horizontalAway = horizontalShift > 0.12;

    // Vertical gaze using eye openness
    const lh = Math.abs(leftEye[1].y  - leftEye[5].y);
    const rh = Math.abs(rightEye[1].y - rightEye[5].y);
    const vertRatio = ((lh / lw) + (rh / rw)) / 2;
    const lookingDown = vertRatio < 0.10;

    return horizontalAway || lookingDown;
  } catch { return false; }
}
function getCenter(pts) {
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length
  };
}

function stopCamera() {
  if (faceDetectionLoop) { clearInterval(faceDetectionLoop); faceDetectionLoop = null; }
  if (cameraStream)      { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── BROWSER MONITORING ────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

document.addEventListener('visibilitychange', () => {
  if (submitted || exited) return;
  if (document.visibilityState === 'hidden') logViolation('tab_switch', 'Switched tabs');
});

window.addEventListener('blur', () => {
  if (submitted || exited) return;
  setTimeout(() => {
    if (document.visibilityState === 'visible') logViolation('window_blur', 'Window lost focus');
  }, 200);
});

const originalWidth  = window.innerWidth;
const originalHeight = window.innerHeight;
let resizeCooldown = false;
window.addEventListener('resize', () => {
  if (submitted || exited || resizeCooldown) return;
  if (window.innerWidth / originalWidth < 0.80 || window.innerHeight / originalHeight < 0.80) {
    logViolation('window_resize', `Resized to ${window.innerWidth}x${window.innerHeight}`);
    resizeCooldown = true;
    setTimeout(() => { resizeCooldown = false; }, 3000);
  }
});

document.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (!submitted && !exited) logViolation('right_click', 'Right-click attempted');
});

// MCQ exam — students only click radio buttons, no typing.
// Ctrl+C/V/X are NOT violations (nothing to copy/paste in MCQ).
// Only block shortcuts that could expose content or open browser tools.
document.addEventListener('keydown', e => {
  if (submitted || exited) return;
  const k = e.key.toLowerCase();

  if (e.ctrlKey || e.metaKey) {
    if (k === 'u') { e.preventDefault(); }   // view-source
    if (k === 's') { e.preventDefault(); }   // save page
    if (k === 'p') { e.preventDefault(); }   // print
    if (k === 'f') { e.preventDefault(); }   // find-in-page
  }

  // F12 opens DevTools directly
  if (k === 'f12') { e.preventDefault(); logViolation('devtools_open', 'F12 pressed'); }
});

// ── DevTools Detection ────────────────────────────────────────────────────────
// FIX: skip check when in fullscreen — fullscreen collapses browser chrome
// causing outerHeight - innerHeight to drop to ~0, NOT spike.
// The only time it spikes is when DevTools is open in a NON-fullscreen window.
let devToolsCheckInterval = null;
function startDevToolsDetection() {
  let last = false;
  devToolsCheckInterval = setInterval(() => {
    if (submitted || exited) { clearInterval(devToolsCheckInterval); return; }

    // KEY FIX: don't check while in fullscreen
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      last = false; // reset so we don't immediately fire when exiting fullscreen
      return;
    }

    const dh = window.outerHeight - window.innerHeight;
    const dw = window.outerWidth  - window.innerWidth;
    const open = dh > 160 || dw > 160;
    if (open && !last) {
      logViolation('devtools_open', `DevTools detected (Δh:${dh} Δw:${dw})`);
      last = true;
    } else if (!open) {
      last = false;
    }
  }, 1500);
}

document.addEventListener('fullscreenchange', () => {
  if (submitted || exited) return;
  if (!document.fullscreenElement) {
    logViolation('fullscreen_exit', 'Exited fullscreen');
    document.getElementById('fullscreen-prompt').style.display = 'flex';
  } else {
    document.getElementById('fullscreen-prompt').style.display = 'none';
  }
});
document.addEventListener('webkitfullscreenchange', () => {
  if (!document.webkitFullscreenElement && !submitted && !exited)
    logViolation('fullscreen_exit', 'Exited fullscreen (webkit)');
});

let mouseLeaveCooldown = false;
document.addEventListener('mouseleave', () => {
  if (submitted || exited || mouseLeaveCooldown) return;
  logViolation('mouse_leave', 'Mouse left window');
  mouseLeaveCooldown = true;
  setTimeout(() => { mouseLeaveCooldown = false; }, 4000);
});

// ══════════════════════════════════════════════════════════════════════════════
// ── TIMER ─────────────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

function startTimer(seconds) {
  timeLeft = seconds;
  const timerEl = document.getElementById('timer');
  timerInterval = setInterval(() => {
    if (timeLeft <= 0) { clearInterval(timerInterval); autoSubmit(); return; }
    timeLeft--;
    const m = String(Math.floor(timeLeft / 60)).padStart(2, '0');
    const s = String(timeLeft % 60).padStart(2, '0');
    timerEl.textContent = `${m}:${s}`;
    if (timeLeft <= 300) timerEl.className = 'timer-display warning';
    if (timeLeft <= 60)  timerEl.className = 'timer-display danger';
  }, 1000);
}

function autoSubmit() {
  showToast('Time is up! Auto-submitting...');
  setTimeout(confirmSubmit, 1500);
}

// ══════════════════════════════════════════════════════════════════════════════
// ── RENDER QUESTIONS ──────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

function renderQuestions(questions) {
  const col = document.getElementById('questions-col');
  col.innerHTML = '';
  questions.forEach((q, i) => {
    const card = document.createElement('div');
    card.className = 'question-card';
    card.innerHTML = `
      <div class="question-number">Question ${i + 1} of ${questions.length}</div>
      <div class="question-text">${escapeHtml(q.text)}</div>
      <ul class="options-list">
        ${q.options.map((opt, j) => `
          <li>
            <label class="option-label" id="label-${i}-${j}">
              <input type="radio" name="q${i}" value="${j}" onchange="selectOption(${i},${j})" />
              ${escapeHtml(opt)}
            </label>
          </li>`).join('')}
      </ul>`;
    col.appendChild(card);
  });
}

function selectOption(qi, oi) {
  for (let j = 0; j < 4; j++) document.getElementById(`label-${qi}-${j}`)?.classList.remove('selected');
  document.getElementById(`label-${qi}-${oi}`)?.classList.add('selected');
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str));
  return d.innerHTML;
}

function collectAnswers() {
  return examQuestions.map((_, i) => {
    const sel = document.querySelector(`input[name="q${i}"]:checked`);
    return sel ? parseInt(sel.value) : -1;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// ── SUBMIT ────────────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

function submitExam() {
  if (submitted || exited) return;
  const ans = collectAnswers();
  const unanswered = ans.filter(a => a === -1).length;
  document.getElementById('confirm-msg').textContent = unanswered > 0
    ? `You have ${unanswered} unanswered question(s). Sure you want to submit?`
    : 'Are you sure you want to submit your exam?';
  document.getElementById('confirm-modal').classList.add('open');
}

function closeConfirm() {
  document.getElementById('confirm-modal').classList.remove('open');
}

async function confirmSubmit() {
  if (submitted) return;
  submitted = true;
  stopCamera();
  clearInterval(timerInterval);
  if (devToolsCheckInterval) clearInterval(devToolsCheckInterval);

  const confirmBtn = document.getElementById('confirm-submit-btn');
  const cancelBtn  = document.getElementById('cancel-submit-btn');
  confirmBtn.textContent = 'Submitting...';
  confirmBtn.disabled    = true;
  cancelBtn.disabled     = true;

  try {
    const res = await fetch('/api/exam/submit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body:    JSON.stringify({ sessionId, answers: collectAnswers(), violations })
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Submission failed.'); submitted = false; return; }
    localStorage.setItem('lastSessionId', data.sessionId);
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch (_) {} }
    window.location.href = '/report.html';
  } catch {
    alert('Network error. Please contact your invigilator.');
    submitted = false;
    confirmBtn.textContent = 'Submit Now';
    confirmBtn.disabled    = false;
    cancelBtn.disabled     = false;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── FULLSCREEN + INIT ─────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

document.getElementById('enter-fullscreen-btn').addEventListener('click', async () => {
  try { await document.documentElement.requestFullscreen(); } catch (e) { console.warn(e); }
  document.getElementById('fullscreen-prompt').style.display = 'none';
  document.getElementById('exam-content').style.display      = 'block';
  document.getElementById('loading-state').style.display     = 'none';
  if (faceModelsLoaded && cameraStream) {
    startFaceLoop(document.getElementById('camera-video'));
  }
  // Start DevTools detection ONLY after entering fullscreen
  // so the pre-exam prompt screen never triggers a false positive
  startDevToolsDetection();
});

async function initExam() {
  document.getElementById('student-name').textContent = userName;

  try {
    const examRes = await fetch('/api/exam/questions', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!examRes.ok) throw new Error((await examRes.json()).error || 'Failed to load exam');
    const examData = await examRes.json();
    examQuestions  = examData.questions;
    document.getElementById('exam-title-nav').textContent = examData.title;

    const startRes = await fetch('/api/exam/start', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    });
    if (!startRes.ok) throw new Error((await startRes.json()).error || 'Failed to start exam');
    const startData = await startRes.json();
    sessionId    = startData.sessionId;
    examDuration = (startData.duration || 30) * 60;

    renderQuestions(examQuestions);

    // Init camera BEFORE showing fullscreen prompt
    await initFaceDetection();

    document.getElementById('loading-state').style.display     = 'none';
    document.getElementById('fullscreen-prompt').style.display  = 'flex';

    startTimer(examDuration);
    // NOTE: startDevToolsDetection() is called in the fullscreen button click handler
  } catch (err) {
    document.getElementById('loading-state').innerHTML = `
      <div class="text-center" style="padding:2rem;">
        <div style="font-size:2.5rem;margin-bottom:1rem;">😕</div>
        <h2>Could not load exam</h2>
        <p class="mt-1 text-muted">${err.message}</p>
        <button class="btn btn-primary mt-3" onclick="location.reload()">Retry</button>
      </div>`;
  }
}

initExam();