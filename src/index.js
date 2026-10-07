export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const systemPrompt =
      "You are JARVIS, a helpful AI assistant. Speak mainly in Sorani Kurdish unless the user requests another language. Be clear, practical and concise. For voice conversations, keep replies short and natural. Help with coding, projects, databases and general questions. Never claim that you executed code or changed a real system unless a tool actually did it.";

    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json();
        const incoming = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
        const result = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
          messages: [{ role: "system", content: systemPrompt }, ...incoming]
        });
        const response =
          result?.response ??
          result?.choices?.[0]?.message?.content ??
          "ببورە، وەڵامێک نەگەیشت.";
        return Response.json({ ok: true, response });
      } catch (e) {
        return Response.json({ ok: false, error: "AI request failed" }, { status: 500 });
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
        if (!buffer.byteLength || buffer.byteLength > 8_000_000) {
          return Response.json({ ok: false, error: "Audio too large or empty" }, { status: 400 });
        }

        const stt = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
          audio: [...new Uint8Array(buffer)],
          task: "transcribe",
          vad_filter: true,
          initial_prompt: "Sorani Kurdish conversation. کوردی سۆرانی."
        });

        const transcript =
          stt?.text ??
          stt?.transcription_info?.text ??
          "";

        if (!transcript.trim()) {
          return Response.json({ ok: false, error: "No speech detected" }, { status: 422 });
        }

        let history = [];
        try {
          const parsed = JSON.parse(typeof historyRaw === "string" ? historyRaw : "[]");
          if (Array.isArray(parsed)) history = parsed.slice(-12);
        } catch {}

        const llm = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
          messages: [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: transcript }
          ]
        });

        const response =
          llm?.response ??
          llm?.choices?.[0]?.message?.content ??
          "ببورە، وەڵامێک نەگەیشت.";

        return Response.json({ ok: true, transcript, response });
      } catch (e) {
        return Response.json(
          { ok: false, error: "Voice processing failed" },
          { status: 500 }
        );
      }
    }

    if (url.pathname === "/api/tts" && request.method === "POST") {
      try {
        const body = await request.json();
        const text = String(body?.text || "").trim().slice(0, 1800);
        if (!text) return new Response("Missing text", { status: 400 });

        const resp = await env.AI.run(
          "@cf/deepgram/aura-1",
          { text, speaker: "luna", encoding: "mp3" },
          { returnRawResponse: true }
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