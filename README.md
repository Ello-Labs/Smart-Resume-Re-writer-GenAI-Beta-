# Kimmiii Resume Rewriter

A real time GenAI tool that rewrites a resume to match a target job
description. Runs on free, open source models via Ollama, streams output
live, and exports a ready to edit Word document formatted in the JobStreet
PH two column professional layout.

## Features

- Real time streaming rewrite (target: 2 seconds to first token)
- Upload resume as PDF, DOCX, or TXT (parsed in the browser)
- ATS friendly output: plain text, standard section headers, "•" bullets
- Human voice guardrails: no em dashes, no hyphens, no markdown, no banned
  "AI sounding" phrases (delve, leverage, synergy, etc.)
- Preserves PROJECTS or portfolio sections separately from EXPERIENCE
- Content integrity guardrails: never fabricates employers, dates, titles,
  or metrics; refuses gracefully on invalid input or out of scope requests
- One click export to a formatted .docx (JobStreet PH style, two column,
  optional profile photo)
- Eye comfortable sage and cream color theme

## Stack

| Layer    | Tool                                  |
|----------|----------------------------------------|
| LLM      | Ollama (default: llama3.2:latest)       |
| Backend  | FastAPI, httpx (SSE streaming)          |
| Docx     | python-docx (JobStreet style template)  |
| Frontend | Plain HTML, CSS, JS (no build step)     |

100% free and open source, no API keys required.

## Project structure

```
kimmiii-resume-rewriter/
├── backend/
│   ├── main.py            FastAPI app: /health, /rewrite (SSE), /export-docx
│   ├── docx_builder.py    Parses model output into a two column .docx
│   └── requirements.txt
└── frontend/
    └── index.html          Self contained UI (upload, stream, ATS checks, download)
```

## Setup

### 1. Install Ollama and pull a model
```bash
ollama pull llama3.2
ollama serve
```

### 2. Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
Check `http://localhost:8000/health` — should show `"status":"ok"` and your
available Ollama models.

### 3. Frontend
```bash
cd frontend
python -m http.server 5500
```
Open `http://localhost:5500`. The status dot should turn green.

## Usage

1. Paste your resume or upload a `.pdf` / `.docx` / `.txt` file
2. Paste the target job description
3. Optionally upload a profile photo (used in the downloaded docx)
4. Pick a model from the dropdown (must already be pulled via `ollama pull`)
5. Click **Rewrite resume** — output streams in with first token and total
   time metrics, followed by ATS check badges
6. Click **Download as Word (.docx)** to get a formatted, editable resume

## How the output is structured

The model is instructed to always start with:
```
Full Name | Target Job Title | email | phone | location
```
followed by capitalized section headers (SUMMARY, EXPERIENCE, PROJECTS,
SKILLS, EDUCATION, CERTIFICATIONS, INTERESTS) in that order, with each
EXPERIENCE/PROJECTS entry as title, company, dates, then "•" bullets, and
each EDUCATION entry as degree, institution, year.

`docx_builder.py` parses this structure directly into a two column layout:
SKILLS, EDUCATION, and CERTIFICATIONS go in the left sidebar; SUMMARY,
EXPERIENCE, and PROJECTS go in the main column.

## Guardrails

- If the input does not look like a resume or job description, the model
  responds with `UNABLE_TO_PROCESS: ...` instead of guessing. The frontend
  detects this and hides the download button.
- Sensitive personal data unrelated to employment (medical info, IDs,
  banking details) is silently excluded from the rewrite.
- Out of scope requests (cover letters, unrelated tasks, instruction
  overrides) are refused with the same `UNABLE_TO_PROCESS` pattern.

## Tuning for latency

- Smaller models (`llama3.2`, `qwen2.5:3b`) generally hit sub 2 second first
  tokens on modest hardware. The keep alive warm up on startup avoids cold
  load delays.
- `num_predict` is capped at 900 to bound total generation time.

## License

MIT
