# Manual QA and listening test

Automated tests prove the maths and the safety behaviour. They cannot tell you whether it **sounds right** on real movies or whether a given site works. Do this before each release and whenever the DSP constants change. Record results in the table at the bottom.

## Setup

1. `npm run build`, then load `dist/` unpacked in Chrome (and later Edge).
2. Use headphones at a comfortable fixed system volume. Keep the player's own volume at 100 %.
3. Start at the **Normal** preset (target 68 %).

## Clips to use (use content you own or can stream legally)

| Clip                                                    | What it stresses                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| Whispered dialogue, then a sudden gunshot/explosion     | Attack speed, overshoot of the first ~150 ms, limiter              |
| A song with a loud chorus after quiet dialogue          | Pulling a long loud section down without squashing the music       |
| Quiet dialogue with background room noise               | Whether boosting raises hiss ("breathing"), gate behaviour         |
| Alternating loud/quiet every few seconds                | Pumping, whether release feels natural                             |
| Long calm dialogue (10+ minutes)                        | Stability: no drifting or slow oscillation                         |
| A scene with a sudden total silence, then dialogue      | Gate: no boost of silence, clean resume                            |

## What to listen for

- **Pumping / breathing**: volume visibly rising and falling around speech. If present, lower reaction speed or raise release in presets.
- **Squashed music**: loud scenes sound flat and lifeless. Raise the target or reduce the maximum reduction.
- **First-moment slam**: the first fraction of a second of a sudden loud cut. Expected (no lookahead); judge whether the limiter keeps it comfortable.
- **Hiss lifted in quiet scenes**: lower the maximum boost.
- **A/V sync**: lip movement vs sound. Especially in compatibility mode, check for a noticeable delay.
- **Clicks or zipper noise** when the gain changes.

## Site matrix

For each site note: popup status, whether levelling is audible, and anything odd. "Blocked" is a valid, expected result for protected video in the normal mode: playback must be completely untouched.

| Site / player                    | Normal mode | Compatibility mode | Notes |
| -------------------------------- | ----------- | ------------------ | ----- |
| YouTube                          |             |                    |       |
| Vimeo                            |             |                    |       |
| A plain HTML5 video page / file  |             |                    |       |
| Netflix                          |             |                    |       |
| Prime Video                      |             |                    |       |
| Disney+ / Hotstar                |             |                    |       |
| A site with videos in an iframe  |             |                    |       |

## Compatibility mode checklist

- [ ] Popup shows the **Compatibility mode** card only on a blocked page, and the first click prompts for the optional permission.
- [ ] After turning it on, sound continues (it must never go silent) and the status switches to a running state with a live meter.
- [ ] Turning it off, closing the tab, or reloading restores normal sound.
- [ ] Declining the permission leaves everything as it was and shows the "permission was not granted" message.
- [ ] Pause for 15 min and the master switch both bypass correction while capture stays active.
- [ ] No double-processing: do not use compatibility mode on a page that is already being levelled normally.

## Result log

| Date | Build | Browser | Clip / site | Result | Fix needed |
| ---- | ----- | ------- | ----------- | ------ | ---------- |
|      |       |         |             |        |            |
