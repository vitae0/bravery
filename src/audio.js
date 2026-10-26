// Bravery's audio workbench. Processing happens locally through Web Audio.
export const SAMPLE_RATE = 44100;
export const MAX_RENDER_SECONDS = 20 * 60;

export function makeBuffer(channels, length, rate = SAMPLE_RATE) {
  return new AudioBuffer({ numberOfChannels: channels, length: Math.max(1, Math.ceil(length)), sampleRate: rate });
}

export function slicedClip(clip) {
  const rate = clip.buffer.sampleRate;
  const offset = Math.max(0, Math.min(clip.buffer.length, Math.round(clip.offset * rate)));
  const length = Math.max(1, Math.min(clip.buffer.length - offset, Math.round(clip.duration * rate)));
  const out = makeBuffer(clip.buffer.numberOfChannels, length, rate);
  for (let c = 0; c < out.numberOfChannels; c++) {
    out.copyToChannel(clip.buffer.getChannelData(c).subarray(offset, offset + length), c);
  }
  return out;
}

export function wavBlob(buffer) {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const bytes = 44 + length * channels * 2;
  const array = new ArrayBuffer(bytes);
  const view = new DataView(array);
  function str(at, word) { for (let i = 0; i < word.length; i++) view.setUint8(at + i, word.charCodeAt(i)); }
  str(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, length * channels * 2, true);
  const data = Array.from({length: channels}, (_, c) => buffer.getChannelData(c));
  let pos = 44;
  for (let i = 0; i < length; i++) for (let c = 0; c < channels; c++) {
    const v = Math.max(-1, Math.min(1, data[c][i]));
    view.setInt16(pos, v < 0 ? Math.round(v * 32768) : Math.round(v * 32767), true);
    pos += 2;
  }
  return new Blob([array], {type: 'audio/wav'});
}

export function downloadBlob(blob, fileName) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url; link.download = fileName;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function durationOf(tracks) {
  return tracks.reduce((end, t) => Math.max(end, ...t.clips.map(c => c.start + c.duration), 0), 0);
}

export function audibleTracks(tracks) {
  const anySolo = tracks.some(t => t.solo);
  return tracks.filter(t => !t.muted && (!anySolo || t.solo));
}

export function connectMixTrack(ctx, track, destination = ctx.destination, fromTime = 0, when = 0) {
  const gain = ctx.createGain();
  const points=(track.automation||[]).filter(p=>Number.isFinite(p.time)&&Number.isFinite(p.value))
    .sort((a,b)=>a.time-b.time);
  const level=(track.gain??1);
  const valueAt=(time)=>{
    if(!points.length)return 1;
    if(time<=points[0].time)return points[0].value;
    for(let i=1;i<points.length;i++)if(time<points[i].time){
      const a=points[i-1],b=points[i];
      const fraction=(time-a.time)/Math.max(0.00001,b.time-a.time);
      return a.value*(1-fraction)+b.value*fraction;
    }
    return points[points.length-1].value;
  };
  gain.gain.setValueAtTime(level*Math.max(0,valueAt(fromTime)),when);
  for(const point of points){
    if(point.time<=fromTime)continue;
    gain.gain.linearRampToValueAtTime(level*Math.max(0,point.value),when+point.time-fromTime);
  }
  const pan = ctx.createStereoPanner();
  pan.pan.value = track.pan ?? 0;
  gain.connect(pan); pan.connect(destination);
  return gain;
}

export function scheduleClips(ctx, tracks, fromTime, when, destination = ctx.destination) {
  const sources = [];
  for (const track of audibleTracks(tracks)) {
    const input = connectMixTrack(ctx, track, destination, fromTime, when);
    for (const clip of track.clips) {
      const end = clip.start + clip.duration;
      if (end <= fromTime) continue;
      const startOffset = Math.max(0, fromTime - clip.start);
      const playable = Math.min(clip.duration - startOffset, clip.buffer.duration - clip.offset - startOffset);
      if (playable <= 0) continue;
      const source = ctx.createBufferSource();
      source.buffer = clip.buffer;
      source.connect(input);
      source.start(when + Math.max(0, clip.start - fromTime), clip.offset + startOffset, playable);
      sources.push(source);
    }
  }
  return sources;
}

