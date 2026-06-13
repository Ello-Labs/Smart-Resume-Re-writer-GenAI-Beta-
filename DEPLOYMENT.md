# Online Deployment (v4.0.0)

This adds an **online** version alongside your existing **local** version,
without changing `backend/` or how local development works.

```
kimmiii-resume-rewriter/
├── backend/            <- UNCHANGED. Local Ollama + FastAPI. Still works exactly as before.
├── frontend/           <- UPDATED. Now auto-detects local vs online backend.
│   ├── index.html
│   └── js/
│       ├── config.js     <- decides which API to call
│       └── resume-docx.js <- client side .docx export (works everywhere)
└── cloud/
    └── worker/          <- NEW. Cloudflare Worker, calls Groq for the online version.
        ├── src/index.js
        ├── src/prompts.js
        ├── wrangler.toml
        └── package.json
```

## How "local vs online" works

`frontend/js/config.js` checks the hostname:
- `localhost` / `127.0.0.1` -> calls `http://localhost:8000` (your FastAPI + Ollama backend, unchanged)
- anything else (your Cloudflare Pages URL) -> calls your deployed Worker (Groq)

Both expose the same `/health` and `/rewrite` (SSE) contract, so the
frontend code is identical either way. The model dropdown only appears in
local mode (online mode uses a fixed Groq model).

The **docx download** now happens entirely in the browser
(`resume-docx.js`, using the `docx` npm package via CDN), so it works in
both modes without needing `backend/main.py`'s `/export-docx` endpoint.
That endpoint still exists in `backend/main.py` and still works locally if
you ever call it directly, it's just no longer required by the frontend.

---

## Step by step setup

### 0. Get a free Groq API key
Go to https://console.groq.com/keys, sign up (free), create an API key.
Groq's free tier is generous and fast, good fit for this.

### 1. Add the new files to your repo

Copy the `cloud/` folder and the updated `frontend/` folder into your repo
root, alongside your existing `backend/`. Nothing in `backend/` is touched.

### 2. Install Wrangler and log in (one time)
```bash
cd cloud/worker
npm install
npx wrangler login
```

### 3. Set the Groq API key as a Worker secret
```bash
npx wrangler secret put GROQ_API_KEY
# paste your key when prompted
```

### 4. Deploy the Worker manually once (to get its URL)
```bash
npx wrangler deploy
```
Note the printed URL, e.g.:
```
https://kimmiii-resume-rewriter-api.<your-subdomain>.workers.dev
```

### 5. Point the frontend at your Worker

Edit `frontend/js/config.js`:
```js
ONLINE_API_BASE: "https://kimmiii-resume-rewriter-api.<your-subdomain>.workers.dev",
```

### 6. Deploy the frontend to Cloudflare Pages

Dashboard method (no CLI):
1. https://dash.cloudflare.com -> Workers & Pages -> Create -> Pages -> Connect to Git
2. Select your repo
3. Build output directory: `frontend`
4. Save and deploy

You'll get a URL like `https://kimmiii-resume-rewriter.pages.dev`

### 7. Verify
Open the Pages URL. The pill next to the title should say **ONLINE**, and
the status dot should turn green. Load the sample, click Rewrite, confirm
streaming works and first token is fast (Groq is typically well under 1s).

---

## CI/CD setup (auto deploy on push)

`.github/workflows/deploy.yml` redeploys the Worker and Pages site whenever
you push changes under `cloud/` or `frontend/` to `main`. It does **not**
run for changes to `backend/` only, since that's your local only code.

### One time: add GitHub secrets
Repo Settings -> Secrets and variables -> Actions -> New repository secret:

| Secret name             | Where to get it |
|--------------------------|------------------|
| `CLOUDFLARE_API_TOKEN`    | Cloudflare dashboard -> My Profile -> API Tokens -> "Edit Cloudflare Workers" template |
| `CLOUDFLARE_ACCOUNT_ID`   | Cloudflare dashboard sidebar, any zone overview page |
| `GROQ_API_KEY`            | https://console.groq.com/keys |

After that, every push to `main` that touches `cloud/` or `frontend/`
automatically redeploys both the Worker and the Pages site.

---

## Versioning plan (Python style: 3.11, 3.12, ...)

Think of `backend/` (local) as the "stable, always works offline" track,
and the online deployment as an additive feature on top.

| Tag      | What it is |
|----------|-------------|
| `v3.0.0` | Local only. backend/ + frontend/ (server side docx export). Already pushed. |
| `v4.0.0` | Adds `cloud/` (Groq Worker) + updated `frontend/` (auto detect, client side docx). `backend/` unchanged, still fully functional offline. |

```bash
# from your repo root, after copying in the new files
git checkout -b feature/online-deploy
git add -A
git commit -m "v4: add online deployment via Cloudflare Worker + Groq, client side docx export"
git push -u origin feature/online-deploy
```

Open a PR, review, merge to `main`. Then tag the release:
```bash
git checkout main
git pull
git tag v4.0.0 -m "Online deployment (Cloudflare + Groq) alongside local Ollama version"
git push origin v4.0.0
```

Anyone cloning the repo can now:
- `git checkout v3.0.0` for the local only version, or
- `git checkout v4.0.0` (or just `main`) for local + online

Going forward, any backend/-only fixes that don't touch `cloud/` or
`frontend/` won't trigger the online deploy workflow, keeping local and
online changes decoupled.

---

## Troubleshooting

**Status pill says ONLINE but dot is red, "missing Groq API key"**
Run `npx wrangler secret put GROQ_API_KEY` again and redeploy
(`npx wrangler deploy` from `cloud/worker`).

**CORS errors**
The Worker sends `Access-Control-Allow-Origin: *`. If you still see CORS
errors, double check `ONLINE_API_BASE` in `config.js` matches the deployed
Worker URL exactly, including `https://`.

**Output looks different online vs local**
Both use the same `SYSTEM_PROMPT` (kept in sync between
`backend/main.py` and `cloud/worker/src/prompts.js`), but different models
(your local Ollama model vs Groq's `llama-3.1-8b-instant`). Output quality
and exact phrasing will vary slightly between models, that's expected. If
you want closer parity, try Groq's `llama-3.3-70b-versatile` (edit `MODEL`
in `cloud/worker/src/index.js`), at the cost of slightly higher latency.

**Docx download looks different from the local version's old export**
`resume-docx.js` is a JS port of `backend/docx_builder.py`'s layout logic.
Minor spacing differences are possible since `docx` (JS) and `python-docx`
render slightly differently, but the structure (two column, sidebar
sections, header with optional photo) is the same.
