const mysql = require("mysql2");
require("dotenv").config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "root",
  database: process.env.DB_NAME || "crud-api-case2",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4",
  timezone: "+00:00"
});

pool.getConnection((err, connection) => {
  if (err) console.error("❌ Database connection failed:", err.message);
  else {
    console.log("✅ Connected to DB");
    connection.release();
  }
});

module.exports = pool.promise();