export async function renderMix(tracks, duration, sampleRate = SAMPLE_RATE) {
  if (duration <= 0) throw new Error('Add audio before exporting.');
  if (duration > MAX_RENDER_SECONDS) throw new Error('This export exceeds the 20-minute browser render limit.');
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  scheduleClips(ctx, tracks, 0, 0);
  return ctx.startRendering();
}

function cloneBuffer(input, channels = input.numberOfChannels) {
  const out = makeBuffer(channels, input.length, input.sampleRate);
  for (let c = 0; c < channels; c++) out.getChannelData(c).set(input.getChannelData(Math.min(c, input.numberOfChannels - 1)));
  return out;
}

function clampTransient(x){return Math.max(0,Math.min(1,x));}
function simpleProcess(input, kind, config) {
  const len = input.length, rate = input.sampleRate, ch = input.numberOfChannels;
  if (kind === 'speed') {
    const ratio = config.speed;
    const out = makeBuffer(ch, Math.ceil(len / ratio), rate);
    for (let c = 0; c < ch; c++) {
      const src = input.getChannelData(c), dst = out.getChannelData(c);
      for (let i = 0; i < dst.length; i++) {
        const ix = i * ratio, k = Math.floor(ix);
        dst[i] = (src[Math.min(k, len-1)] || 0) * (1 - (ix - k)) + (src[Math.min(k+1, len-1)] || 0) * (ix - k);
      }
    }
    return out;
  }
  if (kind === 'mono') {
    const out = makeBuffer(1, len, rate), dst = out.getChannelData(0);
    for (let c = 0; c < ch; c++) {
      const src = input.getChannelData(c);
      for (let i = 0; i < len; i++) dst[i] += src[i] / ch;
    }
    return out;
  }
  const out = cloneBuffer(input);
  let peak = 0;
  if (kind === 'normalize') {
    for (let c = 0; c < ch; c++) {
      const arr = out.getChannelData(c);
      for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(arr[i]));
    }
  }
  for (let c = 0; c < ch; c++) {
    const a = out.getChannelData(c);
    if (kind === 'reverse') { a.reverse(); continue; }
    if (kind === 'stereowiden' && ch >= 2 && c > 0) continue;
    let held = 0, gateGain = 0, fast = 0, slow = 0;
    const raw=input.getChannelData(c);
    const beatLength=Math.max(1,Math.round(rate*60/(config.bpm||150)));
    const loopLength=Math.max(1,Math.round(beatLength*(config.beats||1)));
    const repeatLength=Math.max(64,Math.floor(loopLength/Math.max(2,config.repeats||4)));
    for (let i = 0; i < len; i++) {
      if (kind === 'pump') {
        const pos=(i%loopLength)/loopLength;
        const release=Math.max(.01,config.release||.26);
        const duck=(config.depth||.65)*Math.exp(-pos/release);
        a[i] *= Math.max(0,1-duck);
      }
      if (kind === 'stutter') {
        const blockStart=Math.floor(i/loopLength)*loopLength;
        const offset=i-blockStart;
        const originalIndex=Math.min(len-1,blockStart+offset%repeatLength);
        const edge=Math.min(1,(offset%repeatLength)/32,(repeatLength-1-(offset%repeatLength))/32);
        a[i] = raw[originalIndex]*Math.max(0,edge);
      }
      if (kind === 'transient') {
        const value=Math.abs(a[i]);
        fast+=(value-fast)*.035;
        slow+=(value-slow)*.0004;
        const attack=clampTransient((fast-slow)/(slow+.02));
        const gain=1+(config.attack||0)*attack;
        const sustainGain=1+(config.sustain||0)*(1-attack);
        a[i]=Math.max(-1,Math.min(1,a[i]*gain*sustainGain));
      }
      if (kind === 'normalize' && peak > 0) a[i] *= 0.891 / peak;
      if (kind === 'gain') a[i] *= Math.pow(10, config.db / 20);
      if (kind === 'fadein') a[i] *= i / Math.max(1, len - 1);
      if (kind === 'fadeout') a[i] *= 1 - i / Math.max(1, len - 1);
      if (kind === 'bitcrush') {
        if (i % config.hold === 0) held = Math.round(a[i] * Math.pow(2, config.bits - 1)) / Math.pow(2, config.bits - 1);
        a[i] = held;
      }
      if (kind === 'gate') {
        const target = Math.abs(a[i]) >= config.threshold ? 1 : 0;
        gateGain += (target - gateGain) * (target > gateGain ? 0.02 : 0.0004);
        a[i] *= gateGain;
      }
    }
  }
  if (kind === 'stereowiden' && ch >= 2) {
    const left = out.getChannelData(0), right = out.getChannelData(1);
    const width = config.width ?? 1.6;
    for (let i = 0; i < len; i++) {
      const mid = (left[i] + right[i]) * 0.5;
      const side = (left[i] - right[i]) * 0.5 * width;
      left[i] = mid + side; right[i] = mid - side;
    }
  }
  return out;
}

