export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json();
        const incoming = Array.isArray(body.messages)
          ? body.messages.slice(-20)
          : [];

        const result = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
          messages: [
            {
              role: "system",
              content:
                "You are JARVIS, a helpful AI assistant. Reply mainly in Sorani Kurdish using Kurdish Arabic script unless the user asks for another language. Be clear, practical, concise, and natural."
            },
            ...incoming
          ]
        });

        const response =
          result?.response ??
          result?.choices?.[0]?.message?.content ??
          "";

        if (!response) {
          return Response.json(
            { ok: false, error: "Empty AI response" },
            { status: 502 }
          );
        }

        return Response.json({
          ok: true,
          response
        });

      } catch (e) {
        return Response.json(
          {
            ok: false,
            error: "AI request failed",
            detail: String(e?.message || e || "Unknown error").slice(0,300)
          },
          { status: 500 }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};