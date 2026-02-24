const express = require("express");
const router = express.Router();
const { uploadPDF, getGradeLevels, getSubjectsByGrade, getGeneratedPDFs } = require("../controllers/uploadController");

router.post("/upload", uploadPDF);
router.get("/grade-levels", getGradeLevels);
router.get("/subjects", getSubjectsByGrade);
router.get("/generated-pdfs/:subjectId", getGeneratedPDFs); // new route

module.exports = router;