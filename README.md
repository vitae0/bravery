# Bravery

**Browser-based audio editor and remix studio.** Edit multitrack audio, apply one-click effects, place hardstyle kicks, and export a finished mix. No desktop installation and no server-side audio processing.

> **Status:** Early browser MVP. This is not yet a complete replacement for Audacity or a professional DAW. See the roadmap below.

## Live site

**https://vitae0.github.io/bravery/**

The site requires GitHub Pages to be enabled before the first deployment succeeds:

1. Open **Settings → Pages** in this GitHub repository.
2. Under **Build and deployment**, set **Source → GitHub Actions**.
3. Open **Actions → Deploy Bravery to GitHub Pages** and select **Run workflow** if it has not already run successfully.
4. Once the deployment finishes, visit the URL above.

The workflow builds with Vite using the project-specific base path /bravery/.

## What's implemented

| Feature | Status |
| --- | --- |
| Browser-based app (React + Web Audio API) | Implemented |
| Import supported audio files, including WAV and MP3 | Implemented; codec support depends on browser |
| Multi-track waveform editor | Implemented |
| Drag clips, trim both edges, split, duplicate, remove | Implemented |
| Undo and redo (40 snapshot states) | Implemented for clip edits |
| Track mute, solo and volume | Implemented |
| BPM grid and sixteenth-note snapping | Implemented |
| Hardstyle kick overlay on BPM beats | Implemented; aligns to project grid, not actual transient detection |
| 49 one-click effects | Implemented; quality varies by effect |
| 14 original generated one-shots (kick, boom, snare, riser, etc.) | Implemented |
| Microphone recording | Implemented with browser permission |
| Browser-local stereo mixdown to 16-bit PCM WAV | Implemented |
| Save/reopen portable .bravery archive | Implemented |
| Clip gain, basic filters, reverb, delay, modulation | Implemented |
| Basic automatic monophonic pitch correction | Experimental |
| Pitch shifting without exact formant preservation | Experimental |
| Noise reduction, source separation, spectrogram editing | Not yet implemented |
| Third-party VST3 / AU plugins | Not available through native browser Web Audio |

## Getting started

Requires Node.js 22+.

~~~sh
git clone https://github.com/vitae0/bravery.git
cd bravery
npm install
npm run dev
~~~

Open the local address printed by Vite. Build locally using:

~~~sh
npm run build
npm run preview
~~~

To simulate GitHub Pages paths, build with GITHUB_PAGES=true.

## Usage

**Import audio** from the top toolbar, or drag files into the app. Click a clip, then click an effect in the left library to apply it. Effects operate on the selected clip, with undo available.

**Add one-shots** from the Sounds tab. The Hardstyle on Beats button creates a separate track with kicks positioned on the project BPM grid. Set the BPM and music alignment correctly for the kicks to land on actual song beats.

**Record** using the microphone button beside Play. Browser permission is required. Saved recordings become regular editable audio clips.

**Save project** writes a .bravery file (a ZIP archive with project.json and WAV audio assets) so it can be reopened without a server.

**Export WAV** mixes audible tracks into one stereo, 44.1 kHz, 16-bit PCM WAV. Long renders are capped at 20 minutes to limit browser memory consumption.

### Keyboard controls

- Space: play/pause
- S: split at playhead
- Delete / Backspace: delete selected clip
- Ctrl/Cmd + Z: undo
- Ctrl/Cmd + Shift + Z: redo
- Ctrl/Cmd + C / V: copy/paste clip

## Architecture

- **UI:** Vite + React + CSS, deployed as static files via GitHub Pages.
- **Audio:** Web Audio API (AudioContext / OfflineAudioContext), direct sample processing for destructive tools, and custom synthesized FX.
- **Portability:** JSZip portable projects. Input and processed audio stay in browser memory.
- **Privacy:** No account, API key, upload endpoint or backend needed. Google Fonts are optionally fetched for typography; system font fallback works offline.
- **Licensing:** The 14 sound generators are original procedural synthesizers in the source. No proprietary loops or external sample packs are bundled.

## Future phases

1. **Editor completeness:** timeline range selections, multi-clip grouping, fades with handles, automation lanes, track panning UI, audio metering, waveform peak cache, export more formats.
2. **Audio processing:** spectral visualization, real-time effect rack, non-destructive preset chains, better stretch/pitch algorithm, studio-quality auto-tune, denoise and mastering.
3. **Remix intelligence:** actual beat and downbeat detection, transient-aligned kick insertion, MIDI pattern editor, tempo mapping, remix templates.
4. **Ecosystem:** properly licensed downloadable one-shot packs, import/export of user effect presets, WASM DSP and optional AudioWorklet processors, offline Progressive Web App.

Some native Audacity features, such as VST3 plugins, cannot be run directly inside an ordinary browser tab. Browser-compatible WebAssembly or AudioWorklet alternatives will be needed.

## Notes and limitations

- Large files and offline reverb/mix renders use considerable RAM. This is an early implementation, not a low-memory streaming editor.
- Only playback codecs supported by the browser are accepted.
- Imported files are not automatically uploaded. Work is lost on page reload unless a .bravery project is saved.
- Microphone capture requires a secure context (HTTPS or localhost) and user permission.
- Pitch tools use a basic granular approximation, not commercial-grade Auto-Tune or formant-preserving processing.
