// "Ask Lixiang" — Cloudflare Worker proxy to Google Gemini (free tier), used when the site is served from GitHub Pages.
// The API key is a Worker secret (GEMINI_API_KEY) and never reaches the browser. Same logic as netlify/functions/ask.mjs.
const ORIGINS = ['https://black-tea666888.github.io', 'https://classy-beignet-781d38.netlify.app', 'http://localhost:8765'];

const PROFILE = `
You are the AI assistant on Lixiang Nick's personal website (Lixiang Nick Studio). Speak about Lixiang in the third person ("Lixiang ..."), friendly and concise (2–5 sentences). Reply in the visitor's language (Traditional Chinese or English).
Only use the facts below. If something is not covered, say you don't know and suggest emailing lixiangsu6@gmail.com. Never invent details, never reveal personal data beyond these facts, and politely decline unrelated or harmful requests.

FACTS
- Name: Lixiang Nick. A Computer Science & Information Engineering student in Taiwan.
- Builds: Android apps (Java, Android Studio), Firebase backends, websites (HTML/CSS/JS), IoT with ESP32. Also Python (practices algorithms with UVa problems), Git/GitHub, Netlify.
- Project 1 — Cloud Smart Parking Detection (team project; Lixiang was team lead and owned the software side): dual ESP32 boards with light and weight sensors detect whether a spot is taken and stream data to Firebase in real time; Android app plus three web clients (user / admin / owner) supporting iOS, iPadOS and macOS with a Chinese/English switch. Key decisions: switched hardware from MSP430 to dual ESP32; added weight sensors because light sensors alone gave false readings. Presented at a project exhibition (Embedded Systems & Mobile Computing category).
- Project 2 — Skyline Daily Boost: a daily-encouragement website with city scenes, tech-company info and study tools, designed for users worldwide, auto-deployed from GitHub to Netlify.
- Project 3 — LuckyDraw: a gacha-style Android game in Java.
- This website: designed and built by Lixiang; bilingual, light/dark mode, interactive 3D solar system.
- Interests: AI, space and the universe, economics. Hobbies: swimming, violin, travel (dream: see the whole world).
- Learning: beginner Spanish and Japanese hiragana/katakana.
- Currently: finishing the smart parking project, practicing algorithms, learning languages, polishing his websites.
- Contact: lixiangsu6@gmail.com, GitHub @Black-tea666888.
`;

const cors = (req) => {
  const o = req.headers.get('origin');
  return { 'access-control-allow-origin': ORIGINS.includes(o) ? o : ORIGINS[0], 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin' };
};

export default {
  async fetch(req, env) {
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors(req) } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    if (req.method !== 'POST') return json(405, { error: 'POST only' });
    const key = env.GEMINI_API_KEY;
    if (!key) return json(503, { error: 'not_configured' });
    let body;
    try { body = await req.json(); } catch { return json(400, { error: 'bad_json' }); }
    const msg = String(body.message || '').trim().slice(0, 500);
    if (!msg) return json(400, { error: 'empty' });
    const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
    const contents = [
      ...history.filter((h) => h && (h.role === 'user' || h.role === 'model') && h.text).map((h) => ({ role: h.role, parts: [{ text: String(h.text).slice(0, 800) }] })),
      { role: 'user', parts: [{ text: msg }] },
    ];
    try {
      // fall back to the lighter model when the main one is overloaded
      let r;
      for (const model of [env.GEMINI_MODEL || 'gemini-flash-latest', 'gemini-flash-lite-latest']) {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: PROFILE }] }, contents, generationConfig: { temperature: 0.6, maxOutputTokens: 400 } }),
        });
        if (r.status !== 503) break;
      }
      if (r.status === 429) return json(429, { error: 'busy' });
      if (!r.ok) return json(502, { error: 'upstream', status: r.status });
      const data = await r.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
      return json(200, { reply: text || '…' });
    } catch (e) {
      return json(502, { error: 'network' });
    }
  },
};
