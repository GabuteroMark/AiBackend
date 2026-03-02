const express = require("express");
const router = express.Router();
const {
    submitTopicRequest,
    getTopicRequests,
    approveAndGenerate,
    rejectTopicRequest,
    getGradeLevels,
    getSubjectsByGrade,
    getGeneratedPDFs
} = require("../controllers/uploadController");

router.post("/topic-requests", submitTopicRequest);
router.get("/topic-requests", getTopicRequests);
router.post("/topic-requests/:id/approve", approveAndGenerate);
router.post("/topic-requests/:id/reject", rejectTopicRequest);

router.get("/grade-levels", getGradeLevels);
router.get("/subjects", getSubjectsByGrade);
router.get("/generated-pdfs/:subjectId", getGeneratedPDFs);

module.exports = router;