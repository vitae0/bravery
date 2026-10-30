# Bravery

**Browser-based remix workstation.** A multitrack editor with right-side Remix Lab, FL-style windows, tempo mapping, piano roll, step sequencer and professional-inspired sound tools. No desktop installation or server-side processing.

> **Status:** Early browser MVP. This is not yet a complete replacement for Audacity or a professional DAW. See the roadmap below.

## Live site

**Planned Pages URL:** https://vitae0.github.io/bravery/ (the URL is not live until GitHub Pages deployment succeeds)

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
| Flow Mode: full-screen live DJ performance with four keyboard/sample pads and a drawing canvas | Implemented (MVP) |
| Flow groove inference: after four same-pad taps, continue a learned pulse or phrase until the current detected song section ends | Implemented (heuristic; no trained AI) |
| Flow mouse gestures: draw a frequency/pan contour, hear the original synthesized sound and keep it in the saved mix | Implemented |
| Import supported audio files, including WAV and MP3 | Implemented; codec support depends on browser |
| Multi-track waveform editor | Implemented |
| Drag clips, trim both edges, split, duplicate, remove | Implemented |
| Undo and redo (40 snapshot states) | Implemented for clip edits |
| Track mute, solo, volume and pan (Mixer window) | Implemented |
| BPM grid, wheel zoom and local-tempo snapping | Implemented |
| Hardtekk / hardstyle / impact beat generator with N-beat repetition, intensity, swing and custom BPM | Implemented; aligns to grid, not guaranteed song transients |
| 86 categorized effect presets, plus editable DSP parameters and audition | Implemented; quality varies by effect |
| 14 original generated one-shots (kick, boom, snare, riser, etc.) | Implemented |
| Microphone recording | Implemented with browser permission |
| Browser-local stereo mixdown to 16-bit PCM WAV | Implemented |
| Save/reopen portable .bravery archive | Implemented |
| Clip gain, basic filters, reverb, delay, modulation | Implemented |
| Auto BPM estimation and editable per-section tempo map | Experimental onset-autocorrelation detector |
| Automatic intro/verse/chorus change-point suggestions + arrangement markers | Experimental and heuristic, label guesses need manual review |
| Floating View windows: Mixer, Tempo Map, Sections, Piano Roll, Drum Machine, Bass Lab, Noise Lab, FX, Sound Designer, Automation | Implemented |
| 16-step drum sequencer with accents, swing and pattern presets | Implemented |
| Piano Roll: draw notes, velocity, length, 4 instruments, chord/bass/arp generators | Implemented, renders synthesized audio |
| Right-click clip / effect / sample editing | Implemented |
| Periodic effect processing every N beats | Implemented; maximum 600 events per pass |
| Graphical track volume automation with timeline envelope overlay | Implemented for playback and WAV export |
| Split all clips at detected or manually set verse/chorus boundaries | Implemented; nondestructive shared audio buffers |
| Bass mastering with spectrum graph, six EQ bands, compressor, RMS target and peak ceiling | Implemented; approximate RMS, not LUFS |
| STFT spectral noise reduction with configurable quiet-frame noise profile | Implemented; clips under 120 seconds |
| Basic automatic monophonic pitch correction | Experimental |
| Pitch shifting without exact formant preservation | Experimental |
| AI stem separation and interactive spectrogram painting | Not yet implemented |
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

### Flow Mode: play first, edit later

Click **Flow Mode** in the editor toolbar. The regular editor and its controls disappear, replaced by a live performance canvas. The current song plays continuously while you work. Import audio if the session is empty, then use Play/Space to start.

- **A / S / D / F**: play kick, snare, hi-hat and impact instantly. The pads subtly adapt their sound to the song tempo and your tapping density. On the same pad, four or more taps teach Flow your timing. It continues a pulse or repeats a learned rhythmic phrase until the end of the current section, instead of globally extending the pattern into other sections.
- **Mouse or touch**: tap any quarter of the canvas for its corresponding pad, or draw a line to synthesize a real stereo gesture. Vertical height controls pitch, horizontal movement controls stereo color, and scribbling introduces noise. Repeated strokes of a similar type can form their own learned rhythm.
- **Sections / tempo**: Flow tries the existing manual markers first, otherwise estimates the song's sections and tempo locally. With no usable sections, it falls back to eight-bar phrases. These are approximate estimates, not foolproof downbeat recognition.
- **Keep the result**: every performed hit and automatically repeated hit is an ordinary Bravery audio clip on a FLOW track. Pause, seek, return to Studio, save a .bravery project or export WAV without losing the performance. Use **Clear Flow** to remove generated layers while preserving the original recording.

Timing is captured at actual key/pointer onset; the pulse model uses your taps as phase anchors. Latency depends on the browser/audio device, and complex syncopated phrases can be misinterpreted. Flow Mode is deterministic local pattern inference, not a remote generative AI service.

