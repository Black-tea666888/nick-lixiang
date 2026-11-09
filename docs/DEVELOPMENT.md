# Development notes

Living notes for **Lixiang Nick Studio** — how the site is built, hosted and maintained.

## Hosting

| | URL | Status |
|---|---|---|
| **Production** | https://black-tea666888.github.io/nick-lixiang/ | GitHub Pages, deploys from `main` (repo root) on every push |
| Legacy | https://classy-beignet-781d38.netlify.app | Frozen on an older build (`ae86481`); Netlify free-plan deploy credits ran out, resets 2026-11-16 |

- All asset paths are **relative**, so the site works under the `/nick-lixiang/` sub-path.
- No build step: plain HTML/CSS/JS. `index.html` holds the page, styles and most scripts; `space3d.js` is the 3D module.
- Canonical URL, Open Graph image, sitemap and JSON-LD point to the GitHub Pages URL.

## Architecture

```
Browser ── GitHub Pages (static files)
   │
   ├─ Ask Lixiang ──► Cloudflare Worker "nick-ask" ──► Google Gemini API
   │                  (nick-ask.nick-lixiang.workers.dev, secret GEMINI_API_KEY)
   ├─ Contact form ─► Web3Forms ──► lixiangsu6@gmail.com
   ├─ GitHub repos ─► api.github.com (public, client-side)
   └─ ISS position ─► api.wheretheiss.at (public, client-side, falls back to typical figures)
```

### Ask Lixiang (AI chat)

- Code: `worker/ask.js` (+ `worker/wrangler.toml`). A Netlify Function with the same logic lives in `netlify/functions/ask.mjs` for the legacy host.
- The Gemini key is a **Worker secret** (`GEMINI_API_KEY`) and never reaches the browser.
- Models: `gemini-flash-lite-latest` first (~1 s); if busy or no reply within 12 s, falls back to `gemini-flash-latest`. (`gemini-2.5-flash` is closed to new keys.)
- The assistant only answers from the `PROFILE` facts in the Worker and points visitors to email otherwise.
- CORS allows the GitHub Pages origin, the Netlify origin and `localhost:8765`.
- **After editing `worker/ask.js`, redeploy the Worker** (`npx wrangler deploy` in `worker/`) — GitHub Pages does not deploy it.
- Free-tier note: Google may use free-tier inputs to improve its products; the chat box and privacy policy say so.

### Contact form

- On GitHub Pages: Web3Forms (delivers to lixiangsu6@gmail.com). On Netlify: Netlify Forms (form detection enabled).
- Honeypot field `bot-field` blocks simple spam. `thanks.html` is the no-JavaScript fallback.

## 3D solar system (`space3d.js`)

- three.js r160 vendored in `vendor/` (MIT). Planet textures from Solar System Scope (CC BY 4.0, resized) in `tex/`.
- Featured view (half-lit planet on the right), overview, planet selector, Moon and ISS views, satellites, planetary moons, asteroid belt, comet.
- Picking checks real meshes first, then enlarged invisible hit spheres (smallest first), so the Moon/ISS are clickable next to Earth.

## Performance work (2026-11-09)

- 3D initialises early during idle time; shaders compile asynchronously. Freeze when scrolling into the space section: **472 ms → 114 ms**.
- `isNarrow()` is computed only on resize, no forced layout per frame.
- Hero particle links drawn in batched groups: JS time **396 ms → 41 ms**. Blurred glow orbs replaced with gradients.
- Pointer events coalesced to at most once per frame. Adaptive quality: a frame over 22 ms lowers resolution, then drops to 30 fps.
- Safari stutter root cause: section background canvases rendered at 2× and fully redrawn every frame on 120 Hz screens (worst: the About aurora). Now 1× (aurora 0.5×) capped at ~30 fps; hero and 3D capped at 60 fps. WebKit test: **6 fps → 30 fps** (test-environment ceiling).
- Fixed: resizing or switching theme started a duplicate background animation loop.
- Phones (coarse pointer / narrow / ≤4 cores): section backgrounds off, fewer hero particles, lower 3D resolution and object counts.

## Media and privacy

- `me.jpg` / `me.webp` and the videos in `media/` had location metadata (GPS) stripped.
- Videos re-encoded to 720p H.264 for the web; the swimming video uses original, self-composed piano music.

## To-do / notes

- [ ] Update the "Company website" sign-up field to the GitHub Pages URL if it still uses the Netlify URL.
- [ ] Decide on Netlify after 2026-11-16: unlink the repo (to stop spending credits) or keep it as a backup.
- [ ] Redeploy the Cloudflare Worker after any `worker/ask.js` change.
- [ ] Replace project illustrations with real screenshots when available.
- [ ] Optional: custom domain.
