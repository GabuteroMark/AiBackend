const { generateQuestionsWithOpenRouter } = require("./utils/ai");

async function test() {
    const sampleText = `
    The Solar System is the gravitationally bound system of the Sun and the objects that orbit it. 
    It formed 4.6 billion years ago from the gravitational collapse of a giant interstellar molecular cloud. 
    The vast majority (99.86%) of the system's mass is in the Sun, with most of the remaining mass contained in the eight planets. 
    The four inner system planets—Mercury, Venus, Earth, and Mars—are terrestrial planets, being composed primarily of rock and metal. 
    The four giant planets of the outer system are substantially larger and more massive than the terrestrials.
    `;

    console.log("Testing AI generation with sample text...");
    try {
        const questions = await generateQuestionsWithOpenRouter(sampleText);
        console.log("Generated Questions:");
        console.log(JSON.stringify(questions, null, 2));

        const isFallback = questions.some(q => q.question.includes("Fallback Question"));
        if (isFallback) {
            console.error("❌ Test Failed: Fallback questions were generated.");
        } else {
            console.log("✅ Test Passed: Relevant questions were generated.");
        }
    } catch (err) {
        console.error("❌ Test Failed with error:", err);
    }
}

test();
