const express    = require('express');
const router     = express.Router();
const path       = require('path');
const fs         = require('fs');
const multer     = require('multer');
const ExamSession = require('../models/ExamSession');
const { authMiddleware, requireRole } = require('../middleware/auth');

// ── Multer storage — saves to uploads/disputes/ ───────────────────────────────
const uploadDir = path.join(__dirname, '..', 'uploads', 'disputes');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.webm';
    cb(null, `dispute-${req.params.sessionId}-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) return cb(null, true);
    cb(new Error('Only video files are allowed'));
  }
});

// ── GET /api/dispute/status/:code — mobile polls to check if exam ended ───────
// Public endpoint — only returns non-sensitive status info
router.get('/status/:code', async (req, res) => {
  try {
    const session = await ExamSession.findOne({ mobileCode: req.params.code })
      .select('status endTime _id');
    if (!session) return res.status(404).json({ error: 'Invalid code' });
    res.json({
      examEnded: session.status === 'submitted',
      sessionId: session._id,
      endTime:   session.endTime || null
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/dispute/upload/:sessionId — student submits defense video ───────
router.post('/upload/:sessionId', authMiddleware, requireRole('student'),
  upload.single('video'),
  async (req, res) => {
    try {
      const session = await ExamSession.findById(req.params.sessionId);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      if (session.student.toString() !== req.user.id)
        return res.status(403).json({ error: 'Unauthorized' });
      if (session.status !== 'submitted')
        return res.status(400).json({ error: 'Exam not yet submitted' });

      // Enforce 10-minute dispute window from exam end
      const minutesSinceEnd = (Date.now() - new Date(session.endTime)) / 60000;
      if (minutesSinceEnd > 10) {
        if (req.file) fs.unlinkSync(req.file.path); // delete uploaded file
        return res.status(403).json({ error: 'Dispute window has closed (10 minutes after exam end)' });
      }

      // Delete previous dispute video if exists
      if (session.disputeVideoPath && fs.existsSync(session.disputeVideoPath)) {
        try { fs.unlinkSync(session.disputeVideoPath); } catch (_) {}
      }

      session.disputeStatus      = 'pending';
      session.disputeVideoPath   = req.file.path;
      session.disputeSubmittedAt = new Date();
      await session.save();

      res.json({ success: true, message: 'Defense video submitted successfully.' });
    } catch (err) {
      console.error('Dispute upload error:', err.message);
      res.status(500).json({ error: 'Upload failed. Please try again.' });
    }
  }
);

// ── GET /api/dispute/video/:sessionId — invigilator streams the video ─────────
router.get('/video/:sessionId', authMiddleware, requireRole('invigilator'), async (req, res) => {
  try {
    const session = await ExamSession.findById(req.params.sessionId).select('disputeVideoPath disputeStatus');
    if (!session || !session.disputeVideoPath)
      return res.status(404).json({ error: 'No dispute video found' });
    if (!fs.existsSync(session.disputeVideoPath))
      return res.status(404).json({ error: 'Video file not found on server' });

    const stat     = fs.statSync(session.disputeVideoPath);
    const fileSize = stat.size;
    const range    = req.headers.range;

    if (range) {
      // Support range requests for video seeking
      const parts  = range.replace(/bytes=/, '').split('-');
      const start  = parseInt(parts[0], 10);
      const end    = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;
      const stream = fs.createReadStream(session.disputeVideoPath, { start, end });
      res.writeHead(206, {
        'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': chunkSize,
        'Content-Type':   'video/webm'
      });
      stream.pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': 'video/webm' });
      fs.createReadStream(session.disputeVideoPath).pipe(res);
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to stream video' });
  }
});

// ── POST /api/dispute/review/:sessionId — invigilator accepts or rejects ──────
router.post('/review/:sessionId', authMiddleware, requireRole('invigilator'), async (req, res) => {
  try {
    const { decision } = req.body; // 'accepted' | 'rejected'
    if (!['accepted', 'rejected'].includes(decision))
      return res.status(400).json({ error: 'Decision must be accepted or rejected' });

    const session = await ExamSession.findById(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    session.disputeStatus = decision;

    // If accepted, give benefit of the doubt — bump credibility by 20 (max 100)
    if (decision === 'accepted') {
      session.credibilityScore = Math.min(100, session.credibilityScore + 20);
    }

    await session.save();
    res.json({ success: true, disputeStatus: session.disputeStatus, credibilityScore: session.credibilityScore });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process review' });
  }
});

module.exports = router;

// ── 24-Hour Auto-Deletion Cron Job ────────────────────────────────────────────
// Runs every hour. Deletes video files older than 24h and writes a permanent
// audit log to the database — proof of deletion even after the file is gone.
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

async function deleteExpiredVideos() {
  try {
    const cutoff = new Date(Date.now() - TWENTY_FOUR_HOURS);

    // Find sessions with a video submitted more than 24h ago that haven't been deleted yet
    const expired = await ExamSession.find({
      disputeSubmittedAt: { $lte: cutoff },
      disputeVideoPath:   { $exists: true, $ne: '' },
      disputeDeletedAt:   { $exists: false }          // not yet deleted
    }).select('_id disputeVideoPath disputeSubmittedAt');

    if (expired.length === 0) return;

    console.log(`🧹 [Cleanup] Found ${expired.length} expired dispute video(s) to delete.`);

    for (const session of expired) {
      // Delete the actual file
      if (session.disputeVideoPath && fs.existsSync(session.disputeVideoPath)) {
        try {
          fs.unlinkSync(session.disputeVideoPath);
          console.log(`🗑️  Deleted video for session ${session._id}`);
        } catch (fileErr) {
          console.warn(`⚠️  Could not delete file for session ${session._id}:`, fileErr.message);
        }
      }

      // Write permanent audit record — this stays in DB forever as proof
      session.disputeVideoPath = '';       // path scrubbed
      session.disputeDeletedAt = new Date();
      session.deletionReason   = 'Auto-deleted after 24h per ExamProctor Privacy Policy';
      await session.save();
    }

    console.log(`✅ [Cleanup] Done. ${expired.length} video(s) deleted and audit logs written.`);
  } catch (err) {
    console.error('❌ [Cleanup] Video deletion job failed:', err.message);
  }
}

// Run immediately on startup, then every hour
deleteExpiredVideos();
setInterval(deleteExpiredVideos, 60 * 60 * 1000);

// ── GET /api/dispute/deletionlog/:sessionId — Audit proof for judges ──────────
// Shows when and why a video was deleted — accessible to invigilators
router.get('/deletionlog/:sessionId', authMiddleware, requireRole('invigilator'), async (req, res) => {
  try {
    const session = await ExamSession.findById(req.params.sessionId)
      .select('disputeStatus disputeSubmittedAt disputeDeletedAt deletionReason student');
    if (!session) return res.status(404).json({ error: 'Session not found' });

    res.json({
      sessionId:          session._id,
      disputeStatus:      session.disputeStatus,
      videoSubmittedAt:   session.disputeSubmittedAt || null,
      videoDeletedAt:     session.disputeDeletedAt   || null,
      deletionReason:     session.deletionReason     || null,
      videoCurrentlyHeld: !!(session.disputeVideoPath && session.disputeVideoPath.length > 0)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve audit log' });
  }
});

