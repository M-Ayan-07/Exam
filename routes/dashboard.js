const express = require('express');
const router = express.Router();
const ExamSession = require('../models/ExamSession');
const { authMiddleware, requireRole } = require('../middleware/auth');

// GET /api/dashboard/sessions — all sessions (invigilator only)
router.get('/sessions', authMiddleware, requireRole('invigilator'), async (req, res) => {
  try {
    const sessions = await ExamSession.find({ status: 'submitted' })
      .populate('student', 'name email')
      .populate('exam', 'title')
      .sort({ endTime: -1 }) // Most recent first
      .select('student exam score credibilityScore endTime violations status startTime');

    return res.json(sessions);
  } catch (err) {
    console.error('Dashboard sessions error:', err.message);
    return res.status(500).json({ error: 'Failed to load sessions.' });
  }
});

// GET /api/dashboard/session/:id — full session detail
router.get('/session/:id', authMiddleware, async (req, res) => {
  try {
    const session = await ExamSession.findById(req.params.id)
      .populate('student', 'name email')
      .populate('exam', 'title questions');

    if (!session) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    // Students can only view their own session; invigilators can view any
    if (req.user.role === 'student' && session.student._id.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    return res.json(session);
  } catch (err) {
    console.error('Dashboard session detail error:', err.message);
    return res.status(500).json({ error: 'Failed to load session detail.' });
  }
});

module.exports = router;
