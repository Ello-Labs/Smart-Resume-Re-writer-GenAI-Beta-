import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts.js";

const MODEL = "llama-3.1-8b-instant";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === "/health") {
      const hasKey = Boolean(env.GROQ_API_KEY);
      return Response.json(
        {
          status: hasKey ? "ok" : "degraded",
          runtime: "cloudflare-worker-groq",
          model: MODEL,
          groq_key_configured: hasKey,
        },
        { headers: CORS_HEADERS }
      );
    }

    if (url.pathname === "/rewrite" && request.method === "POST") {
      return handleRewrite(request, env);
    }

    return Response.json(
      { detail: "Not Found" },
      { status: 404, headers: CORS_HEADERS }
    );
  },
};

async function handleRewrite(request, env) {
  if (!env.GROQ_API_KEY) {
    return Response.json(
      { error: "GROQ_API_KEY is not configured on this Worker." },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const { resume, job_description } = body;

  if (!resume || !job_description) {
    return Response.json(
      { error: "Both 'resume' and 'job_description' are required." },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  if (resume.length > 20000 || job_description.length > 10000) {
    return Response.json(
      { error: "Input too long." },
      { status: 413, headers: CORS_HEADERS }
    );
  }

  const start = Date.now();

  const groqResponse = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      temperature: 0.4,
      top_p: 0.9,
      max_tokens: 900,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(resume, job_description) },
      ],
    }),
  });

  if (!groqResponse.ok || !groqResponse.body) {
    const errText = await groqResponse.text();
    return Response.json(
      { error: `Groq API error (${groqResponse.status}): ${errText.slice(0, 300)}` },
      { status: 502, headers: CORS_HEADERS }
    );
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  (async () => {
    let firstTokenSent = false;
    const reader = groqResponse.body.getReader();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const token = parsed.choices?.[0]?.delta?.content ?? "";
            if (token) {
              if (!firstTokenSent) {
                firstTokenSent = true;
                await writer.write(
                  encoder.encode(
                    `data: ${JSON.stringify({ first_token_ms: Date.now() - start })}\n\n`
                  )
                );
              }
              await writer.write(
                encoder.encode(`data: ${JSON.stringify({ token })}\n\n`)
              );
            }
          } catch {
            // ignore malformed partial chunks
          }
        }
      }

      await writer.write(
        encoder.encode(
          `data: ${JSON.stringify({ done: true, total_ms: Date.now() - start })}\n\n`
        )
      );
    } catch (err) {
      await writer.write(
        encoder.encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`)
      );
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
