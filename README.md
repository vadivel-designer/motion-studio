# Motion Studio

A local motion-design **editor** (not a video). It opens on an empty project; nothing is rendered until you click **Export**.

Stack: Vite + React + TypeScript frontend, a small local Node/Express server (filesystem + render jobs), Zustand for state, zod for project validation. No AI/API calls at runtime — editing, playback, undo/redo and saving all work offline.

## Install & run

```bash
npm install
npm run dev          # http://localhost:5173
```

- Projects are saved to `./projects/<name>.motion/` (override with `MOTION_PROJECTS_DIR`, port with `PORT`).
- Export needs **ffmpeg** in `PATH` (or set `FFMPEG_PATH`). Chromium for export comes from Playwright (`npx playwright install chromium` if it is not installed yet).
- Production-style run: `npm run build && npm start`.

### Render from the command line

```bash
npm run render -- <projectFolder> <out.mp4>
# e.g.
npm run render -- "projects/Untitled.motion" out.mp4
```

Uses exactly the same pipeline as the Export button.

### Tests

```bash
npm test             # unit (vitest) + end-to-end (Playwright, real Chromium + ffmpeg)
npm run test:unit
npm run test:e2e
npm run typecheck
```

## Editing basics

| Area | What you can do |
| --- | --- |
| **Top bar** | New, Open, Save (Ctrl+S), Settings, Export .zip / Import .zip, Export MP4, Undo/Redo. The orange dot (and `●` in the browser title) means unsaved changes. |
| **Scenes** (left) | Add, duplicate, rename, reorder, delete. Reordering re-packs scenes back-to-back in the new order. Adding a scene appends it after the last one and grows the project duration to fit. |
| **Layers** (left) | Add text / rectangle / ellipse / triangle / cursor. Reorder (buttons or drag & drop), show/hide, lock, rename, duplicate, delete. Top of the list is drawn on top. |
| **Assets** (left) | Import PNG, JPG, WebP, SVG images and TTF / OTF / WOFF2 fonts by button or drag & drop. Files are copied byte-for-byte to `assets/`. **Place** puts an image in the active scene. Imported fonts appear in the font list. |
| **Preview** | Click to select (Shift-click adds), drag to move (Shift = constrain to an axis), corner handles scale, the round handle rotates (Shift = 15° steps). Selection is shared with the timeline, layer list and properties panel. |
| **Timeline** | Scene blocks: drag to move, drag edges to change cut points (a shared boundary moves both scenes). Layer bars: drag to move, drag ends to trim. Keyframe diamonds: click to jump to it, drag to move in time. Click/drag the ruler to scrub. Zoom with −/+/slider/Fit. |
| **Properties** | Transform, opacity, typography, alignment, spacing, colour… Each animatable property has a ◆ toggle that adds/removes a keyframe at the playhead. Once a property has keyframes, changing it at another time keys it automatically. The **Keyframe easing** section appears when the playhead is on a keyframe: choose plain-language easing (constant speed, slow-in, slow-out, slow at both ends, custom curve, springy bounce) with a live curve preview. Every control has a tooltip. |
| **Playback** | Play/pause (Space), replay, loop, frame step (←/→, Shift = 10 frames), time + frame counter; any parameter change updates the preview instantly. |
| **Undo / redo** | Ctrl+Z, Ctrl+Shift+Z (or Ctrl+Y). Every edit is one step; one drag (or one text-editing session) is one step. |
| **Phase 2** | *Animation presets* (fade / slide / scale, in / out, direction, distance, delay, duration, easing) generate normal editable keyframes; applying the same effect again replaces the earlier ones. *Stagger* on a multi-selection offsets start times (forward / reverse / seeded random + interval). *Cursor layer*: draggable path points in the preview, editable point and click times, click ripple, path smoothing. |

### Save / open

`<name>.motion/` contains `project.json` (schema-validated) and `assets/`. Missing asset files show a hatched **Missing asset** placeholder in the preview with a **Relink…** button (also in the assets list and the layer properties); relinking keeps all layers pointing at the same asset. The whole project can be exported/imported as a single `.zip`.

### Export

**Export MP4** saves the project, then the server launches headless Chromium on a render-only page (no editor UI), waits for `document.fonts.ready` and all images to decode, calls `renderFrame` for every frame and pipes the frames into ffmpeg (`libx264`, `yuv420p`, CRF 16, `+faststart`). A progress bar and a cancel button are shown. If ffmpeg is missing you get an error with the install step and the exact `npm run render -- …` command.

## Architecture

