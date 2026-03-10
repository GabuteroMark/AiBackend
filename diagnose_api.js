require("dotenv").config();
const fetch = (...args) => import("node-fetch").then(mod => mod.default(...args));

async function diagnose() {
    const models = ["google/gemini-2.0-flash-exp:free", "google/gemini-2.0-flash-001"];

    for (const model of models) {
        console.log(`Testing model: ${model}`);
        try {
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: "user", content: "Say hello." }],
                    max_tokens: 10
                })
            });

            if (response.ok) {
                const data = await response.json();
                console.log(`✅ ${model} works:`, data.choices[0].message.content);
            } else {
                const err = await response.text();
                console.error(`❌ ${model} failed: ${response.status}`, err);
            }
        } catch (err) {
            console.error(`❌ ${model} request error:`, err.message);
        }
    }
}

diagnose();
