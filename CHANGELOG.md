# Changelog

All notable changes are documented here. Format based on Keep a Changelog; versions follow Semantic Versioning.

## [0.1.0] - Unreleased

### Added

- Dynamic loudness leveling: K-weighted momentary measurement, asymmetric attack/release controller, dead band, slew limit, boost/reduction caps and an output limiter.
- Content script with media discovery (incl. iframes and shadow DOM), per-element state machine and a fail-safe that leaves DRM / cross-origin-without-CORS media untouched.
- Popup (dial, presets, live meters, status, per-site "always on", pause 15 min), options page (reaction speed, boost/reduction, limiter, theme, site list, shortcut), toggle shortcut (Alt+Shift+V), dark and light themes.
- Compatibility mode (experimental): captures a blocked tab's audio with `chrome.tabCapture`, levels it in an offscreen document and plays it back. Behind optional `tabCapture`/`offscreen` permissions, offered only when a page is blocked (DRM, cross-origin without CORS, already claimed by the page).
- Manual QA and listening-test guide (`docs/qa.md`).
- Unit tests (DSP, validation, preflight, view-model) and Playwright end-to-end tests that measure real audio levelling in Chromium.
