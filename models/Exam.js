const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  text: { type: String, required: true },
  options: [{ type: String, required: true }], // Array of 4 options
  correct: { type: Number, required: true }     // 0-indexed correct option
});

const examSchema = new mongoose.Schema({
  title: { type: String, required: true },
  duration: { type: Number, default: 30 }, // Duration in minutes
  questions: [questionSchema]
}, { timestamps: true });

module.exports = mongoose.model('Exam', examSchema);