function estimatePitch(input) {
  const data = input.getChannelData(0), rate = input.sampleRate;
  const size = Math.min(3072, Math.floor(data.length / 2));
  if (size < 512) return null;
  const maxOffset = Math.min(Math.floor(rate * 2), data.length - size - 1);
  let bestStart = 0, bestEnergy = -1;
  for (let start = 0; start < maxOffset; start += size) {
    let energy = 0;
    for (let i = 0; i < size; i += 4) energy += data[start+i] ** 2;
    if (energy > bestEnergy) {bestEnergy = energy; bestStart = start;}
  }
  if (bestEnergy < 0.001) return null;
  const minLag = Math.floor(rate / 850), maxLag = Math.min(Math.floor(rate / 75), size - 1);
  let bestLag = 0, bestScore = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0, e1 = 0, e2 = 0;
    for (let i = 0; i < size - lag; i += 2) {
      const a = data[bestStart + i], b = data[bestStart + i + lag];
      corr += a*b; e1 += a*a; e2 += b*b;
    }
    const score = corr / Math.sqrt(e1*e2 + 1e-12);
    if (score > bestScore) {bestScore = score; bestLag = lag;}
  }
  return bestLag && bestScore > 0.65 ? rate / bestLag : null;
}

// Grain overlap-add: good for creative pitch shifts, not formant-preserving studio tuning.
function granularPitch(input, semitones) {
  if (Math.abs(semitones) < 0.02) return cloneBuffer(input);
  const ratio = Math.pow(2, semitones / 12);
  const len = input.length, ch = input.numberOfChannels;
  const out = makeBuffer(ch, len, input.sampleRate);
  const windowSize = Math.min(4096, Math.max(512, 2 ** Math.floor(Math.log2(len / 3 || 512))));
  const hop = Math.max(1, Math.floor(windowSize / 4));
  const norm = new Float32Array(len);
  const win = new Float32Array(windowSize);
  for (let k = 0; k < windowSize; k++) win[k] = 0.5 - 0.5 * Math.cos(2 * Math.PI * k / (windowSize - 1));
  for (let start = 0; start < len; start += hop) {
    for (let k = 0; k < windowSize && start + k < len; k++) {
      const at = start + k;
      const w = win[k];
      norm[at] += w;
      const pos = Math.min(len-1, Math.max(0, start + k * ratio));
      const lo = Math.floor(pos), frac = pos - lo;
      for (let c = 0; c < ch; c++) {
        const data = input.getChannelData(c), dst = out.getChannelData(c);
        dst[at] += (data[lo] * (1-frac) + data[Math.min(lo+1,len-1)] * frac) * w;
      }
    }
  }
  for (let c = 0; c < ch; c++) {
    const dst = out.getChannelData(c);
    for (let i = 0; i < len; i++) dst[i] /= Math.max(0.001,norm[i]);
  }
  return out;
}

function impulse(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const out = ctx.createBuffer(2, len, ctx.sampleRate);
  let seed = 1234567;
  const random = () => {seed = (Math.imul(1664525,seed) + 1013904223) | 0; return (seed >>> 0) / 4294967296;};
  for (let c=0;c<2;c++) {
    const a=out.getChannelData(c);
    for(let i=0;i<len;i++) a[i]=(random()*2-1)*Math.pow(1-i/len,2.3);
  }
  return out;
}

function distortionCurve(drive) {
  const a = new Float32Array(32768);
  const n = Math.tanh(drive);
  for (let i=0;i<a.length;i++) {
    const x = (i/(a.length-1))*2-1;
    a[i] = Math.tanh(drive*x) / n;
  }
  return a;
}

