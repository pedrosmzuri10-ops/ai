export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json();
        const incoming = Array.isArray(body.messages) ? body.messages.slice(-20) : [];

        const result = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
          messages: [
            {
              role: "system",
              content: "You are JARVIS, a helpful AI assistant. Speak mainly in Sorani Kurdish unless the user requests another language. Be clear, practical and concise. Help with coding, projects, databases and general questions. Never claim that you executed code or changed a real system unless a tool actually did it."
            },
            ...incoming
          ]
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

    return env.ASSETS.fetch(request);
  }
};