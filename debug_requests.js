const mysql = require("mysql2/promise");
require("dotenv").config();

async function checkRequests() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || "localhost",
        user: process.env.DB_USER || "root",
        password: process.env.DB_PASSWORD || "root",
        database: process.env.DB_NAME || "crud-api-case2",
    });

    try {
        const [rows] = await pool.query("SELECT id, fileName, status, aiStatus, remarks FROM topicrequests ORDER BY id DESC LIMIT 20");
        console.log("Recent Topic Requests Status:");
        console.table(rows);
    } catch (err) {
        console.error("Error:", err);
    } finally {
        await pool.end();
    }
}

checkRequests();
