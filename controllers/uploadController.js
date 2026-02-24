const { PDFDocument, StandardFonts } = require("pdf-lib");
const fs = require("fs");
const path = require("path");
const pool = require("../utils/db");
const { extractTextFromPDF, generateQuestionsWithOpenRouter } = require("../utils/ai");

// Upload PDF and generate questions
async function uploadPDF(req, res, next) {
  try {
    if (!req.files || !req.files.file)
      return res.status(400).json({ error: "No file uploaded" });

    const pdfFile = req.files.file;
    const buffer = fs.readFileSync(pdfFile.tempFilePath);

    const gradeLevelId = Number(req.body.gradeLevelId);
    const subjectId = Number(req.body.subjectId);

    if (!gradeLevelId || !subjectId)
      return res.status(400).json({ error: "Grade level and subject required" });

    // Extract text
    const text = await extractTextFromPDF(buffer);
    if (!text || text.trim().length === 0)
      return res.status(400).json({ error: "No readable text found in PDF" });

    // Generate questions
    const questions = await generateQuestionsWithOpenRouter(text);
    if (!questions || !Array.isArray(questions) || questions.length === 0)
      return res.status(400).json({ error: "AI failed to generate questions" });

    // Save questions to DB
    for (let q of questions) {
      await pool.query(
        `INSERT INTO Questions 
         (gradeLevelId, subjectId, question, optionA, optionB, optionC, optionD, answer, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          gradeLevelId,
          subjectId,
          q.question,
          q.options?.A || "",
          q.options?.B || "",
          q.options?.C || "",
          q.options?.D || "",
          q.answer || ""
        ]
      );
    }

    // Create PDF with multiple questions per page
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    let page = pdfDoc.addPage();
    let y = page.getHeight() - 40;
    const fontSize = 12;

    questions.forEach((q, index) => {
      if (y < 80) { // new page if space is low
        page = pdfDoc.addPage();
        y = page.getHeight() - 40;
      }
      page.drawText(`${index + 1}. ${q.question}`, { x: 50, y, size: fontSize, font });
      y -= 20;
      page.drawText(`A. ${q.options?.A}`, { x: 60, y, size: fontSize, font });
      y -= 15;
      page.drawText(`B. ${q.options?.B}`, { x: 60, y, size: fontSize, font });
      y -= 15;
      page.drawText(`C. ${q.options?.C}`, { x: 60, y, size: fontSize, font });
      y -= 15;
      page.drawText(`D. ${q.options?.D}`, { x: 60, y, size: fontSize, font });
      y -= 25;
    });

    const subjectDir = path.join(__dirname, "../generated", String(subjectId));
    if (!fs.existsSync(subjectDir)) fs.mkdirSync(subjectDir, { recursive: true });

    const pdfFileName = `Generated_Questions_${Date.now()}.pdf`;
    const pdfPath = path.join(subjectDir, pdfFileName);
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(pdfPath, pdfBytes);

    // Save PDF record to DB with proper createdAt
    // Save PDF record to DB
    // Save PDF record to DB
    await pool.query(
      `INSERT INTO GeneratedPDFs (subjectId, gradeLevelId, filePath, downloadUrl, createdAt)
      VALUES (?, ?, ?, ?, NOW())`,
      [subjectId, gradeLevelId, pdfPath, `/download/${subjectId}/${pdfFileName}`]
    );

    // Respond with generated questions and download URL
    res.json({
      message: "PDF generated successfully",
      downloadUrl: `/download/${subjectId}/${pdfFileName}`,
      questions
    });

  } catch (err) {
    console.error("❌ uploadPDF error:", err);
    next(err);
  }
}

// Get grade levels
async function getGradeLevels(req, res) {
  try {
    const [rows] = await pool.query("SELECT id, name FROM GradeLevels ORDER BY id");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch grade levels" });
  }
}

// Get subjects by grade
async function getSubjectsByGrade(req, res) {
  try {
    const gradeId = Number(req.query.gradeLevelId);
    if (!gradeId) return res.json([]);

    const [rows] = await pool.query(
      "SELECT id, name FROM Subjects WHERE gradeLevelId = ? AND subjectStatus = 'active'",
      [gradeId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch subjects" });
  }
}

// Get all PDFs for a subject
async function getGeneratedPDFs(req, res) {
  try {
    const subjectId = Number(req.params.subjectId);
    if (!subjectId) return res.json([]);

    const [rows] = await pool.query(
      `SELECT id, filePath, downloadUrl, createdAt 
       FROM GeneratedPDFs 
       WHERE subjectId = ? 
       ORDER BY createdAt DESC`,
      [subjectId]
    );

    // Transform file name for display
    const formattedRows = rows.map(r => ({
      ...r,
      name: r.filePath.split("/").pop()
    }));

    res.json(formattedRows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch PDFs" });
  }
}

module.exports = {
  uploadPDF,
  getGradeLevels,
  getSubjectsByGrade,
  getGeneratedPDFs
};