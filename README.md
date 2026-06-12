# Open-Source Resume Rewriter

A real-time, GenAI-powered resume rewriter that tailors your resume to a job
description — built **entirely with free, open-source tools**. No API keys,
no per-token costs, no cloud dependency.

## Stack

| Layer        | Tool                          | Why |
|--------------|-------------------------------|-----|
| LLM runtime  | [Ollama](https://ollama.com)  | Free, local inference, easy model management |
| Model        | `llama3.2:3b` (default)       | Small + fast; ~2GB, runs on CPU or modest GPU |
| Backend      | FastAPI + httpx                | Async streaming via SSE |
| Frontend     | Plain HTML/CSS/JS              | Zero build step, no framework lock-in |

## Latency strategy (target: <2s to first token)

1. **Small quantized model** — `llama3.2:3b` generates first tokens fast,
   especially on a GPU with 4-6GB VRAM, or even decent CPU-only setups.
2. **Model warm-keep** — the backend pings Ollama on startup with
   `keep_alive: 30m` so the model stays resident in memory; cold-load latency
   (which can be 5-10s+) only happens once.
3. **True token streaming** — Server-Sent Events stream each token to the
   browser as it's generated, so *perceived* latency = time-to-first-token,
   not total generation time.
4. **Bounded generation** — `num_predict: 800` caps output length so total
   time stays predictable.
5. **Lean prompt** — system + user prompt is kept tight; no extra retrieval
   or tool calls in the hot path.

### Expected performance (rough, hardware-dependent)
- GPU (RTX 3060+): first token ~200-600ms
- Apple Silicon (M1/M2/M3): first token ~400-900ms
- CPU only (modern 8-core): first token ~1-2s — try `phi3.5` or `qwen2.5:3b`
  if you're over 2s

## Setup

### 1. Install Ollama
```bash
curl -fsSL https://ollama.com/install.sh | sh
```
(or download from https://ollama.com for Mac/Windows)

### 2. Pull a model
```bash
ollama pull llama3.2:3b
```
Other options to try if you need different speed/quality tradeoffs:
```bash
ollama pull qwen2.5:3b
ollama pull phi3.5
ollama pull mistral:7b
```

### 3. Start Ollama (if not already running as a service)
```bash
ollama serve
```

### 4. Set up the backend
```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```
Backend runs at `http://localhost:8000`.
Check `http://localhost:8000/health` to confirm Ollama is reachable.

### 5. Open the frontend
Just open `frontend/index.html` in your browser
(or serve it: `python -m http.server 5500` from the `frontend/` folder).

## Usage
1. Paste your resume and the target job description.
2. Pick a model from the dropdown (must be pulled via `ollama pull`).
3. Click **Rewrite resume** — output streams live with first-token and
   total-time metrics shown.

## Project structure
```
resume-rewriter/
├── backend/
│   ├── main.py           # FastAPI app, SSE streaming endpoint
│   └── requirements.txt
├── frontend/
│   └── index.html         # Self-contained UI (no build step)
└── README.md
```

## Tuning for lower latency
- **Smaller model**: `llama3.2:1b` is even faster if quality is acceptable.
- **GPU offload**: Ollama auto-detects CUDA/Metal; ensure drivers are current.
- **Reduce `num_predict`**: shorter output = faster total time (first token
  unaffected).
- **Trim prompt**: very long resumes/JDs increase prompt-eval time before the
  first token. Consider truncating to the most relevant sections.
- **Quantization**: Ollama models are pre-quantized (Q4_K_M by default),
  which is already a good speed/quality balance.

## Notes
- All inference runs locally — your resume and job description never leave
  your machine.
- For production deployment, consider adding rate limiting, input length
  caps, and a reverse proxy (nginx) in front of FastAPI.
