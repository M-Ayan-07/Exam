const mongoose = require('mongoose');

const violationSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: [
      'tab_switch',
      'window_blur',
      'window_resize',
      'right_click',
      'copy_shortcut',
      'paste_shortcut',
      'cut_shortcut',
      'select_all_shortcut',
      'devtools_open',
      'fullscreen_exit',
      'mouse_leave',
      'clipboard_copy',
      // ── Face detection ──
      'face_not_detected',
      'multiple_faces',
      'face_looking_away',
      'face_left_frame'
    ]
  },
  timestamp: { type: Date, required: true },
  detail:    { type: String, default: '' }
});

const examSessionSchema = new mongoose.Schema({
  student:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  exam:              { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  startTime:         { type: Date, default: Date.now },
  endTime:           { type: Date },
  violations:        [violationSchema],
  answers:           [{ type: Number, default: -1 }],
  score:             { type: Number, default: 0   },
  credibilityScore:  { type: Number, default: 100 },
  credibilityReport: { type: String, default: ''  },
  status: {
    type: String,
    enum: ['in-progress', 'submitted'],
    default: 'in-progress'
  },
  // Mobile QR monitor fields
  mobileCode:          { type: String, index: true },
  disputeStatus:       { type: String, enum: ['none', 'pending', 'accepted', 'rejected'], default: 'none' },
  disputeVideoPath:    { type: String, default: '' },
  disputeSubmittedAt:  { type: Date },
  // Deletion audit log — kept permanently even after file is deleted
  disputeDeletedAt:    { type: Date },
  deletionReason:      { type: String, default: '' }  // e.g. "Auto-deleted after 24h privacy policy"
}, { timestamps: true });

module.exports = mongoose.model('ExamSession', examSessionSchema);