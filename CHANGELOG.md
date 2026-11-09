# Changelog

## 2026-11-10
- Production moved to **GitHub Pages**: canonical, Open Graph, sitemap and README point to `black-tea666888.github.io/nick-lixiang/`.
- Privacy policy updated for Web3Forms and the Gemini-powered chat; chat box asks visitors not to enter personal information.
- Skyline Daily Boost links point to its GitHub Pages URL; AI assistant facts updated.
- Added development notes (`docs/DEVELOPMENT.md`) and this changelog.

## 2026-11-09
- **Hosting**: Netlify deploys stopped (free-plan credits exhausted, reset 2026-11-16); site now served by GitHub Pages. Netlify form detection enabled.
- **Ask Lixiang**: AI chat using Gemini's free tier — Netlify Function first, then a Cloudflare Worker (`nick-ask`) for GitHub Pages; flash-lite with a 12 s fallback to flash.
- **Contact form**: Web3Forms on GitHub Pages, Netlify Forms on Netlify; honeypot kept.
- **Performance**: idle-time 3D init with async shaders, batched particle drawing, gradient orbs, coalesced pointer events, adaptive quality, Safari fix (1× section canvases at ~30 fps), phone low-power mode, duplicate-loop bug fixed.
- **Space**: SpaceX-style full-screen section with a real-texture 3D solar system, featured half-lit planets, planet selector, Moon and ISS views, satellites, moons, asteroid belt and comet; opens on Earth.
- **Design**: light/dark mode, hero code card and particle field, numbered sections, tech marquee, bento skills, gradient borders, giant footer wordmark, interactive backgrounds for every section.
- **Content**: turned into a personal intro site (no commercial sections); About with retouched photo, journey timeline, "now" section, hobbies (AI, space, economics, swimming, violin, travel), language learning, case study for the smart parking project, live GitHub repos, violin and swimming videos.
- **Brand & repo**: Lixiang Nick Studio name and L logo, brand kit page, privacy policy, 404 and thanks pages, English README, MIT license for code.