- **One source of truth:** `project.json`, validated by `src/shared/schema.ts`.
- **One drawing function:** `renderFrame(project, timeSec, ctx, scale, resources)` in `src/shared/render.ts`, used by both the preview and the export page. Output depends only on `(project, time)` — no `Date.now()`, no unseeded randomness, no CSS animation, no state carried between frames — so any timestamp is directly seekable.
- Preview renders scaled to the viewport (devicePixelRatio-aware); export renders at full project resolution. Text and vector shapes are drawn directly at the target scale, never upscaled from a bitmap.
- Keyframes are layer-relative; easing of a segment is stored on the keyframe where the segment starts. Springs are mapped onto their settle time so a segment always lands exactly on its end value.
- `server/` — Express API (projects, assets, zip, export jobs) with Vite mounted as middleware, so `npm run dev` is a single process; `server/cli.ts` reuses the same server + render pipeline.

### Deviations from the brief (and why)

- **Frames are piped to ffmpeg as lossless PNG (`image2pipe`) rather than raw RGBA.** Shipping 33 MB raw 4K frames through Playwright's evaluate bridge is much slower than PNG; the result is still lossless before encoding.
- **Vite runs as Express middleware** instead of a separate dev server + proxy, so the export/CLI path serves the exact same render page from one process.
- Developed and tested on Linux (the brief targets Windows 11). Paths use `node:path` throughout, but I have not run it on Windows.

## Works (tested)

Everything below is covered by tests that passed in this repo (75 unit tests, 23 end-to-end tests).

- Interpolation: before/after/between keyframes, per-segment easing, colour interpolation, every easing type (linear, ease-in/out/in-out, cubic-bezier, spring), determinism of easing and of `renderFrame` (same `t` twice, and after seeking elsewhere, gives identical pixels; a fresh browser gives the same pixels).
- 4K output is rendered natively at 3840×2160 and matches a native 1080p render when downsampled.
- Project settings: aspect (16:9, 9:16, 1:1, 4:5, custom), resolution, fps, duration, background — changing them never deletes layers; positions/sizes are rescaled.
- Asset import (button, drag & drop, SVG, rejected types, fonts), byte-for-byte copy with SHA-256, missing-asset placeholder + Relink.
- Text and shapes; scenes (create/duplicate/rename/reorder/delete); layers panel (reorder by buttons and drag & drop, show/hide, lock, rename, duplicate, delete).
- Preview: select, move (one drag = one undo step), Shift-constrain, scale and rotate handles; selection synced with timeline and properties.
- Timeline: scrubbing, zoom, dragging scene boundaries (roll edit), layer bars (move/trim), keyframe diamonds (one drag = one undo step).
- Properties: transform, typography, alignment, spacing, colour, per-property keyframe toggle, auto-keying, easing picker with live curve preview and plain-language labels, tooltips on every control.
- Playback: Space, replay, loop, frame stepping, time + frame counter.
- Undo/redo for the edits exercised in the tests (layers, properties, keyframes, drags, settings, presets, stagger, cursor points), including history grouping (one drag = one step).
- Save → reload app → Open → deep-equal `project.json` (scenes, layers, keyframes, settings, asset refs) and assets load; zip export/import roundtrip; unsaved-changes dot/title and `beforeunload` warning.
- Export: 3-second 1080p project → MP4 (H.264, yuv420p, 30 fps, 90 frames, faststart) → first/middle/last frames compared with `renderFrame` output (mean abs difference ≈ 1.4/255; < 0.2 % of pixels differ by more than 48); the CLI produces the same video; cancel removes the partial file; missing ffmpeg shows the install step and exact CLI command.
- Phase 2: presets (all kinds/directions, replace-on-reapply, stacking, undo), stagger (forward/reverse/seeded random, idempotent), cursor layer (point drag, numeric point/click times, add/remove, smoothing, ripple).

## Not implemented

Audio, video clips, scene transitions, blur/effects, AI generation, cloud sync (out of scope for v1 — they are not referenced anywhere in the UI, so there are no dead buttons).

## Known limitations

- Not covered by an automated test (implemented and typechecked, but not exercised by the tests): keyboard shortcuts Ctrl+S / Ctrl+D / Delete / Home / End, dropping an image directly onto the preview stage, moving several selected layers at once, the 9-point pivot grid, the cursor layer inside an exported MP4 (it uses the same `renderFrame`, which is tested for other layer types).
- Scale is uniform (one `scale` value per layer); there is no separate width/height stretch for text.
- Trimming a layer's start keeps its keyframes relative to the (new) start.
- A shorter project duration leaves content past the end in place (it is simply not exported; the settings dialog warns).
- Reopening the app always starts a new empty project; use **Open** for saved work. There is no autosave.
- Fonts offered by default are common system fonts (Arial, Georgia, …). Which ones really exist depends on the machine; export uses the same machine's fonts, so preview and export agree. Import a font file for portable results.
- Export at 4K is slower than at 1080p (one lossless PNG per frame goes through the browser). I only timed 1080p exports (a 3-second clip takes a few seconds); a full 15 s 4K export has not been timed.
- The source link you added (a Substack post) could not be fetched from the cloud sandbox this was built in, so only the brief itself was used.
