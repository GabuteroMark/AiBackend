require("dotenv").config();
const pdfParse = require("pdf-parse");
const fetch = (...args) => import("node-fetch").then(mod => mod.default(...args));

const MAX_TEXT_CHARS = 15000; // Increased context for better generation
const TOTAL_QUESTIONS = 50;
const BATCH_SIZE = 10;

console.log("OPENROUTER KEY:", process.env.OPENROUTER_API_KEY ? "Set (First 10: " + process.env.OPENROUTER_API_KEY.substring(0, 10) + "...)" : "Not Set");

// Extract text
async function extractTextFromPDF(buffer) {
  try {
    const data = await pdfParse(buffer);
    let text = data?.text || "";

    // Basic cleanup: replace multiple spaces/newlines
    text = text.replace(/\s+/g, " ").trim();

    // If text is very short, it might be an image-only PDF or failed extraction
    if (text.length < 50) {
      console.warn("⚠️ PDF extraction yielded very little text. Document might be scanned or protected.");
    }

    return text;
  } catch (err) {
    console.error("❌ PDF extraction failed:", err.message);
    return "";
  }
}

// Generate questions
async function generateQuestionsWithOpenRouter(text) {
  if (!text || text.length < 100) {
    console.warn("⚠️ Text too short for AI generation, using fallbacks.");
    return numberQuestions(generateFallbackQuestions(TOTAL_QUESTIONS));
  }

  const truncatedText = text.slice(0, MAX_TEXT_CHARS);
  const questions = [];
  const batches = Math.ceil(TOTAL_QUESTIONS / BATCH_SIZE);

  console.log(`[AI] Starting generation for ${TOTAL_QUESTIONS} questions in ${batches} batches.`);

  for (let i = 0; i < batches; i++) {
    try {
      console.log(`[AI] Processing batch ${i + 1}/${batches}...`);
      const prompt = `
Generate ${BATCH_SIZE} unique multiple choice questions based on the following text.

TEXT CONTENT:
"${truncatedText}"

STRICT RULES:
1. Return ONLY a valid JSON array of objects.
2. Each object MUST have:
   - "question": A clear question string based on the text.
   - "options": An object with keys "A", "B", "C", "D".
   - "answer": The correct option key ("A", "B", "C", or "D").
3. DO NOT use markdown code blocks (no \`\`\`json).
4. NO preamble, NO conversational text, NO explanations.
5. Ensure questions are relevant to the provided text.

FORMAT:
[{"question": "Example?", "options": {"A": "1", "B": "2", "C": "3", "D": "4"}, "answer": "B"}]
      `;

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "Teacher Evaluation System"
        },
        body: JSON.stringify({
          model: "google/gemini-2.0-flash-001", // Updated to a more stable version
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          max_tokens: 3000
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`❌ OpenRouter API error (Batch ${i + 1}): ${response.status} - ${errText}`);
        // Instead of pushing fallbacks immediately, we log and continue. 
        // We only push fallbacks at the very end if we don't have enough questions.
        continue;
      }

      const data = await response.json();
      let rawText = data?.choices?.[0]?.message?.content || "";

      // Improved cleaning: Handle cases where the model might include text before/after the JSON array
      const jsonStartIndex = rawText.indexOf('[');
      const jsonEndIndex = rawText.lastIndexOf(']');

      if (jsonStartIndex !== -1 && jsonEndIndex !== -1) {
        rawText = rawText.substring(jsonStartIndex, jsonEndIndex + 1);
      } else {
        console.warn(`[AI] Batch ${i + 1} response did not contain a valid JSON array structure. Raw:`, rawText.slice(0, 100));
        continue;
      }

      try {
        const parsed = JSON.parse(rawText);
        if (Array.isArray(parsed)) {
          questions.push(...parsed);
        } else {
          console.warn(`[AI] Batch ${i + 1} returned object instead of array.`);
        }
      } catch (parseErr) {
        console.error(`[AI] JSON Parse failed for batch ${i + 1}. Snippet:`, rawText.slice(0, 100));
      }

    } catch (err) {
      console.error(`❌ OpenRouter batch ${i + 1} failed:`, err.message);
    }
  }

  // If we don't have enough questions, fill with fallbacks only for the missing ones
  if (questions.length < TOTAL_QUESTIONS) {
    const missing = TOTAL_QUESTIONS - questions.length;
    console.log(`[AI] Generation under-delivered. Filling ${missing} questions with fallbacks.`);
    questions.push(...generateFallbackQuestions(missing));
  }

  console.log(`[AI] Generation complete. Total questions: ${questions.length}`);
  return numberQuestions(questions.slice(0, TOTAL_QUESTIONS));
}

// Number questions: remove AI prepended numbers to prevent double numbering
function numberQuestions(questions) {
  return questions.map((q, i) => ({
    question: String(q.question || "").replace(/^\d+\.\s*/, "").replace(/^"|"$/g, "").trim(),
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
    question: `Fallback Question: What is a key concept discussed in this document?`,
    options: {
      A: "A major theme mentioned in the text",
      B: "A minor detail from the introduction",
      C: "A specific example provided later",
      D: "A summary of the overall conclusion"
    },
    answer: "A"
  }));
}

module.exports = { extractTextFromPDF, generateQuestionsWithOpenRouter };