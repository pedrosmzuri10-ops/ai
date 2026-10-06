const chat = document.getElementById("chat");
const form = document.getElementById("composer");
const input = document.getElementById("messageInput");
const statusEl = document.getElementById("status");
const clearBtn = document.getElementById("clearBtn");
const micBtn = document.getElementById("micBtn");
const hero = document.getElementById("hero");

let messages = [];
let busy = false;

function scrollBottom() {
  requestAnimationFrame(() => {
    chat.scrollTop = chat.scrollHeight;
  });
}

function hideHero() {
  if (hero) hero.style.display = "none";
}

function createMessage(role, text = "") {
  hideHero();

  const wrap = document.createElement("div");
  wrap.className = `message ${role === "user" ? "user" : "ai"}`;

  const who = document.createElement("div");
  who.className = "who";
  who.textContent = role === "user" ? "تۆ" : "JARVIS";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  wrap.append(who, bubble);
  chat.appendChild(wrap);
  scrollBottom();
  return bubble;
}

function setTyping(bubble) {
  bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
}

function extractText(obj) {
  if (!obj) return "";
  if (typeof obj === "string") return obj;

  return (
    obj.response ??
    obj.text ??
    obj.delta ??
    obj.content ??
    obj.token ??
    obj?.choices?.[0]?.delta?.content ??
    obj?.choices?.[0]?.message?.content ??
    ""
  );
}

async function streamAnswer(response, bubble) {
  const contentType = response.headers.get("content-type") || "";

  // JSON fallback
  if (contentType.includes("application/json")) {
    const data = await response.json();
    const text = extractText(data) || data.error || "وەڵامێک نەگەیشت.";
    bubble.textContent = text;
    return text;
  }

  // Streaming response (SSE or streamed text)
  if (!response.body) {
    const text = await response.text();
    bubble.textContent = text;
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalText = "";
  let sawSSE = false;

  bubble.textContent = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Process SSE line-by-line when possible
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith("data:")) {
        sawSSE = true;
        const payload = trimmed.slice(5).trim();

        if (!payload || payload === "[DONE]") continue;

        try {
          const obj = JSON.parse(payload);
          const token = extractText(obj);
          if (token) {
            finalText += token;
            bubble.textContent = finalText;
            scrollBottom();
          }
        } catch {
          finalText += payload;
          bubble.textContent = finalText;
          scrollBottom();
        }
      } else if (!sawSSE) {
        // Some Workers return plain streamed text.
        finalText += line;
        bubble.textContent = finalText;
        scrollBottom();
      }
    }
  }

  if (buffer.trim()) {
    const last = buffer.trim();
    if (last.startsWith("data:")) {
      const payload = last.slice(5).trim();
      if (payload && payload !== "[DONE]") {
        try {
          const obj = JSON.parse(payload);
          finalText += extractText(obj);
        } catch {
          finalText += payload;
        }
      }
    } else if (!sawSSE) {
      finalText += last;
    }
  }

  finalText = finalText.trim();
  bubble.textContent = finalText || "وەڵامێک نەگەیشت.";
  scrollBottom();
  return bubble.textContent;
}

async function sendMessage(text) {
  text = text.trim();
  if (!text || busy) return;

  busy = true;
  input.disabled = true;
  statusEl.textContent = "JARVIS بیر دەکاتەوە...";

  createMessage("user", text);
  messages.push({ role: "user", content: text });

  const aiBubble = createMessage("assistant");
  setTyping(aiBubble);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages })
    });

    if (!response.ok) {
      const raw = await response.text();
      throw new Error(raw || `HTTP ${response.status}`);
    }

    const answer = await streamAnswer(response, aiBubble);
    messages.push({ role: "assistant", content: answer });

    // Optional voice output
    if ("speechSynthesis" in window && answer) {
      statusEl.textContent = "JARVIS وەڵامی دا";
    }
  } catch (err) {
    console.error(err);
    aiBubble.textContent =
      "کێشەیەک لە پەیوەندی بە AI ڕوویدا. تکایە دووبارە هەوڵ بدە.";
    statusEl.textContent = "AI connection error";
  } finally {
    busy = false;
    input.disabled = false;
    input.focus();
    if (!statusEl.textContent.includes("error")) {
      setTimeout(() => (statusEl.textContent = "JARVIS ئامادەیە"), 900);
    }
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value;
  input.value = "";
  sendMessage(text);
});

document.querySelectorAll(".quick button").forEach((btn) => {
  btn.addEventListener("click", () => sendMessage(btn.dataset.prompt || ""));
});

clearBtn.addEventListener("click", () => {
  messages = [];
  chat.innerHTML = "";
  if (hero) hero.style.display = "block";
  statusEl.textContent = "گفتوگۆ پاککرایەوە";
  setTimeout(() => (statusEl.textContent = "JARVIS ئامادەیە"), 900);
});

// Voice input — depends on browser support.
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
  const recognition = new SpeechRecognition();
  recognition.lang = "ku-IQ";
  recognition.interimResults = false;
  recognition.continuous = false;

  recognition.onstart = () => {
    micBtn.classList.add("listening");
    statusEl.textContent = "گوێم لێتە...";
  };

  recognition.onresult = (event) => {
    const text = event.results?.[0]?.[0]?.transcript || "";
    if (text) sendMessage(text);
  };

  recognition.onerror = () => {
    statusEl.textContent = "نەتوانرا دەنگ بخوێندرێتەوە";
  };

  recognition.onend = () => {
    micBtn.classList.remove("listening");
    if (!busy) statusEl.textContent = "JARVIS ئامادەیە";
  };

  micBtn.addEventListener("click", () => {
    try { recognition.start(); } catch {}
  });
} else {
  micBtn.addEventListener("click", () => {
    statusEl.textContent = "Voice input لەم browser ـەدا پشتگیری ناکرێت";
  });
}
