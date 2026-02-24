# PDF Question Generator - Backend

## Setup
1. Copy `.env.example` to `.env` and fill your DB credentials.
2. Run the SQL in `schema.sql` to create the database/table.
3. Install dependencies: `npm install`
4. Start server: `npm run dev` (requires nodemon) or `npm start`

API Endpoints:
- POST /api/upload  (form-data, field name: pdf)
- GET  /api/questions
