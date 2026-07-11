# GrowEasy CSV Importer — Backend API

AI-powered backend that accepts any CSV file and intelligently maps columns to GrowEasy CRM fields using OpenRouter AI.

## Features

- **Any CSV format** — no fixed column names required
- **OpenRouter AI extraction** — semantic field mapping using an LLM
- **Batch processing** — 20 records/batch with exponential-backoff retry
- **Type-safe** — full TypeScript with strict mode
- **Production-ready** — Helmet, CORS, graceful shutdown, Docker support
- **Supports multiple AI models** through OpenRouter

---

# Quick Start

```bash
cd backend
cp .env.example .env

# Add your OpenRouter API key
OPENROUTER_API_KEY=your_openrouter_api_key

npm install
npm run dev
```

The server starts on

```
http://localhost:3001
```

---

# API Reference

## POST /api/import

Uploads a CSV file and returns AI-extracted CRM records.

### Request

```
multipart/form-data
```

Field name

```
file
```

### Response

```json
{
  "successful": [
    {
      "created_at": "2026-05-13 14:20:48",
      "name": "John Doe",
      "email": "john.doe@example.com",
      "country_code": "+91",
      "mobile_without_country_code": "9876543210",
      "company": "GrowEasy",
      "city": "Mumbai",
      "state": "Maharashtra",
      "country": "India",
      "lead_owner": "agent@groweasy.com",
      "crm_status": "GOOD_LEAD_FOLLOW_UP",
      "crm_note": "",
      "data_source": "",
      "possession_time": "",
      "description": ""
    }
  ],
  "skipped": [
    {
      "original_index": 3,
      "reason": "No email or mobile number found",
      "raw_data": {
        "Name": "Unknown",
        "Status": "Bad"
      }
    }
  ],
  "total_input": 10,
  "total_imported": 9,
  "total_skipped": 1,
  "processing_time_ms": 4231
}
```

---

## POST /api/import/preview

Parses the CSV without AI.

Returns

- Headers
- First 100 records
- Total rows
- Filename

### Request

```
multipart/form-data
```

Field

```
file
```

### Response

```json
{
  "headers": [
    "First Name",
    "Phone",
    "Email",
    "Status"
  ],
  "records": [
    {
      "First Name": "Alice",
      "Phone": "+91 9876543210"
    }
  ],
  "total_rows": 342,
  "filename": "leads_export.csv"
}
```

---

## POST /api/import/download

Downloads CRM records as CSV.

### Request

```json
{
  "successful": [
    {}
  ]
}
```

### Response

```
text/csv
```

---

## GET /health

Health endpoint.

Example

```json
{
  "status": "ok",
  "service": "groweasy-csv-importer",
  "timestamp": "...",
  "model": "meta-llama/llama-3.1-8b-instruct:free"
}
```

---

# Environment Variables

| Variable | Required | Default | Description |
|----------|----------|----------|-------------|
| OPENROUTER_API_KEY | ✅ | — | OpenRouter API Key |
| PORT | | 3001 | Server Port |
| AI_MODEL | | meta-llama/llama-3.1-8b-instruct:free | OpenRouter Model |
| BATCH_SIZE | | 20 | Records processed per batch |
| MAX_RETRIES | | 3 | Retry attempts |
| MAX_FILE_SIZE_MB | | 10 | Upload size |
| CORS_ORIGIN | | http://localhost:5173 | Allowed frontend origins |

---

# Project Structure

```
backend/

├── src/

│ ├── config/

│ │ └── index.ts

│ ├── middleware/

│ │ ├── errorHandler.ts

│ │ └── upload.ts

│ ├── routes/

│ │ └── importRoutes.ts

│ ├── services/

│ │ ├── aiExtractor.ts

│ │ └── batchProcessor.ts

│ ├── types/

│ │ └── index.ts

│ ├── utils/

│ │ ├── csvParser.ts

│ │ ├── retry.ts

│ │ ├── csvParser.test.ts

│ │ └── retry.test.ts

│ ├── constants.ts

│ ├── app.ts

│ └── server.ts

├── Dockerfile

├── package.json

├── tsconfig.json

└── .env.example
```

---

# Running Tests

```bash
npm test
```

---

# Docker

Build

```bash
docker build -t groweasy-importer-api .
```

Run

```bash
docker run -p 3001:3001 \
-e OPENROUTER_API_KEY=your_api_key \
groweasy-importer-api
```

---

# Connecting Frontend

Create

```
frontend/.env
```

or

```
.env
```

```
VITE_BACKEND_URL=http://localhost:3001
```

The frontend will automatically upload CSV files to

```
POST /api/import
```

instead of calling an AI provider directly.

---

# OpenRouter Models

You can switch models simply by changing

```
AI_MODEL
```

in your `.env`.

Examples

| Model | Speed | Cost | Notes |
|--------|--------|------|------|
| meta-llama/llama-3.1-8b-instruct:free | Fast | Free | Recommended |
| mistralai/mistral-7b-instruct:free | Fast | Free | Good quality |
| google/gemma-2-9b-it:free | Fast | Free | Stable |
| qwen/qwen-2.5-7b-instruct:free | Fast | Free | Good reasoning |
| openai/gpt-4.1-mini | Medium | Paid | Excellent |
| anthropic/claude-3.7-sonnet | Medium | Paid | Excellent |
| google/gemini-2.5-pro | Medium | Paid | Excellent |

---

# Example .env

```env
PORT=3001

OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxx

AI_MODEL=meta-llama/llama-3.1-8b-instruct:free

BATCH_SIZE=20

MAX_RETRIES=3

MAX_FILE_SIZE_MB=10

CORS_ORIGIN=http://localhost:5173
```

---

# Notes

- Supports any CSV format.
- AI automatically maps unknown column names.
- Easily switch between free and paid OpenRouter models without changing your code.
- Works locally, on Render, Railway, VPS, Docker, and other cloud platforms.