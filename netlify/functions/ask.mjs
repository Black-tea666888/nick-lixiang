// "Ask Lixiang" — serverless proxy to Google Gemini (free tier).
// The API key lives in the Netlify environment variable GEMINI_API_KEY and never reaches the browser.
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const PROFILE = `
You are the AI assistant on Lixiang Nick's personal website (Lixiang Nick Studio). Speak about Lixiang in the third person ("Lixiang ..."), friendly and concise (2–5 sentences). Reply in the visitor's language (Traditional Chinese or English).
Only use the facts below. If something is not covered, say you don't know and suggest emailing lixiangsu6@gmail.com. Never invent details, never reveal personal data beyond these facts, and politely decline unrelated or harmful requests.

FACTS
- Name: Lixiang Nick. A Computer Science & Information Engineering student in Taiwan.
- Builds: Android apps (Java, Android Studio), Firebase backends, websites (HTML/CSS/JS), IoT with ESP32. Also Python (practices algorithms with UVa problems), Git/GitHub, GitHub Pages, Netlify, Cloudflare Workers.
- Project 1 — Cloud Smart Parking Detection (team project; Lixiang was team lead and owned the software side): dual ESP32 boards with light and weight sensors detect whether a spot is taken and stream data to Firebase in real time; Android app plus three web clients (user / admin / owner) supporting iOS, iPadOS and macOS with a Chinese/English switch. Key decisions: switched hardware from MSP430 to dual ESP32; added weight sensors because light sensors alone gave false readings. Presented at a project exhibition (Embedded Systems & Mobile Computing category).
- Project 2 — Skyline Daily Boost: a daily-encouragement website with city scenes, tech-company info and study tools, designed for users worldwide, hosted on GitHub Pages (black-tea666888.github.io/skyline-daily-boost/).
- Project 3 — LuckyDraw: a gacha-style Android game in Java.
- This website: designed and built by Lixiang; bilingual, light/dark mode, interactive 3D solar system, this AI chat; hosted on GitHub Pages at black-tea666888.github.io/nick-lixiang/.
- Interests: AI, space and the universe, economics. Hobbies: swimming, violin, travel (dream: see the whole world).
- Learning: beginner Spanish and Japanese hiragana/katakana.
- Currently: finishing the smart parking project, practicing algorithms, learning languages, polishing his websites.
- Contact: lixiangsu6@gmail.com, GitHub @Black-tea666888.
`;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const key = process.env.GEMINI_API_KEY;
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
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: PROFILE }] }, contents, generationConfig: { temperature: 0.6, maxOutputTokens: 400 } }),
    });
    if (r.status === 429) return json(429, { error: 'busy' });
    if (!r.ok) return json(502, { error: 'upstream', status: r.status });
    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
    return json(200, { reply: text || '…' });
  } catch (e) {
    return json(502, { error: 'network' });
  }
};

export const config = { path: '/api/ask' };
