<div align="center">

<img src="favicon.svg" width="72" alt="Lixiang Nick Studio logo">

# Lixiang Nick Studio

**Personal website of Lixiang Nick**

[![Live](https://img.shields.io/badge/Live-classy--beignet--781d38.netlify.app-5eead4?style=for-the-badge&logo=netlify&logoColor=white)](https://classy-beignet-781d38.netlify.app)

[![Netlify Status](https://img.shields.io/badge/deploy-auto%20from%20main-818cf8?logo=netlify&logoColor=white)](https://classy-beignet-781d38.netlify.app)
![Lighthouse](https://img.shields.io/badge/Lighthouse-100%20%C2%B7%20100%20%C2%B7%20100%20%C2%B7%20100-5eead4?logo=lighthouse&logoColor=white)
![HTML](https://img.shields.io/badge/HTML%20%2F%20CSS%20%2F%20JS-no%20framework-e8eaf0)
![License](https://img.shields.io/badge/code-MIT-9aa1b2)

<img src="docs/preview-desktop.png" alt="Desktop preview" width="760">

</div>

---

## About

My personal website — who I am, what I've built, my skills and what I'm working on now. Designed and deployed entirely by me with plain HTML, CSS and JavaScript: no framework, no build step.

### ✨ Highlights

- 🌏 **Bilingual** — Chinese / English toggle, auto-detects the visitor's language
- 📱 **Mobile-first** — responsive layout with a dedicated mobile menu
- ⚡ **Perfect scores** — Lighthouse 100 in Performance, Accessibility, Best Practices and SEO
- ♿ **Accessible** — passes axe, keyboard-friendly, respects `prefers-reduced-motion`
- ✉️ **Contact form** — Netlify Forms with a honeypot, no backend needed
- 🪐 **3D solar system** — real planet textures, tap a planet to fly to it
- ✨ **Interactive backgrounds** — every section reacts to the cursor
- 🌗 **Light / dark mode**
- 🚀 **Continuous deployment** — every push to `main` goes live on Netlify in ~30 seconds

### 🗂 Structure

```
.
├── index.html          # Home page (all styles and scripts inline)
├── brand.html          # Brand kit: logo, colors, type, voice
├── privacy.html        # Privacy policy
├── thanks.html         # Form success page (no-JS fallback)
├── 404.html            # Not found page
├── favicon.svg         # Logo mark
├── logo-wordmark.svg   # Full logo
├── og.png              # Social share image
├── robots.txt / sitemap.xml
├── space3d.js         # Interactive 3D solar system (three.js)
├── tex/               # Planet textures (Solar System Scope, CC BY 4.0)
├── media/             # Violin and swimming videos
├── vendor/            # three.js (MIT)
├── netlify.toml        # Deploy and security headers
└── docs/               # README screenshots
```

### 🎨 Brand

| Name | Hex | Use |
|---|---|---|
| Ink | `#0B0D12` | Background |
| Mint | `#5EEAD4` | Primary |
| Indigo | `#818CF8` | Secondary |
| Paper | `#E8EAF0` | Text |

Fonts: Space Grotesk (headings), Inter (body), Noto Sans TC (Chinese). Full guide: [Brand kit](https://classy-beignet-781d38.netlify.app/brand.html).

### 🛠 Run locally

```bash
git clone https://github.com/Black-tea666888/nick-lixiang.git
cd nick-lixiang
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

### 🪐 Interactive 3D solar system

<img src="docs/preview-space.png" alt="3D solar system section" width="760">

### 🧩 Skills

<img src="docs/preview-skills.png" alt="Skills bento grid" width="760">

### 📱 Mobile

<img src="docs/preview-mobile.png" alt="Mobile preview" width="260">

### 📬 Contact

- Email: lixiangsu6@gmail.com
- GitHub: [@Black-tea666888](https://github.com/Black-tea666888)

### 📄 License

The **code** is released under the [MIT License](LICENSE). Planet textures: [Solar System Scope](https://www.solarsystemscope.com/textures/) (CC BY 4.0). 3D rendering: [three.js](https://threejs.org) (MIT). The **content** — text, logo, brand assets and project descriptions — © Lixiang Nick, all rights reserved.

<div align="center"><sub>Built with ☕ by Lixiang Nick</sub></div>
