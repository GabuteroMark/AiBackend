const { PDFDocument, StandardFonts } = require("pdf-lib");
const fs = require("fs");
const path = require("path");
const pool = require("../utils/db");
const { extractTextFromPDF, generateQuestionsWithOpenRouter } = require("../utils/ai");

// Submit a topic for approval (Teacher)
async function submitTopicRequest(req, res, next) {
  try {
    if (!req.files || !req.files.file)
      return res.status(400).json({ error: "No file uploaded" });

    const pdfFile = req.files.file;
    const accountId = Number(req.body.accountId);
    const gradeLevelId = Number(req.body.gradeLevelId);
    const subjectId = Number(req.body.subjectId);

    if (!accountId || !gradeLevelId || !subjectId)
      return res.status(400).json({ error: "Account, Grade level, and Subject required" });

    const uploadDir = path.join(__dirname, "../uploads", "requests");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const fileName = `${Date.now()}_${pdfFile.name}`;
    const filePath = path.join(uploadDir, fileName);

    // Move file to uploads/requests
    await pdfFile.mv(filePath);

    // Save request to DB
    const [result] = await pool.query(
      `INSERT INTO topicrequests (accountId, gradeLevelId, subjectId, fileName, filePath, status, aiStatus, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, 'Pending', 'Idle', NOW(), NOW())`,
      [accountId, gradeLevelId, subjectId, fileName, filePath]
    );

    res.json({
      message: "Topic submitted for approval successfully",
      requestId: result.insertId
    });

  } catch (err) {
    console.error("❌ submitTopicRequest error:", err);
    next(err);
  }
}

// Get topic requests (Admin views all, Teacher views own)
async function getTopicRequests(req, res, next) {
  try {
    const accountId = req.query.accountId ? Number(req.query.accountId) : null;
    const role = req.query.role; // 'Admin' or 'Teacher'

    let query = `
      SELECT tr.*, gl.name as gradeLevelName, s.name as subjectName, a.firstName, a.lastName
      FROM topicrequests tr
      JOIN gradelevels gl ON tr.gradeLevelId = gl.id
      JOIN subjects s ON tr.subjectId = s.id
      JOIN accounts a ON tr.accountId = a.id
    `;
    let params = [];

    if (role !== 'Admin' && accountId) {
      query += " WHERE tr.accountId = ?";
      params.push(accountId);
    }

    query += " ORDER BY tr.createdAt DESC";

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("❌ getTopicRequests error:", err);
    next(err);
  }
}

// Admin Approve & Trigger AI Generation
async function approveAndGenerate(req, res, next) {
  try {
    const requestId = Number(req.params.id);
    if (!requestId) return res.status(400).json({ error: "Request ID required" });

    // 1. Get request details
    const [requests] = await pool.query("SELECT * FROM topicrequests WHERE id = ?", [requestId]);
    if (requests.length === 0) return res.status(404).json({ error: "Request not found" });

    const tr = requests[0];

    // 2. Update status to Processing
    await pool.query("UPDATE topicrequests SET status = 'Approved', aiStatus = 'Processing', updatedAt = NOW() WHERE id = ?", [requestId]);

    // 3. Perform AI Generation (reuse original logic)
    const buffer = fs.readFileSync(tr.filePath);
    const text = await extractTextFromPDF(buffer);

    if (!text || text.trim().length === 0) {
      await pool.query("UPDATE TopicRequests SET aiStatus = 'Failed', remarks = 'No readable text' WHERE id = ?", [requestId]);
      return res.status(400).json({ error: "No readable text found in PDF" });
    }

    const questions = await generateQuestionsWithOpenRouter(text);
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      await pool.query("UPDATE TopicRequests SET aiStatus = 'Failed', remarks = 'AI Generation Failed' WHERE id = ?", [requestId]);
      return res.status(400).json({ error: "AI failed to generate questions" });
    }

    // Save questions
    for (let q of questions) {
      await pool.query(
        `INSERT INTO questions 
         (gradeLevelId, subjectId, question, optionA, optionB, optionC, optionD, answer, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [tr.gradeLevelId, tr.subjectId, q.question, q.options?.A || "", q.options?.B || "", q.options?.C || "", q.options?.D || "", q.answer || ""]
      );
    }

    // Generate PDF
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    let page = pdfDoc.addPage();
    let y = page.getHeight() - 40;
    const fontSize = 12;

    questions.forEach((q, index) => {
      if (y < 80) { page = pdfDoc.addPage(); y = page.getHeight() - 40; }
      page.drawText(`${index + 1}. ${q.question}`, { x: 50, y, size: fontSize, font });
      y -= 20;
      page.drawText(`A. ${q.options?.A}`, { x: 60, y, size: fontSize, font }); y -= 15;
      page.drawText(`B. ${q.options?.B}`, { x: 60, y, size: fontSize, font }); y -= 15;
      page.drawText(`C. ${q.options?.C}`, { x: 60, y, size: fontSize, font }); y -= 15;
      page.drawText(`D. ${q.options?.D}`, { x: 60, y, size: fontSize, font }); y -= 25;
    });

    const subjectDir = path.join(__dirname, "../generated", String(tr.subjectId));
    if (!fs.existsSync(subjectDir)) fs.mkdirSync(subjectDir, { recursive: true });

    const pdfFileName = `Approved_Topic_${Date.now()}.pdf`;
    const pdfPathResult = path.join(subjectDir, pdfFileName);
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(pdfPathResult, pdfBytes);

    // Save PDF record
    await pool.query(
      `INSERT INTO generatedpdfs (subjectId, gradeLevelId, filePath, downloadUrl, createdAt)
      VALUES (?, ?, ?, ?, NOW())`,
      [tr.subjectId, tr.gradeLevelId, pdfPathResult, `/download/${tr.subjectId}/${pdfFileName}`]
    );

    // Update Request to Completed
    await pool.query("UPDATE topicrequests SET aiStatus = 'Completed', updatedAt = NOW() WHERE id = ?", [requestId]);

    res.json({ message: "Topic approved and questions generated successfully", downloadUrl: `/download/${tr.subjectId}/${pdfFileName}` });

  } catch (err) {
    console.error("❌ approveAndGenerate error:", err);
    await pool.query("UPDATE topicrequests SET aiStatus = 'Failed' WHERE id = ?", [req.params.id]);
    next(err);
  }
}

// Admin Reject
async function rejectTopicRequest(req, res, next) {
  try {
    const requestId = Number(req.params.id);
    const remarks = req.body.remarks || "No reason provided";

    await pool.query(
      "UPDATE topicrequests SET status = 'Rejected', remarks = ?, updatedAt = NOW() WHERE id = ?",
      [remarks, requestId]
    );

    res.json({ message: "Topic request rejected" });
  } catch (err) {
    console.error("❌ rejectTopicRequest error:", err);
    next(err);
  }
}

// Get grade levels
async function getGradeLevels(req, res) {
  try {
    const [rows] = await pool.query("SELECT id, name, TRIM(academicLevel) as academicLevel FROM gradelevels ORDER BY id");
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
      `SELECT s.id, s.name, TRIM(gl.name) as gradeLevelName 
       FROM subjects s 
       JOIN gradelevels gl ON s.gradeLevelId = gl.id
       WHERE s.gradeLevelId = ? AND s.subjectStatus = 'active'`,
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
       FROM generatedpdfs 
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
  submitTopicRequest,
  getTopicRequests,
  approveAndGenerate,
  rejectTopicRequest,
  getGradeLevels,
  getSubjectsByGrade,
  getGeneratedPDFs
};