### Remix workflow

Open the **Remix Lab** at the right or use **View → Remix panel**. For a hardtekk rhythm, choose **Hardtekk · 4** to repeat the kick every four beats. **Timing → Auto** follows the BPM field in the editor header. **Timing → Detected tempo map** follows region-specific BPM values. The **Periodic FX** tab repeats an effect on the selected clip with adjustable repetition, effect length, wet mix, offset and intensity.

The editor's **Auto BPM** button analyzes a clip and produces independently editable tempo regions. Use **View → Tempo Map** to correct errors. Right-click on the timeline, library effects or library one-shots for fine control. The **View** menu opens movable panels including Sound Designer, Piano Roll, Drum Machine, Bass Lab, Spectral Noise Reduction, Mixer and Song Sections.

**Spike-calibrated beat placement:** The Remix Lab defaults to **Auto · waveform spikes**. Set the timing to header BPM, tempo map, or custom BPM, then select an audio reference track (Auto picks the longest substantial clip). Bravery detects local attack transients, estimates each tempo region's beat phase, and snaps generated sounds and periodic effects to nearby attacks within a configurable search radius. The detected phase never stretches or splits the original song. Choose **Strict BPM grid** to disable alignment. Weak/missing transients fall back to the BPM grid, and heavily syncopated recordings may require a manual beat offset or a different reference track.

**Multi-clip selection:** **Ctrl/Cmd+click** adds/removes individual clips, **Shift+click** selects a continuous range, **Ctrl/Cmd+Shift+click** adds a range, and **Ctrl/Cmd+A** selects all clips. Move selected clips together, duplicate, delete, split at the playhead, or apply the same effect to the whole selection. The editor preserves one undo step for each grouped operation.

The **Song Sections** window can turn detected/manual arrangement boundaries into real nondestructive clip splits. **Automation** draws track-volume envelopes and generates rhythmic pumping curves. The **Sound Designer** previews custom synthesized kicks/impacts with pitch, attack, release, saturation and filters. The **Piano Roll** writes playable notes into an editable audio track. The **Drum Machine** builds 16-step patterns repeated over multiple bars.

### Keyboard controls

- Space: play/pause (including Flow Mode)
- Flow Mode: A / S / D / F for four live pads, draw on the canvas, Escape to return to Studio
- S: split at playhead
- Delete / Backspace: delete selected clip
- Ctrl/Cmd + Z: undo
- Ctrl/Cmd + Shift + Z: redo
- Ctrl/Cmd + C / V: copy/paste clip
- Ctrl/Cmd + click: toggle selected clip
- Shift + click: select range
- Ctrl/Cmd + Shift + click: extend selection
- Ctrl/Cmd + A: select all clips

## Architecture

- **UI:** Vite + React + CSS, deployed as static files via GitHub Pages.
- **Audio:** Web Audio API (AudioContext / OfflineAudioContext), direct sample processing for destructive tools, and custom synthesized FX.
- **Portability:** JSZip portable projects. Input and processed audio stay in browser memory.
- **Privacy:** No account, API key, upload endpoint or backend needed. Google Fonts are optionally fetched for typography; system font fallback works offline.
- **Licensing:** The 14 sound generators are original procedural synthesizers in the source. No proprietary loops or external sample packs are bundled.

## Future phases

1. **Editor completeness:** timeline range selections, multi-clip grouping, fades with handles, automation lanes, live audio metering, waveform peak cache, export more formats.
2. **Audio processing:** interactive spectrogram editor, real-time effect rack, non-destructive chains, advanced formant-safe pitch tracking, studio-grade denoise and LUFS/true-peak mastering.
3. **Remix intelligence:** improved beat/downbeat confidence, transient-aligned kick placement, editable automation curves, MIDI file import/export and stem separation.
4. **Ecosystem:** properly licensed downloadable one-shot packs, import/export of user effect presets, WASM DSP and optional AudioWorklet processors, offline Progressive Web App.

Some native Audacity features, such as VST3 plugins, cannot be run directly inside an ordinary browser tab. Browser-compatible WebAssembly or AudioWorklet alternatives will be needed.

## Notes and limitations

- Large files and offline reverb/mix renders use considerable RAM. This is an early implementation, not a low-memory streaming editor.
- Only playback codecs supported by the browser are accepted.
- Imported files are not automatically uploaded. Work is lost on page reload unless a .bravery project is saved.
- Microphone capture requires a secure context (HTTPS or localhost) and user permission.
- Pitch tools use a basic granular approximation, not commercial-grade Auto-Tune or formant-preserving processing.

## Validation

Run `npm test` for tempo-grid, regional BPM, drum-sequencer and effect-catalog checks. Every GitHub Actions build runs these tests before `npm run build`. GitHub Pages publication additionally requires the repository's Pages service enabled with GitHub Actions as the source. A successful build does not imply a successful deployment.
