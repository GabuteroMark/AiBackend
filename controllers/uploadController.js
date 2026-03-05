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
    const sectionId = Number(req.body.sectionId);
    const subjectId = Number(req.body.subjectId);

    if (!accountId || !gradeLevelId || !sectionId || !subjectId)
      return res.status(400).json({ error: "Account, Grade, Section, and Subject required" });

    const timestampDir = `${Date.now()}`;
    const uploadDir = path.join(__dirname, "../uploads", "requests", timestampDir);
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    let filesArray = Array.isArray(req.files.file) ? req.files.file : [req.files.file];

    // Move all files to the timestamp directory
    for (const file of filesArray) {
      const filePath = path.join(uploadDir, file.name);
      await file.mv(filePath);
    }

    // Save request to DB - store the directory path
    const fileName = filesArray.length > 1 ? `Multiple Files (${filesArray.length})` : filesArray[0].name;

    const [result] = await pool.query(
      `INSERT INTO topicrequests (accountId, gradeLevelId, sectionId, subjectId, fileName, filePath, status, aiStatus, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, 'Pending', 'Idle', NOW(), NOW())`,
      [accountId, gradeLevelId, sectionId, subjectId, fileName, uploadDir]
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
      SELECT tr.id, tr.accountId, tr.gradeLevelId, tr.sectionId, tr.subjectId, 
             tr.fileName, tr.filePath, tr.status, tr.aiStatus, tr.remarks, tr.createdAt, tr.updatedAt,
             gl.name as gradeLevelName, 
             TRIM(gl.academicLevel) as academicLevel,
             sec.name as sectionName,
             s.name as subjectName, 
             a.firstName, 
             a.lastName,
             gp.downloadUrl as generatedPdfUrl
      FROM topicrequests tr
      JOIN gradelevels gl ON tr.gradeLevelId = gl.id
      JOIN sections sec ON tr.sectionId = sec.id
      JOIN subjects s ON tr.subjectId = s.id
      JOIN accounts a ON tr.accountId = a.id
      LEFT JOIN generatedpdfs gp ON gp.requestId = tr.id
    `;
    let params = [];

    if (role !== 'Admin' && role !== 'Coordinator' && accountId) {
      query += " WHERE tr.accountId = ?";
      params.push(accountId);
    }

    query += " ORDER BY tr.createdAt DESC";

    const [rows] = await pool.query(query, params);

    // Transform to add requestFileUrl
    const formattedRows = rows.map(r => {
      let requestFileUrl = null;
      if (r.filePath && r.fileName && !r.fileName.startsWith("Multiple Files")) {
        // Normalize slashes
        const normalizedPath = r.filePath.replace(/\\/g, '/');
        const token = 'uploads/requests';
        const index = normalizedPath.toLowerCase().lastIndexOf(token);

        if (index !== -1) {
          let afterToken = normalizedPath.substring(index + token.length).replace(/^\/+/, '').replace(/\/+$/, '');

          if (afterToken === "" || afterToken === r.fileName) {
            // File is directly in requests/
            requestFileUrl = `/download/requests/${r.fileName}`;
          } else {
            // In a subdirectory (timestamp)
            // Ensure afterToken includes the filename if it's just the dir
            if (!afterToken.toLowerCase().endsWith(r.fileName.toLowerCase())) {
              afterToken += '/' + r.fileName;
            }
            requestFileUrl = `/download/requests/${afterToken}`;
          }
        } else {
          // Absolute fallback
          requestFileUrl = `/download/requests/${r.fileName}`;
        }

        console.log(`[DEBUG] id: ${r.id} | filePath: ${r.filePath} | computed: ${requestFileUrl}`);
      }
      return { ...r, requestFileUrl };
    });

    console.log(`[DEBUG] Returning ${formattedRows.length} requests with URL transformations.`);

    res.json(formattedRows);
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

    // 3. Perform AI Generation
    let text = "";

    // Check if filePath is a directory (new logic) or a file (old logic)
    const stats = fs.statSync(tr.filePath);
    if (stats.isDirectory()) {
      const files = fs.readdirSync(tr.filePath);
      for (const file of files) {
        if (file.toLowerCase().endsWith('.pdf')) {
          const buffer = fs.readFileSync(path.join(tr.filePath, file));
          const extractedText = await extractTextFromPDF(buffer);
          text += " " + extractedText;
        }
      }
    } else {
      const buffer = fs.readFileSync(tr.filePath);
      text = await extractTextFromPDF(buffer);
    }

    if (!text || text.trim().length === 0) {
      await pool.query("UPDATE topicrequests SET aiStatus = 'Failed', remarks = 'No readable text' WHERE id = ?", [requestId]);
      return res.status(400).json({ error: "No readable text found in PDF(s)" });
    }

    const questions = await generateQuestionsWithOpenRouter(text);
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      await pool.query("UPDATE topicrequests SET aiStatus = 'Failed', remarks = 'AI Generation Failed' WHERE id = ?", [requestId]);
      return res.status(400).json({ error: "AI failed to generate questions" });
    }

    // Save questions
    for (let q of questions) {
      await pool.query(
        `INSERT INTO questions 
         (gradeLevelId, sectionId, subjectId, question, optionA, optionB, optionC, optionD, answer, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [tr.gradeLevelId, tr.sectionId, tr.subjectId, q.question, q.options?.A || "", q.options?.B || "", q.options?.C || "", q.options?.D || "", q.answer || ""]
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

    const originalNameMatch = tr.fileName.match(/^\d+_(.+)$/);
    const safeSubjectName = (tr.fileName || "Multiple_Files").replace(/[\/:*?"<>|]/g, "_");
    const pdfFileName = originalNameMatch ? originalNameMatch[1] : (tr.fileName.startsWith("Multiple Files") ? `${Date.now()}_Questions.pdf` : tr.fileName);

    const pdfPathResult = path.join(subjectDir, pdfFileName);
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(pdfPathResult, pdfBytes);

    // Save PDF record
    await pool.query(
      `INSERT INTO generatedpdfs (requestId, subjectId, gradeLevelId, filePath, downloadUrl, createdAt)
      VALUES (?, ?, ?, ?, ?, NOW())`,
      [requestId, tr.subjectId, tr.gradeLevelId, pdfPathResult, `/download/${tr.subjectId}/${pdfFileName}`]
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

// Get sections by grade
async function getSectionsByGradeLevel(req, res) {
  try {
    const gradeLevelId = Number(req.query.gradeLevelId);
    if (!gradeLevelId) return res.json([]);

    const [rows] = await pool.query(
      `SELECT id, name FROM sections WHERE gradeLevelId = ? ORDER BY id`,
      [gradeLevelId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch sections" });
  }
}

// Get subjects by section
async function getSubjectsBySection(req, res) {
  try {
    const sectionId = Number(req.query.sectionId);
    if (!sectionId) return res.json([]);

    const [rows] = await pool.query(
      `SELECT s.id, s.name, sec.name as sectionName 
       FROM subjects s 
       JOIN sections sec ON s.sectionId = sec.id
       WHERE s.sectionId = ? AND s.subjectStatus = 'active'`,
      [sectionId]
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
      name: path.basename(r.filePath)
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
  getSectionsByGradeLevel,
  getSubjectsBySection,
  getGeneratedPDFs
};