async function webProcess(input, kind, config) {
  const tail = kind === 'reverb' ? config.seconds : kind === 'delay' ? Math.min(5, config.time * 7) : 0;
  const outputLength = Math.ceil(input.sampleRate * (input.duration + tail));
  if (outputLength / input.sampleRate > MAX_RENDER_SECONDS) throw new Error('Effect render is too long for the browser.');
  const ctx = new OfflineAudioContext(Math.max(2,input.numberOfChannels), outputLength, input.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = input;
  const end = ctx.destination;
  const dry = ctx.createGain(), wet = ctx.createGain();
  if (kind === 'filter' || kind === 'telephone') {
    if (kind === 'telephone') {
      const low = ctx.createBiquadFilter(), high = ctx.createBiquadFilter();
      low.type = 'highpass'; low.frequency.value = 340;
      high.type = 'lowpass'; high.frequency.value = 3300;
      source.connect(low); low.connect(high); high.connect(end);
    } else {
      const filter = ctx.createBiquadFilter();
      filter.type = config.filter;
      filter.frequency.value = Math.min(config.frequency, ctx.sampleRate/2-1);
      if (config.gain !== undefined) filter.gain.value=config.gain;
      if (config.Q !== undefined) filter.Q.value=config.Q;
      source.connect(filter); filter.connect(end);
    }
  } else if (kind === 'reverb') {
    dry.gain.value = 1 - config.wet * 0.4;
    wet.gain.value = config.wet;
    const convolver = ctx.createConvolver();
    convolver.buffer = impulse(ctx, config.seconds);
    source.connect(dry);dry.connect(end);
    source.connect(convolver);convolver.connect(wet);wet.connect(end);
  } else if (kind === 'delay') {
    dry.gain.value = 1;
    wet.gain.value = config.wet;
    const delay = ctx.createDelay(3), feedback = ctx.createGain();
    delay.delayTime.value=config.time;
    feedback.gain.value=config.feedback;
    source.connect(dry);dry.connect(end);
    source.connect(delay); delay.connect(feedback); feedback.connect(delay);
    delay.connect(wet);wet.connect(end);
  } else if (kind === 'distortion') {
    const shaper=ctx.createWaveShaper();
    shaper.curve=distortionCurve(config.drive);
    shaper.oversample='4x';
    dry.gain.value=1-config.wet;wet.gain.value=config.wet;
    source.connect(dry);dry.connect(end);
    source.connect(shaper);shaper.connect(wet);wet.connect(end);
  } else if (kind === 'compressor') {
    const compressor=ctx.createDynamicsCompressor();
    compressor.threshold.value=config.threshold;
    compressor.ratio.value=config.ratio;
    compressor.attack.value=config.attack;
    compressor.release.value=config.release;
    source.connect(compressor);compressor.connect(end);
  } else if (kind === 'chorus') {
    const delay=ctx.createDelay(0.1),lfo=ctx.createOscillator(),depth=ctx.createGain();
    delay.delayTime.value=config.base ?? 0.019;
    depth.gain.value=config.depth;
    lfo.frequency.value=config.rate; lfo.connect(depth);depth.connect(delay.delayTime);
    dry.gain.value=config.wet===1?0:1;
    wet.gain.value=config.wet;
    source.connect(dry);dry.connect(end);
    source.connect(delay);delay.connect(wet);wet.connect(end);
    lfo.start(0);
    lfo.stop(input.duration+0.1);
  } else if (kind === 'tremolo') {
    const mod=ctx.createGain(),osc=ctx.createOscillator(),depth=ctx.createGain();
    mod.gain.value=1-config.depth*0.5;
    depth.gain.value=config.depth*0.5;
    osc.frequency.value=config.rate;
    osc.connect(depth);depth.connect(mod.gain);
    source.connect(mod);mod.connect(end);
    osc.start(0);osc.stop(input.duration+0.1);
  } else if (kind === 'phaser') {
    const stages = Array.from({length:4},()=>ctx.createBiquadFilter());
    const lfo=ctx.createOscillator(),oscGain=ctx.createGain();
    lfo.frequency.value=0.45;oscGain.gain.value=580;
    lfo.connect(oscGain);
    for (const stage of stages) {
      stage.type='allpass';stage.frequency.value=850;stage.Q.value=0.75;
      oscGain.connect(stage.frequency);
    }
    stages.reduce((prev,stage)=>(prev.connect(stage),stage),source).connect(wet);
    wet.gain.value=0.65;wet.connect(end);
    dry.gain.value=0.6;source.connect(dry);dry.connect(end);
    lfo.start(0);lfo.stop(input.duration+0.1);
  } else { return cloneBuffer(input); }
  source.start(0);
  return ctx.startRendering();
}

export async function applyEffect(clip, effect) {
  const input = slicedClip(clip);
  const {kind,config} = effect;
  if (['normalize','reverse','fadein','fadeout','gain','bitcrush','gate','mono','stereowiden','speed','pump','stutter','transient'].includes(kind)) {
    return simpleProcess(input,kind,config);
  }
  if (kind === 'pitch') return granularPitch(input,config.semitones);
  if (kind === 'autopitch') {
    const hz = estimatePitch(input);
    if (!hz) throw new Error('Could not detect a stable monophonic pitch. Try an isolated vocal clip.');
    const midi = 69+12*Math.log2(hz/440);
    return granularPitch(input,Math.round(midi)-midi);
  }
  return webProcess(input,kind,config);
}

// Original, procedurally generated one-shots. No bundled third-party samples.
export function generateSound(id, rate = SAMPLE_RATE) {
  const lengths = {'hard-kick':0.7,boom:1.7,subdrop:2.2,punch:0.4,'808':2.3,snare:0.4,clap:0.45,hat:0.17,crash:2.2,riser:3.0,whoosh:1.4,downlifter:2.2,zap:0.5,vinyl:3.0};
  const seconds=lengths[id] ?? 1;
  const out=makeBuffer(2,Math.round(rate*seconds),rate);
  let seed=56133;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return ((seed>>>0)/4294967296)*2-1;};
  let phase=0,subPhase=0,prevNoise=0;
  for(let i=0;i<out.length;i++){
    const t=i/rate, u=t/seconds, n=random();
    let value=0;
    if(id==='hard-kick'||id==='boom'||id==='punch'||id==='808'){
      const punch=id==='punch',hard=id==='hard-kick',bass=id==='808';
      const f=(hard?52:bass?43:48)+(hard?230:punch?140:110)*Math.exp(-t*(hard?45:28));
      phase+=2*Math.PI*f/rate;
      value=Math.sin(phase)*Math.exp(-t*(bass?1.7:hard?6.5:punch?12:3.2));
      value+=n*Math.exp(-t*85)*0.17;
      if(hard)value=Math.tanh(value*4)*0.8;
      if(id==='boom')value+=Math.sin(2*Math.PI*33*t)*Math.exp(-t*2.7)*0.35;
    } else if(id==='subdrop'){
      const freq=90*Math.exp(-t*1.0)+26;phase+=2*Math.PI*freq/rate;
      value=Math.sin(phase)*Math.pow(1-u,1.3)*0.87;
    } else if(id==='snare'||id==='clap'||id==='hat'||id==='crash'){
      const high=n-prevNoise*0.8;prevNoise=n;
      const envelope=id==='crash'?Math.exp(-t*1.7):id==='hat'?Math.exp(-t*35):Math.exp(-t*15);
      value=high*envelope*(id==='hat'?0.36:0.6);
      if(id==='snare')value+=Math.sin(2*Math.PI*185*t)*Math.exp(-t*17)*0.23;
      if(id==='clap')value*=0.5+0.5*Math.max(0,Math.sin(2*Math.PI*35*t));
    } else if(id==='riser'||id==='whoosh'||id==='downlifter'){
      const high=n-prevNoise*0.93;prevNoise=n;
      const shape=id==='downlifter'?(1-u)*(1-u):id==='riser'?u*u:Math.sin(Math.PI*u);
      value=high*shape*0.35;
      const hz=id==='downlifter'?420*(1-u)+90:110+u*900;
      phase+=2*Math.PI*hz/rate;
      value+=Math.sin(phase)*shape*0.18;
    } else if(id==='zap'){
      phase+=2*Math.PI*(1000*Math.exp(-t*16)+110)/rate;
      value=Math.sin(phase)*Math.exp(-t*11)*0.7;
    } else if(id==='vinyl'){
      value=n*0.045+(Math.abs(n)>0.992?n*0.35:0);
    }
    const gain = (id === 'hard-kick' || id === 'boom') ? 0.8 : 1;
    const sample=Math.max(-1,Math.min(1,value*gain));
    out.getChannelData(0)[i]=sample;
    out.getChannelData(1)[i]=sample*0.985;
  }
  return out;
}

export function formatTime(seconds) {
  const secs = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(secs/60);
  return String(minutes).padStart(2,'0') + ':' + String(Math.floor(secs%60)).padStart(2,'0') + '.' + String(Math.floor((secs%1)*10));
}
