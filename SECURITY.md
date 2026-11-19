# Security

## Reporting a vulnerability

Please report security issues privately by email to the maintainer (address to be added before the first public release) rather than opening a public issue. Include steps to reproduce and the browser/version. Expect an acknowledgement within a few days.

## Threat model

Volume Guard runs inside web pages that may be hostile. The main risks and the controls in place:

| Risk                                    | Control                                                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Over-broad access                       | Only `storage`, `activeTab`, `scripting`. Host access is optional and requested per site from a user gesture; it can be revoked in the options page.   |
| A page tricking the extension           | Content script runs in the isolated world and exposes nothing to the page. The service worker only accepts messages from our own extension pages.      |
| Malformed or malicious input            | Every message and all stored settings are validated at the boundary; unknown fields are dropped, numbers clamped, bad values fall back to defaults.      |
| Code injection (XSS / remote code)      | Strict extension CSP (`script-src 'self'`), no `eval`, no remote scripts, no `innerHTML` assignments (lint-enforced).                                    |
| Data exfiltration                       | No network access at all. Audio is analysed in memory and discarded. Only a hostname is used for per-site rules; no page content or titles are read.    |
| Breaking or muting playback             | Media that cannot be processed (DRM, cross-origin without CORS, already claimed by the page) is detected _before_ attaching and left untouched.         |
| Hearing damage from a bug or high boost | Boost capped (default +6 dB, hard max +12 dB), output limiter always on, slew-limited gain changes, bypass restores the original signal.                |
| Supply chain                            | Zero runtime dependencies; dev dependencies pinned exactly with a committed lockfile; `npm audit` runs in CI.                                            |

## Release checklist

- Permissions diff against the previous release (no additions without justification).
- No new network calls; CSP unchanged; bundle contains no `eval` / `new Function`.
- `npm run check` and `npm run e2e` green; `npm audit --omit=dev` clean.
- Chrome Web Store and GitHub accounts protected with two-factor authentication.
