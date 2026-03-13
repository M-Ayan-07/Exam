const { GoogleGenerativeAI } = require('@google/generative-ai');

// Build a human-readable summary of violations for the AI prompt
function buildViolationSummary(violations) {
  if (!violations || violations.length === 0) {
    return 'No violations were recorded during this exam session.';
  }

  const counts = {};
  violations.forEach(v => {
    counts[v.type] = (counts[v.type] || 0) + 1;
  });

  const lines = Object.entries(counts).map(([type, count]) => {
    const label = type.replace(/_/g, ' ');
    return `- ${label}: ${count} time(s)`;
  });

  return lines.join('\n');
}

// Rule-based fallback if Gemini is unavailable
function generateFallbackReport(violations, examScore) {
  const total = violations.length;
  let credibilityScore;

  if (total === 0) credibilityScore = 100;
  else if (total <= 2) credibilityScore = 85;
  else if (total <= 5) credibilityScore = 65;
  else if (total <= 10) credibilityScore = 40;
  else credibilityScore = 20;

  const summary = buildViolationSummary(violations);
  const report = `Credibility Analysis (Auto-Generated)\n\nExam Score: ${examScore}%\nTotal Violations: ${total}\n\nViolation Breakdown:\n${summary}\n\nConclusion: Based on ${total} recorded behaviour anomalies, the student's credibility score is ${credibilityScore}/100. ${credibilityScore >= 80 ? 'The session appears largely compliant.' : credibilityScore >= 50 ? 'Several suspicious behaviours were detected. Manual review is recommended.' : 'Multiple high-risk behaviours detected. This session requires urgent manual review.'}`;

  return { credibilityScore, report };
}

async function analyzeWithGemini(violations, examScore, studentName) {
  // If no API key is configured, use the fallback immediately
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
    console.log('⚠️  No Gemini API key found — using rule-based fallback report');
    return generateFallbackReport(violations, examScore);
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });

    const violationSummary = buildViolationSummary(violations);
    const totalViolations = violations.length;

    const prompt = `
You are an exam integrity analyst. Analyze the following student behaviour data from an online exam and produce a credibility report.

Student Name: ${studentName}
Exam Score: ${examScore}%
Total Violations Detected: ${totalViolations}

Violation Breakdown:
${violationSummary}

Instructions:
1. Assign a credibility score from 0 to 100 (100 = fully trustworthy, 0 = highly suspicious).
2. Write a professional 3-4 sentence analysis explaining the credibility score.
3. Mention specific violation types that influenced your assessment.
4. Be fair — low scores might be accidental; consider the total count.

IMPORTANT: Respond ONLY with valid JSON in this exact format:
{
  "credibilityScore": <number 0-100>,
  "report": "<your analysis text>"
}
`;

    const result = await model.generateContent(prompt);
    const rawText = result.response.text().trim();

    // Safely extract JSON — Gemini sometimes wraps in markdown code blocks
    let jsonText = rawText;
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonText = jsonMatch[1].trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      // If JSON parsing fails, use fallback
      console.warn('⚠️  Gemini response was not valid JSON, using fallback');
      return generateFallbackReport(violations, examScore);
    }

    // Validate the parsed object has expected fields
    const credibilityScore = typeof parsed.credibilityScore === 'number'
      ? Math.min(100, Math.max(0, Math.round(parsed.credibilityScore)))
      : generateFallbackReport(violations, examScore).credibilityScore;

    const report = typeof parsed.report === 'string' && parsed.report.length > 0
      ? parsed.report
      : generateFallbackReport(violations, examScore).report;

    return { credibilityScore, report };

  } catch (err) {
    // Network error, quota exceeded, invalid key, etc.
    console.error('⚠️  Gemini API error:', err.message, '— using fallback report');
    return generateFallbackReport(violations, examScore);
  }
}

module.exports = { analyzeWithGemini };
