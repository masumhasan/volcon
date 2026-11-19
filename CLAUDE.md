# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Volume Guard is a Manifest V3 browser extension (Chrome/Edge) that levels movie/TV loudness toward a user-chosen target. Product brief and plan live one directory up (`idea.md`, `plan.md`, `identity.md`); design source is the Stitch project "Browser Extension Design" (id `589269071911317798`).

## Commands

Run these from PowerShell or a normal terminal — under Git Bash on Windows, Vitest fails with "failed to find the current suite" because of path conversion.

```bash
npm run build          # production bundle → dist/ (load dist/ unpacked in chrome://extensions)
npm run dev            # watch mode, inline sourcemaps, __DEV__ logging on
npm run typecheck      # tsc --noEmit (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes)
npm run lint           # eslint, typescript-eslint strictTypeChecked
npm run format         # prettier --write
npm test               # Vitest unit tests (tests/unit)
npx vitest run tests/unit/gain-controller.test.ts   # one test file
npx vitest run -t "pulls a loud scene"              # one test by name
npm run e2e            # Playwright; needs `npm run build` first and `npx playwright install chromium`
npm run check          # typecheck + lint + format:check + test + build
```

Set `VG_SCREENSHOT_DIR=<dir>` to make the extension e2e test save popup/options screenshots.

## Architecture

Pipeline: `content script → AudioEngine (Web Audio) → GainController (pure DSP)`, with the popup/options talking to storage and, for privileged actions, the service worker.

- `src/dsp/` — **pure** TypeScript (no DOM, no Web Audio, no clock). `loudness.ts` (K-weighted power → LUFS-like, momentary window), `gain-controller.ts` (target − source loudness, asymmetric attack/release, dead band, slew limit, boost/reduction caps, silence gate), `presets.ts` (slider→LUFS mapping 68 % = −14, presets, limiter params), `constants.ts` (every tunable with unit + rationale). Keep it pure so it stays unit-testable.
- `src/audio/engine.ts` — wires `source → K-weighting → analyser` (measures the _source_, before gain, so there is no feedback loop) and `source → gain → limiter → destination`. Runs a 50 ms `setInterval`; bypass = unity gain + transparent limiter.
- `src/content/` — injected into pages. `media-discovery` (initial scan, throttled rescan on DOM additions incl. shadow roots, captured `play` hook), `media-preflight` (pure safety check), `media-controller` (per-element state machine `idle → armed → running | blocked | error`), `audio-context` (one shared context per frame), `index.ts` (wiring, settings sync, status port).
- `src/background/index.ts` — service worker: validates messages (only from our own extension pages), injects the content script (`inject-tab`), registers/unregisters per-site persistent content scripts, toggle shortcut, badge, and drives **compatibility mode** (gets a tab-capture stream id, creates the offscreen document, forwards settings to it).
- `src/offscreen/` — compatibility mode for DRM/cross-origin media. `capture-session.ts` feeds a tab's `MediaStream` into the same `AudioEngine`; `index.ts` redeems the stream id with `getUserMedia`, owns sessions per tab, streams status to the popup over a `vg-capture:<tabId>` port (same `FrameStatus` shape as the content script) and closes itself when idle. The offscreen page has **no `chrome.storage`**, so the service worker pushes settings via `capture-config` messages. `tabCapture`/`offscreen` are *optional* permissions requested from a user gesture in the popup; the APIs do not exist until granted (feature-detect with `in chrome`).
- `src/shared/` — `settings.ts` (schema + `parseSettings` that clamps/validates everything), `settings-service.ts` (**the only module that touches `chrome.storage`**), `messages.ts` (typed messages + validators, `STATUS_PORT`, match-pattern helpers), `i18n.ts`, `logger.ts` (only place that prints; silent in production), `debounce.ts`, `result.ts`.
- `src/ui/popup`, `src/ui/options` — vanilla TS pages; `view-model.ts` holds the testable status/meter logic. Markup/CSS are static files in `public/` (tokens from the Stitch design; no CDN, fonts bundled).
- `public/` is copied to `dist/` by `scripts/build.mjs`, which also stamps the manifest version from `package.json` and copies the Inter font.

## Constraints that are easy to break

- **Attaching is irreversible.** `createMediaElementSource` can run once per element and outputs silence for DRM (`mediaKeys`) and cross-origin media without CORS. The controller must only attach after `media-preflight` passes, the element is playing with `readyState >= HAVE_FUTURE_DATA` (so DRM keys are final), and the AudioContext is actually `running`. Never suspend the shared context (it would silence attached videos). On any problem leave playback untouched; "disable" means engine bypass, not detach.
- Content script must register `chrome.runtime.onConnect` **before** its first `await` so the popup's status port connects immediately after injection.
- The popup's `saveTarget` debounce must be cancelled by anything that writes `targetPercent` (presets) and flushed on `pagehide`.
- Permissions are deliberately minimal: `storage`, `activeTab`, `scripting`, optional `http(s)://*/*` host access requested per site from a user gesture. No network, no remote code; adding a permission needs justification in the PR.
- Settings/stored data and every message are validated at the boundary; a malformed value must fall back to defaults, never throw. Offscreen commands carry `target: 'offscreen'` and are parsed by `parseOffscreenCommand`; engine configs are clamped on receipt.
- Don't use compatibility mode on a page the content script is already levelling (it would be processed twice); the popup only offers it when the page is blocked.
- Offscreen: never call the "close if idle" path when *replacing* a session (`endSession` vs `stopSession`), or the page closes itself before the new capture starts.

## Conventions

TypeScript strict; no `any`, no non-null `!`, no default exports, no `innerHTML` assignment (ESLint enforces these); `console` only via `logger`. Files kebab-case, types PascalCase, units in names (`attackMs`, `gainDb`, `targetLufs`). All user-visible strings go through `chrome.i18n` (`public/_locales/en/messages.json`; markup uses `data-i18n*` attributes). Conventional Commits.

## Testing notes

- Unit tests cover DSP, settings/message validation, preflight, view-model.
- `tests/e2e/levelling.spec.ts` runs the **real built content script** in Chromium with a faked `chrome.*` and a synthetic quiet→loud→quiet WAV, measuring the level after the limiter; it also asserts CORS/DRM media is never attached. `tests/e2e/extension.spec.ts` loads the unpacked extension (bundled Chromium, new headless), exercises the popup/options pages and checks the service worker refuses capture without the permission. `tests/e2e/capture.spec.ts` bundles the real `CaptureSession` with esbuild and levels a real `MediaStream` (`audio.captureStream()`); Chrome's actual tab-capture handoff cannot be automated.
- Not covered by automation: real streaming sites, DRM behaviour in a branded browser, the real `tabCapture` flow and its audio delay, listening quality (pumping/breathing) — verify manually using [docs/qa.md](docs/qa.md).
