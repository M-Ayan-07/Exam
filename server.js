require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');
const Exam = require('./models/Exam');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '2mb' })); // Violations payload can be sizeable
app.use(express.urlencoded({ extended: true }));

// Serve all frontend files from /public
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',    require('./routes/auth'));
app.use('/api/exam',    require('./routes/exam'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/dispute', require('./routes/dispute'));

// ── Frontend catch-all (SPA-style fallback) ───────────────────────────────────
// app.get('*', (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'login.html'));
// });
// AFTER
app.get('*', (req, res) => {
  const htmlPages = ['dashboard', 'exam', 'login', 'report', 'preexam', 'mobile'];
  const reqPage = req.path.replace('/', '').replace('.html', '');
  if (htmlPages.includes(reqPage)) {
    return res.sendFile(path.join(__dirname, 'public', `${reqPage}.html`));
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

// ── Demo Exam Seed Data ───────────────────────────────────────────────────────
async function seedExam() {
  try {
    const count = await Exam.countDocuments();
    if (count > 0) return; // Already seeded

    await Exam.create({
      title: 'General Knowledge & Computer Science — Demo Exam',
      duration: 30, // 30 minutes
      questions: [
        {
          text: 'What does CPU stand for?',
          options: ['Central Processing Unit', 'Computer Personal Unit', 'Central Program Utility', 'Core Processing Unit'],
          correct: 0
        },
        {
          text: 'Which data structure follows Last-In-First-Out (LIFO) order?',
          options: ['Queue', 'Linked List', 'Stack', 'Tree'],
          correct: 2
        },
        {
          text: 'Which of the following is NOT a JavaScript data type?',
          options: ['Boolean', 'Float', 'String', 'Symbol'],
          correct: 1
        },
        {
          text: 'What is the time complexity of binary search on a sorted array?',
          options: ['O(n)', 'O(n²)', 'O(log n)', 'O(1)'],
          correct: 2
        },
        {
          text: 'Which HTTP method is typically used to create a new resource?',
          options: ['GET', 'PUT', 'DELETE', 'POST'],
          correct: 3
        },
        {
          text: 'What does DNS stand for?',
          options: ['Domain Name System', 'Dynamic Network Service', 'Data Node Sync', 'Distributed Name Server'],
          correct: 0
        },
        {
          text: 'In object-oriented programming, what is "encapsulation"?',
          options: [
            'Breaking a program into smaller functions',
            'Bundling data and methods into a single unit',
            'A class inheriting from another class',
            'Writing the same function for multiple data types'
          ],
          correct: 1
        },
        {
          text: 'Which protocol is used to securely transfer files over a network?',
          options: ['FTP', 'HTTP', 'SFTP', 'SMTP'],
          correct: 2
        },
        {
          text: 'What does SQL stand for?',
          options: ['Structured Query Language', 'Simple Question Language', 'System Query Logic', 'Stored Query Layer'],
          correct: 0
        },
        {
          text: 'Which sorting algorithm has the best average-case time complexity?',
          options: ['Bubble Sort', 'Selection Sort', 'Merge Sort', 'Insertion Sort'],
          correct: 2
        }
      ]
    });

    console.log('✅ Demo exam seeded with 10 questions');
  } catch (err) {
    console.error('❌ Exam seed error:', err.message);
  }
}

// ── Start Server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

connectDB().then(async () => {
  await seedExam();
  app.listen(PORT, () => {
    console.log(`🚀 Exam Proctor running at http://localhost:${PORT}`);
  });
});
