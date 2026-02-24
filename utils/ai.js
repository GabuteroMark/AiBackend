require("dotenv").config();
const pdfParse = require("pdf-parse");
const fetch = (...args) => import("node-fetch").then(mod => mod.default(...args));

const MAX_TEXT_CHARS = 3000;
const TOTAL_QUESTIONS = 50;
const BATCH_SIZE = 10;

// Extract text
async function extractTextFromPDF(buffer) {
  try {
    const data = await pdfParse(buffer);
    return data?.text?.replace(/\s+/g, " ").trim() || "";
  } catch (err) {
    console.error("❌ PDF extraction failed:", err.message);
    return "";
  }
}

// Generate questions
async function generateQuestionsWithOpenRouter(text) {
  if (!text || text.length < 50) return numberQuestions(generateFallbackQuestions(TOTAL_QUESTIONS));

  const truncatedText = text.slice(0, MAX_TEXT_CHARS);
  const questions = [];
  const batches = Math.ceil(TOTAL_QUESTIONS / BATCH_SIZE);

  for (let i = 0; i < batches; i++) {
    try {
      const prompt = `
Generate ${BATCH_SIZE} multiple choice questions from the text below.

STRICT RULES:
- Return ONLY valid JSON
- No explanation
- No markdown
- Must start with [
- Must end with ]

FORMAT:
[ { "question":"", "options": {"A":"", "B":"", "C":"", "D":""}, "answer":"A" } ]

TEXT:
${truncatedText}
      `;

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "mistralai/mistral-7b-instruct",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          max_tokens: 2000
        })
      });

      if (!response.ok) throw new Error(`OpenRouter API error: ${response.status}`);
      const data = await response.json();
      const rawText = data?.choices?.[0]?.message?.content || "";

      const jsonMatch = rawText.match(/\[[\s\S]*\]/);
      if (jsonMatch) questions.push(...JSON.parse(jsonMatch[0]));
      else questions.push(...generateFallbackQuestions(BATCH_SIZE));

    } catch (err) {
      console.error("❌ OpenRouter batch failed:", err.message);
      questions.push(...generateFallbackQuestions(BATCH_SIZE));
    }
  }

  return numberQuestions(questions.slice(0, TOTAL_QUESTIONS));
}

// Number questions: remove AI prepended numbers to prevent double numbering
function numberQuestions(questions) {
  return questions.map((q, i) => ({
    question: String(q.question || "").replace(/^\d+\.\s*/, "").trim(),
    options: {
      A: q.options?.A || "Option A",
      B: q.options?.B || "Option B",
      C: q.options?.C || "Option C",
      D: q.options?.D || "Option D"
    },
    answer: q.answer || "A"
  }));
}

// Fallback questions
function generateFallbackQuestions(count) {
  return Array.from({ length: count }, (_, i) => ({
    question: `Fallback Question ${i + 1}: What is discussed in the document?`,
    options: { A: "Option A", B: "Option B", C: "Option C", D: "Option D" },
    answer: "A"
  }));
}

module.exports = { extractTextFromPDF, generateQuestionsWithOpenRouter };