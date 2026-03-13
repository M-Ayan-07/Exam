const express = require('express');
const router = express.Router();
const Exam = require('../models/Exam');
const ExamSession = require('../models/ExamSession');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { analyzeWithGemini } = require('../services/gemini');

// Generate a random 6-char uppercase alphanumeric code
function genMobileCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// GET /api/exam/questions — student fetches exam questions (correct answers NOT sent)
router.get('/questions', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const exam = await Exam.findOne().select('-questions.correct'); // Hide correct answers
    if (!exam) {
      return res.status(404).json({ error: 'No exam found. Please contact your invigilator.' });
    }
    return res.json(exam);
  } catch (err) {
    console.error('Get questions error:', err.message);
    return res.status(500).json({ error: 'Failed to load exam questions.' });
  }
});

// POST /api/exam/start — student starts an exam session
router.post('/start', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const exam = await Exam.findOne();
    if (!exam) {
      return res.status(404).json({ error: 'No exam available.' });
    }

    // Check if student already has an in-progress session
    const existing = await ExamSession.findOne({
      student: req.user.id,
      status: 'in-progress'
    });
    if (existing) {
      // Ensure legacy sessions have a mobileCode
      if (!existing.mobileCode) {
        existing.mobileCode = genMobileCode();
        await existing.save();
      }
      return res.json({
        sessionId:  existing._id,
        examId:     exam._id,
        duration:   exam.duration,
        mobileCode: existing.mobileCode
      });
    }

    const session = new ExamSession({
      student: req.user.id,
      exam: exam._id,
      answers: new Array(exam.questions.length).fill(-1),
      mobileCode: genMobileCode()
    });
    await session.save();

    return res.status(201).json({
      sessionId:  session._id,
      examId:     exam._id,
      duration:   exam.duration,
      mobileCode: session.mobileCode
    });
  } catch (err) {
    console.error('Start exam error:', err.message);
    return res.status(500).json({ error: 'Failed to start exam session.' });
  }
});

// POST /api/exam/submit — student submits answers + violations
router.post('/submit', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const { sessionId, answers, violations } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required.' });
    }

    const session = await ExamSession.findById(sessionId).populate('exam');
    if (!session) {
      return res.status(404).json({ error: 'Exam session not found.' });
    }

    // Prevent double submission
    if (session.status === 'submitted') {
      return res.json({ sessionId: session._id, message: 'Already submitted.' });
    }

    // Verify the session belongs to this student
    if (session.student.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized: This session does not belong to you.' });
    }

    const exam = session.exam;

    // Calculate exam score (count correct answers)
    let correct = 0;
    const validAnswers = Array.isArray(answers) ? answers : [];
    exam.questions.forEach((q, i) => {
      if (validAnswers[i] !== undefined && validAnswers[i] === q.correct) {
        correct++;
      }
    });
    const scorePercent = Math.round((correct / exam.questions.length) * 100);

    // Sanitize and store violations (prevent oversized payloads)
    const safeViolations = Array.isArray(violations)
      ? violations.slice(0, 500).map(v => ({
          type: v.type || 'unknown',
          timestamp: v.timestamp ? new Date(v.timestamp) : new Date(),
          detail: typeof v.detail === 'string' ? v.detail.slice(0, 200) : ''
        }))
      : [];

    // Generate credibility report via Gemini (or fallback)
    const { credibilityScore, report } = await analyzeWithGemini(
      safeViolations,
      scorePercent,
      req.user.name
    );

    // Update session record
    session.answers = validAnswers;
    session.violations = safeViolations;
    session.score = scorePercent;
    session.credibilityScore = credibilityScore;
    session.credibilityReport = report;
    session.endTime = new Date();
    session.status = 'submitted';
    await session.save();

    return res.json({
      sessionId: session._id,
      score: scorePercent,
      credibilityScore,
      credibilityReport: report,
      violations: safeViolations
    });
  } catch (err) {
    console.error('Submit exam error:', err.message);
    return res.status(500).json({ error: 'Failed to submit exam. Please try again.' });
  }
});

module.exports = router;
