function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

const MODEL = "@cf/zai-org/glm-4.7-flash";

const BASE_PROMPT = `
You are JARVIS.
Always answer in Sorani Kurdish (Central Kurdish) using Kurdish Arabic script, unless the user explicitly asks for another language.
Do not switch to Arabic, Persian, or English on your own.
Use natural everyday Sorani Kurdish.
Be clear, practical, warm, and concise.
Never claim you executed code or changed a real system unless a tool actually did it.
`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json();
        const incoming = Array.isArray(body.messages) ? body.messages.slice(-14) : [];

        const result = await env.AI.run(MODEL, {
          messages: [
            { role: "system", content: BASE_PROMPT },
            ...incoming
          ],
          max_completion_tokens: 180,
          temperature: 0.25,
          top_p: 0.85
        });

        const response =
          result?.response ??
          result?.choices?.[0]?.message?.content ??
          "ببورە، وەڵامێک نەگەیشت.";

        return Response.json({ ok: true, response });

      } catch (e) {
        return Response.json(
          {
            ok: false,
            error: "AI request failed",
            detail: String(e?.message || e || "").slice(0, 240)
          },
          { status: 500 }
        );
      }
    }

    if (url.pathname === "/api/voice-turn" && request.method === "POST") {
      try {
        const form = await request.formData();
        const file = form.get("audio");
        const historyRaw = form.get("history");

        if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
          return Response.json({ ok: false, error: "Missing audio" }, { status: 400 });
        }

        const buffer = await file.arrayBuffer();

        if (!buffer.byteLength || buffer.byteLength > 6_000_000) {
          return Response.json(
            { ok: false, error: "Audio too large or empty" },
            { status: 400 }
          );
        }

        const stt = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
          audio: arrayBufferToBase64(buffer),
          task: "transcribe",
          vad_filter: true,
          beam_size: 1,
          condition_on_previous_text: false,
          initial_prompt:
            "کوردی سۆرانی. گفتوگۆی ڕۆژانە بە کوردی سۆرانی. ناوی یاریدەدەر JARVIS ـە."
        });

        const transcript = String(stt?.text ?? "").trim();

        if (!transcript) {
          return Response.json(
            { ok: false, error: "No speech detected" },
            { status: 422 }
          );
        }

        let history = [];
        try {
          const parsed = JSON.parse(
            typeof historyRaw === "string" ? historyRaw : "[]"
          );
          if (Array.isArray(parsed)) history = parsed.slice(-8);
        } catch {}

        const voicePrompt = `
${BASE_PROMPT}
This is a live voice conversation.
Answer immediately.
Keep most answers to one or two short sentences unless the user asks for detail.
Do not add headings, bullet lists, markdown, or long introductions.
Your reply will be spoken aloud, so use simple natural Sorani Kurdish.
`;

        const llm = await env.AI.run(MODEL, {
          messages: [
            { role: "system", content: voicePrompt },
            ...history,
            { role: "user", content: transcript }
          ],
          max_completion_tokens: 90,
          temperature: 0.2,
          top_p: 0.8
        });

        const response =
          llm?.response ??
          llm?.choices?.[0]?.message?.content ??
          "ببورە، وەڵامێک نەگەیشت.";

        return Response.json({
          ok: true,
          transcript,
          response
        });

      } catch (e) {
        console.error("voice-turn failed", e);

        return Response.json(
          {
            ok: false,
            error: "Voice processing failed",
            detail: String(e?.message || e || "Unknown error").slice(0, 300)
          },
          { status: 500 }
        );
      }
    }

    // Kept as a fallback endpoint. Live mode now prefers iPhone local speech
    // because it starts faster and avoids an extra network TTS round trip.
    if (url.pathname === "/api/tts" && request.method === "POST") {
      try {
        const body = await request.json();
        const text = String(body?.text || "").trim().slice(0, 1200);

        if (!text) return new Response("Missing text", { status: 400 });

        const resp = await env.AI.run(
          "@cf/deepgram/aura-1",
          {
            text,
            speaker: "orion",
            encoding: "mp3"
          },
          {
            returnRawResponse: true
          }
        );

        return new Response(resp.body, {
          status: resp.status,
          headers: {
            "content-type": resp.headers.get("content-type") || "audio/mpeg",
            "cache-control": "no-store"
          }
        });

      } catch (e) {
        return new Response("TTS failed", { status: 500 });
      }
    }

    return env.ASSETS.fetch(request);
  }
};