require("dotenv").config();
const express = require("express");
const fileUpload = require("express-fileupload");
const cors = require("cors");
const path = require("path");
const uploadRoutes = require("./routes/uploadRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = [
    "http://localhost:4200",
    "https://frontend-teal-beta-77.vercel.app"
];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || origin.endsWith(".vercel.app")) {
            callback(null, true);
        } else {
            callback(null, false);
        }
    },
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use((req, res, next) => {
    console.log(`[DEBUG] Incoming Request: ${req.method} ${req.url}`);
    next();
});

app.use(fileUpload({ createParentPath: true, limits: { fileSize: 20 * 1024 * 1024 }, useTempFiles: true, tempFileDir: path.join(__dirname, "tmp") }));
app.use("/download", express.static(path.join(__dirname, "generated")));
app.use("/download/requests", express.static(path.join(__dirname, "uploads", "requests")));
app.use("/api", uploadRoutes);

app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));