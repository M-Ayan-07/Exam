const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');

// Helper: sign JWT (8h expiry)
function signToken(user) {
  return jwt.sign(
    { id: user._id, name: user.name, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    // Check if email already in use
    const existing = await User.findOne({ email });
    if (existing) {
      // Give a specific message if they're trying the wrong portal
      if (existing.role !== role) {
        return res.status(409).json({
          error: `This email is already registered as a ${existing.role}. Please sign in via the ${existing.role} portal.`
        });
      }
      return res.status(409).json({
        error: 'An account with this email already exists. Please sign in instead.'
      });
    }

    const allowedRoles = ['student', 'invigilator'];
    const userRole     = allowedRoles.includes(role) ? role : 'student';

    const user = new User({ name, email, password, role: userRole });
    await user.save();

    const token = signToken(user);
    return res.status(201).json({ token, role: user.role, name: user.name });

  } catch (err) {
    console.error('Register error:', err.message);
    return res.status(500).json({ error: 'Server error during registration.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'No account found with this email.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect password. Please try again.' });
    }

    const token = signToken(user);
    return res.json({ token, role: user.role, name: user.name });

  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ error: 'Server error during login.' });
  }
});

module.exports = router;