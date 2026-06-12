"""
GenAI Resume Rewriter - Backend
Fully open-source / free stack:
  - FastAPI (web server)
  - Ollama (local LLM inference - free, no API costs)
  - Server-Sent Events (SSE) for real-time streaming

Latency strategy (target: <2s to first token):
  1. Use a small/fast quantized model (llama3.2:3b or qwen2.5:3b recommended)
  2. Stream tokens as they're generated (perceived latency, not total time)
  3. Keep the model "warm" with a background keep-alive ping
  4. Trim prompt size - only send what's needed
  5. Set num_predict cap so generation doesn't run away
"""

import json
import time
import asyncio
import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
OLLAMA_HOST = "http://localhost:11434"

# Recommended models (all free, run locally via Ollama):
#   - "llama3.2:3b"   -> fastest, great for this task, ~2GB
#   - "qwen2.5:3b"    -> fast, strong instruction following
#   - "phi3.5"        -> small, fast, good quality
#   - "mistral:7b"    -> higher quality, slightly slower
MODEL_NAME = "llama3.2:latest"

SYSTEM_PROMPT = """You are an expert resume writer and career coach.
Rewrite the provided resume to be highly tailored to the job description.

Rules:
- Preserve all factual information (dates, companies, titles, degrees) - never fabricate anything
- Reorder bullet points so the most relevant experience appears first
- Mirror keywords and phrases from the job description naturally
- Strengthen action verbs and quantify impact where the original data supports it
- Adjust the summary/objective to directly address the target role
- Keep formatting clean and professional using plain text with clear section headers
- Output ONLY the rewritten resume text, no commentary, no preamble, no markdown fences
"""

app = FastAPI(title="Open-Source Resume Rewriter")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class RewriteRequest(BaseModel):
    resume: str
    job_description: str
    model: str | None = None


# ---------------------------------------------------------------------------
# Warm-up: keep the model loaded in memory so the first real request is fast
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def warm_up_model():
    async def _ping():
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                await client.post(
                    f"{OLLAMA_HOST}/api/generate",
                    json={
                        "model": MODEL_NAME,
                        "prompt": "Hi",
                        "stream": False,
                        "keep_alive": "30m",  # keep model resident in VRAM/RAM
                        "options": {"num_predict": 1},
                    },
                )
                print(f"[startup] Warmed up model: {MODEL_NAME}")
        except Exception as e:
            print(f"[startup] Warm-up failed (is Ollama running?): {e}")

    asyncio.create_task(_ping())


@app.get("/health")
async def health():
    """Quick check that the API and Ollama are both reachable."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{OLLAMA_HOST}/api/tags")
            models = [m["name"] for m in r.json().get("models", [])]
        return {"status": "ok", "ollama": "reachable", "available_models": models}
    except Exception as e:
        return {"status": "degraded", "ollama": "unreachable", "error": str(e)}


# ---------------------------------------------------------------------------
# Core streaming endpoint
# ---------------------------------------------------------------------------
@app.post("/rewrite")
async def rewrite_resume(req: RewriteRequest):
    """
    Streams the rewritten resume back as Server-Sent Events.

    Each event is a small JSON chunk: {"token": "...", "elapsed_ms": 123}
    A final event {"done": true, "total_ms": ...} marks completion.
    """
    model = req.model or MODEL_NAME

    user_prompt = (
        f"JOB DESCRIPTION:\n{req.job_description.strip()}\n\n"
        f"CURRENT RESUME:\n{req.resume.strip()}\n\n"
        f"Rewrite the resume above to be highly tailored for this job description."
    )

    full_prompt = f"{SYSTEM_PROMPT}\n\n{user_prompt}"

    async def event_stream():
        start = time.perf_counter()
        first_token_sent = False

        payload = {
            "model": model,
            "prompt": full_prompt,
            "stream": True,
            "keep_alive": "30m",
            "options": {
                # Caps generation length -> bounds total latency
                "num_predict": 800,
                # Lower temperature = more deterministic, slightly faster convergence
                "temperature": 0.4,
                "top_p": 0.9,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream(
                    "POST", f"{OLLAMA_HOST}/api/generate", json=payload
                ) as response:
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        chunk = json.loads(line)
                        token = chunk.get("response", "")

                        if token:
                            elapsed_ms = int((time.perf_counter() - start) * 1000)
                            if not first_token_sent:
                                first_token_sent = True
                                yield f"data: {json.dumps({'first_token_ms': elapsed_ms})}\n\n"
                            yield f"data: {json.dumps({'token': token})}\n\n"

                        if chunk.get("done"):
                            total_ms = int((time.perf_counter() - start) * 1000)
                            yield f"data: {json.dumps({'done': True, 'total_ms': total_ms})}\n\n"
                            break

        except httpx.ConnectError:
            yield f"data: {json.dumps({'error': 'Cannot reach Ollama. Is it running on localhost:11434?'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
