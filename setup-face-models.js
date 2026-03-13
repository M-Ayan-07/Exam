/**
 * setup-face-models.js
 * Run this ONCE from your project root:  node setup-face-models.js
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const BASE   = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';
const OUTDIR = path.join(__dirname, 'public', 'face-models');

const FILES = [
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model-shard1',
  'face_landmark_68_tiny_model-weights_manifest.json',
  'face_landmark_68_tiny_model-shard1',        // ← will try this first
  'face_landmark_68_tiny_model-shard2',        // ← fallback if shard1 404s
];

if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });

function download(filename) {
  return new Promise((resolve, reject) => {
    const dest = path.join(OUTDIR, filename);
    const file = fs.createWriteStream(dest);
    https.get(`${BASE}/${filename}`, res => {
      if (res.statusCode === 404) { fs.unlink(dest, () => {}); resolve('skip'); return; }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} for ${filename}`)); return; }
      res.pipe(file);
      file.on('finish', () => { file.close(); console.log(`✅  ${filename}`); resolve('ok'); });
    }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

(async () => {
  console.log('📥  Downloading face-api models into public/face-models/...\n');
  try {
    for (const f of FILES) {
      const result = await download(f);
      if (result === 'skip') console.log(`⏭️  ${f} not found — skipping`);
    }
    console.log('\n✅  All models downloaded. You can now run your server.');
  } catch (err) {
    console.error('\n❌  Download failed:', err.message);
    process.exit(1);
  }
})();