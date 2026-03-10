const mysql = require("mysql2/promise");
require("dotenv").config();

async function exportAccounts() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || "localhost",
        user: process.env.DB_USER || "root",
        password: process.env.DB_PASSWORD || "root",
        database: process.env.DB_NAME || "crud-api-case2",
    });

    try {
        const [rows] = await pool.query("SELECT * FROM accounts");
        console.log("--- SQL INSERT STATEMENTS FOR ACCOUNTS ---");

        rows.forEach(row => {
            const columns = Object.keys(row).join(", ");
            const values = Object.values(row).map(val => {
                if (val === null) return "NULL";
                if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
                if (val instanceof Date) return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
                return val;
            }).join(", ");

            console.log(`INSERT INTO accounts (${columns}) VALUES (${values});`);
        });

    } catch (err) {
        console.error("Error:", err);
    } finally {
        await pool.end();
    }
}

exportAccounts();
