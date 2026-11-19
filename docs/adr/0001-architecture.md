# ADR 0001 — Architecture and key decisions

Status: accepted (v0.1.0)

## Context

Volume Guard must keep perceived loudness near a user-chosen target while a movie plays in the browser, locally, with minimal privileges and without ever breaking playback.

## Decisions

| #   | Decision                                                                                                                       | Reason                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| D1  | Chrome + Edge, Manifest V3 first                                                                                               | One codebase, largest audience. Firefox later.                                                                                |
| D2  | Content script routes each media element through Web Audio                                                                     | No capture permission, per-element control, works offline. `tabCapture` + offscreen document is the planned fallback for DRM. |
| D3  | TypeScript strict, esbuild, Vitest, Playwright                                                                                 | Typed messaging, fast builds, real-browser tests. No framework runtime.                                                       |
| D4  | Vanilla TS popup/options with static HTML/CSS                                                                                  | Zero runtime dependencies; small bundles.                                                                                     |
| D5  | Target slider 20–100 % maps linearly to a loudness target (68 % = −14 LUFS-like, 0.25 LU per %), applied on top of the player's volume | Keeps the player's own controls working. Constants are in `src/dsp/constants.ts`.                                       |
| D6  | Zero runtime dependencies                                                                                                      | Supply-chain risk; everything needed is in the platform.                                                                      |
| D7  | Measurement loop is a 50 ms timer + `AnalyserNode`, not an `AudioWorklet`                                                      | CSP-proof (a page CSP can block worklet modules), simple; Chrome does not throttle timers on tabs playing audio.              |

## Consequences and known limits

- **No lookahead.** Delaying audio would desync it from the video, so a sudden loud cut passes through for roughly the first 100–200 ms; the limiter bounds the peak.
- **DRM / cross-origin-without-CORS media is unsupported** in this path (Web Audio receives silence). The extension detects this before attaching and leaves playback alone.
- Stereo is measured after the analyser's mono down-mix (under-reads uncorrelated stereo by up to ~3 dB). The loop is relative, so this shifts where "target" sits, not behaviour.
- The shared `AudioContext` is never suspended: once an element is attached its sound only flows while the context runs, so suspending could mute a video if resume were later refused.
- Without the `tabs` permission, tab URLs are only available after the user opens the popup (`activeTab`). Persistent per-site operation uses `optional_host_permissions` + dynamically registered content scripts.

## Alternatives considered

- `chrome.tabCapture`: handles DRM and cross-origin audio but mutes the tab and re-plays it from an offscreen document, adding latency and a per-tab user-gesture requirement. Kept as the fallback.
- `AudioWorklet` for the loop: lower main-thread cost, but CSP risk; revisit if profiling shows a need.
