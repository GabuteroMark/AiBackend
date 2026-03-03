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
    getGeneratedPDFs
} = require("../controllers/uploadController");

router.post("/topic-requests", submitTopicRequest);
router.get("/topic-requests", getTopicRequests);
router.post("/topic-requests/:id/approve", approveAndGenerate);
router.post("/topic-requests/:id/reject", rejectTopicRequest);

router.get("/grade-levels", getGradeLevels);
router.get("/sections", getSectionsByGradeLevel);
router.get("/subjects", getSubjectsBySection);
router.get("/generated-pdfs/:subjectId", getGeneratedPDFs);

module.exports = router;