require("dotenv").config();
const pdfParse = require("pdf-parse");
const fetch = (...args) => import("node-fetch").then(mod => mod.default(...args));

const MAX_TEXT_CHARS = 3000;
const TOTAL_QUESTIONS = 50;
const BATCH_SIZE = 10;

console.log("OPENROUTER KEY:", process.env.OPENROUTER_API_KEY);

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
- Return ONLY a valid JSON array.
- DO NOT wrap the response in markdown code blocks like \`\`\`json ... \`\`\`.
- NO preamble, NO explanation, NO conversational text.
- Each object must have "question", "options" (with A, B, C, D), and "answer" (A, B, C, or D).

FORMAT EXAMPLE:
[{"question": "What is 1+1?", "options": {"A": "1", "B": "2", "C": "3", "D": "4"}, "answer": "B"}]

TEXT:
${truncatedText}
      `;

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:3000", // Optional, for OpenRouter analytics
          "X-Title": "Teacher Evaluation System"    // Optional
        },
        body: JSON.stringify({
          model: "google/gemini-2.0-flash-exp:free",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1, // Lower temperature for more consistent JSON
          max_tokens: 2500
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} - ${errText}`);
      }

      const data = await response.json();
      const rawText = data?.choices?.[0]?.message?.content || "";

      // Try to extract JSON array if AI still wraps it
      const jsonMatch = rawText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed)) {
            questions.push(...parsed);
          } else {
            console.warn("⚠️ AI returned JSON but not an array, using fallbacks for this batch.");
            questions.push(...generateFallbackQuestions(BATCH_SIZE));
          }
        } catch (parseErr) {
          console.error("❌ JSON Parse failed. Raw response snippet:", rawText.slice(0, 200));
          questions.push(...generateFallbackQuestions(BATCH_SIZE));
        }
      } else {
        console.error("❌ No JSON array found in AI response. Raw response snapshot:", rawText.slice(0, 200));
        questions.push(...generateFallbackQuestions(BATCH_SIZE));
      }

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