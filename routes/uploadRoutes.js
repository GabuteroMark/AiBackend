const express = require("express");
const router = express.Router();
const {
    submitTopicRequest,
    getTopicRequests,
    approveAndGenerate,
    rejectTopicRequest,
    getGradeLevels,
    getSectionsByGradeLevel,
    getSubjectsBySection,
    getGeneratedPDFs,
    getRequestFiles
} = require("../controllers/uploadController");

router.post("/topic-requests", submitTopicRequest);
router.get("/topic-requests", getTopicRequests);
router.get("/topic-requests/:id/files", getRequestFiles);
router.post("/topic-requests/:id/approve", approveAndGenerate);
router.post("/topic-requests/:id/reject", rejectTopicRequest);

router.get("/grade-levels", getGradeLevels);
router.get("/sections", getSectionsByGradeLevel);
router.get("/subjects", getSubjectsBySection);
router.get("/generated-pdfs/:subjectId", getGeneratedPDFs);

router.get("/ping", (req, res) => res.json({ message: "pong" }));

module.exports = router;