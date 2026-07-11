# GrowEasy CSV Importer — Frontend

A modern React + Vite frontend for importing CSV files into GrowEasy CRM.

The frontend allows users to:

- Upload any CSV file
- Preview parsed data
- Send the CSV to the backend
- View AI-mapped CRM records
- Download the transformed CSV

The frontend never communicates directly with an AI provider. All AI processing happens securely through the backend.

---

# Features

- Upload any CSV
- CSV Preview
- AI-powered CRM field mapping
- Import progress indicator
- Results table
- Download transformed CSV
- Responsive UI
- TypeScript support
- React + Vite

---

# Tech Stack

- React
- TypeScript
- Vite
- Tailwind CSS
- Axios / Fetch API

---

# Quick Start

```bash
cd frontend

npm install

cp .env.example .env

npm run dev
```

The application starts on

```
http://localhost:5173
```

---

# Environment Variables

Create a `.env` file inside the frontend folder.

```env
VITE_BACKEND_URL=http://localhost:3001
```

If deploying,

```env
VITE_BACKEND_URL=https://your-backend-url.com
```

---

# Backend Requirement

Before starting the frontend, ensure the backend is running.

Example

```
http://localhost:3001
```

Health check

```
GET /health
```

---

# Application Flow

```
Upload CSV
      │
      ▼
Preview CSV
      │
      ▼
POST /api/import
      │
      ▼
Backend parses CSV
      │
      ▼
OpenRouter AI extracts CRM fields
      │
      ▼
Frontend receives CRM records
      │
      ▼
Display Result Table
      │
      ▼
Download CSV
```

---

# API Endpoints Used

## Preview CSV

```
POST /api/import/preview
```

Request

```
multipart/form-data

file
```

Response

```json
{
  "headers": [],
  "records": [],
  "total_rows": 0,
  "filename": ""
}
```

---

## Import CSV

```
POST /api/import
```

Request

```
multipart/form-data

file
```

Response

```json
{
  "successful": [],
  "skipped": [],
  "total_input": 0,
  "total_imported": 0,
  "total_skipped": 0,
  "processing_time_ms": 0
}
```

---

## Download CSV

```
POST /api/import/download
```

Request

```json
{
  "successful": []
}
```

Response

```
text/csv
```

---

# Folder Structure

```
frontend/

├── public/

├── src/

│   ├── assets/

│   ├── components/

│   ├── hooks/

│   ├── pages/

│   ├── services/

│   │   └── api.ts

│   ├── types/

│   ├── App.tsx

│   ├── main.tsx

│   └── index.css

├── package.json

├── vite.config.ts

├── tsconfig.json

└── .env.example
```

---

# Running

Development

```bash
npm run dev
```

Production Build

```bash
npm run build
```

Preview Production Build

```bash
npm run preview
```

---

# Deployment

The frontend can be deployed to

- Vercel
- Netlify
- GitHub Pages
- Firebase Hosting

Set

```
VITE_BACKEND_URL
```

to your deployed backend URL.

Example

```env
VITE_BACKEND_URL=https://groweasy-backend.onrender.com
```

---

# Local Development

Run backend

```bash
cd backend

npm run dev
```

Run frontend

```bash
cd frontend

npm run dev
```

Open

```
Frontend

http://localhost:5173
```

Backend

```
http://localhost:3001
```

---

# Build Commands

Frontend

```bash
npm install

npm run build
```

Backend

```bash
npm install

npm run build
```

---

# Browser Support

- Chrome
- Edge
- Firefox
- Safari

---

# License

MIT License

---

# Architecture

```
                User
                  │
                  ▼
      React + Vite Frontend
                  │
                  ▼
        Express Backend API
                  │
                  ▼
          OpenRouter API
                  │
                  ▼
           AI Model (LLM)
                  │
                  ▼
        Structured CRM Records
                  │
                  ▼
      Download CSV / Display Table
```

---

# Notes

- Supports CSV files with any column names.
- AI automatically maps CSV columns to GrowEasy CRM fields.
- No AI API keys are exposed in the browser.
- AI processing is performed securely by the backend through OpenRouter.
- Easily switch AI models by updating the `AI_MODEL` environment variable on the backend.
