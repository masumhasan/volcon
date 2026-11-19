# Volume Guard

Set your volume once. Volume Guard lowers loud scenes (songs, action) and raises quiet dialogue so movies and series stay at the level you chose, with no more reaching for the volume knob.

Everything runs locally in your browser. No account, no analytics, no network requests. See [PRIVACY.md](PRIVACY.md).

## Status

Version 0.1.0 — working MVP for Chrome and Edge (Manifest V3). Not yet published to a store.

| Works                                                                                   | Does not work (yet)                                                               |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Same-origin / blob (MSE) / CORS-enabled `<video>` and `<audio>`, including iframes      | DRM-protected video (Netflix, Prime Video, Disney+, Hotstar premium…) — see below |
| Target volume, presets (Night / Normal / Cinema), reaction speed, boost/reduction caps  | Cross-origin media served without CORS headers                                    |
| Per-site "always on", pause for 15 minutes, keyboard shortcut (Alt+Shift+V), dark/light | Firefox / Safari, in-page floating widget, onboarding flow                        |

**DRM and CORS media:** browsers hand Web Audio _silence_ for these, and attaching cannot be undone. Volume Guard therefore detects them and leaves playback completely untouched (the popup says why). Supporting protected streams needs a different capture path (`chrome.tabCapture` through an offscreen document) and is the main planned next step.

## Install (development)

```bash
npm install
npm run build        # outputs dist/
```

Chrome/Edge → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `dist/`.

Open a page with a video, click the Volume Guard icon, press play. The popup shows the live source loudness, the correction being applied, and whether the page is supported. Turn on **Always on for this site** to keep it running on every visit (this asks for permission for that site only).

## Develop

```bash
npm run dev          # rebuild on change (reload the extension in chrome://extensions)
npm run check        # typecheck + lint + format check + unit tests + build
npm test             # unit tests (Vitest)
npm run e2e          # end-to-end tests (Playwright + Chromium); needs a prior build
npm run package      # zip dist/ for store upload
```

Use PowerShell or a standard terminal on Windows; Vitest misbehaves under Git Bash path conversion.

First run of the e2e tests: `npx playwright install chromium`.

## How it works

1. A content script finds `<video>`/`<audio>` elements and, once one is genuinely playing and passes a safety check, routes it through a Web Audio graph.
2. The graph measures the source loudness (K-weighted, 400 ms momentary window) and a pure controller decides the gain: fast attack when a scene gets loud, slow release when it gets quiet, dead band, slew limit, boost/reduction caps.
3. A limiter after the gain stage catches sudden peaks. Bypass restores the untouched signal path.

More detail: [docs/adr/0001-architecture.md](docs/adr/0001-architecture.md).

## Security

See [SECURITY.md](SECURITY.md). Short version: minimal permissions, per-site host access requested at runtime, no remote code, no network, all messages validated, and a fail-safe that never mutes or alters media it cannot process.

## License

Not yet chosen.
