// Beat alignment based on real attack transients, rather than placing sounds at
// mathematically perfect timestamps and hoping the source audio agrees.
// All times returned are seconds relative to the full timeline.

export function detectTransients(samples, sampleRate, {
  offsetSeconds = 0, durationSeconds = samples.length / sampleRate,
  frameSeconds = 0.008, minDistanceSeconds = 0.065, maxSeconds = 720
} = {}) {
  if (!samples?.length || !Number.isFinite(sampleRate) || sampleRate <= 0) return [];
  const frameSize = Math.max(32, Math.round(sampleRate * frameSeconds));
  const startSample = Math.max(0, Math.floor(offsetSeconds * sampleRate));
  const stopSample = Math.min(samples.length, startSample + Math.floor(Math.min(maxSeconds, durationSeconds) * sampleRate));
  const count = Math.floor((stopSample - startSample) / frameSize);
  if (count < 4) return [];

  const rms = new Float32Array(count);
  const attack = new Float32Array(count);
  for (let f = 0; f < count; f++) {
    const from = startSample + f * frameSize;
    let sum = 0, high = 0, previous = samples[from] || 0;
    const stride = Math.max(1, Math.floor(frameSize / 80));
    let n = 0;
    for (let i = from; i < from + frameSize; i += stride) {
      const value = samples[i] || 0;
      const difference = value - previous;
      sum += value * value;
      high += difference * difference;
      previous = value; n++;
    }
    rms[f] = Math.sqrt(sum / Math.max(1, n));
    attack[f] = Math.sqrt(high / Math.max(1, n));
  }

  const novelty = new Float32Array(count);
  let low = rms[0], high = attack[0];
  for (let i = 1; i < count; i++) {
    const e = rms[i], h = attack[i];
    // Relative novelty compensates for varying loudness between song sections.
    const energyRise = Math.max(0, e - low) / (0.06 + low);
    const highRise = Math.max(0, h - high) / (0.06 + high);
    novelty[i] = energyRise * 0.8 + highRise * 0.2;
    low = low * 0.82 + e * 0.18;
    high = high * 0.82 + h * 0.18;
  }

  const sorted = Array.from(novelty).sort((a, b) => a - b);
  const p95 = sorted[Math.floor(count * 0.95)] || 0;
  const p70 = sorted[Math.floor(count * 0.70)] || 0;
  const threshold = Math.max(0.045, p70 * 1.7, p95 * 0.22);
  const refractory = Math.max(1, Math.round(minDistanceSeconds * sampleRate / frameSize));
  const candidates = [];
  for (let i = 2; i < count - 2; i++) {
    const value = novelty[i];
    if (value < threshold || value < novelty[i-1] || value < novelty[i+1] ||
      value < novelty[i-2] || value < novelty[i+2]) continue;
    const time = offsetSeconds + (i + 0.5) * frameSize / sampleRate;
    candidates.push({time, strength:value});
  }
  // Pick the strongest peak in each refractory interval.
  const picked = [];
  for (const candidate of candidates) {
    const last = picked[picked.length-1];
    if (last && candidate.time - last.time < refractory * frameSize / sampleRate) {
      if (candidate.strength > last.strength) picked[picked.length-1] = candidate;
    } else picked.push(candidate);
  }
  return picked;
}

export function transientsFromClip(clip, options = {}) {
  if (!clip?.buffer) return [];
  const rate = clip.buffer.sampleRate;
  const offset = Math.max(0, clip.offset || 0);
  const duration = Math.max(0, Math.min(clip.duration, clip.buffer.duration - offset));
  const samples = clip.buffer.getChannelData(0);
  const events = detectTransients(samples, rate, {
    ...options, offsetSeconds:offset, durationSeconds:duration
  });
  return events.map(event => ({
    ...event,
    time: clip.start + event.time - offset
  }));
}

function nearestPeak(peaks, target, tolerance) {
  if (!peaks.length) return null;
  let lo = 0, hi = peaks.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (peaks[mid].time < target) lo = mid+1;
    else hi = mid;
  }
  const nearby = [];
  // Look at all local candidates, not simply the closest (which may be a weak hi-hat).
  for (let k = lo - 1; k >= 0 && target - peaks[k].time <= tolerance; k--) nearby.push(peaks[k]);
  for (let k = lo; k < peaks.length && peaks[k].time - target <= tolerance; k++) nearby.push(peaks[k]);
  if (!nearby.length) return null;
  const maxStrength = Math.max(...nearby.map(p => p.strength));
  return nearby.reduce((best,p) => {
    const distance = Math.abs(p.time - target) / Math.max(0.001, tolerance);
    const quality = p.strength / (maxStrength + 1e-9);
    const score = quality * 0.7 + (1-distance) * 0.3;
    return !best || score > best.score ? { ...p, score } : best;
  }, null);
}

// Estimate a quarter-note grid origin from a collection of real attacks.
// This *only* translates the grid; it never changes BPM or audio speed.
export function estimateBeatPhase(peaks, bpm, start, end) {
  const period = 60 / Math.max(40, Math.min(250, bpm));
  const relevant = peaks.filter(p => p.time >= start && p.time < end);
  if (relevant.length < 3) return {shift:0,confidence:0};
  const max = Math.max(...relevant.map(p => p.strength));
  if (max < 1e-8) return {shift:0,confidence:0};
  let strongest = 0, bestShift = 0, scores = [];
  const sigma = Math.max(.022, Math.min(.055, period * .11));
  // Full circle search, then wrap to [-period/2, period/2).
  for (let bin = 0; bin < 48; bin++) {
    const phase = (bin / 48) * period;
    let score = 0;
    for (const p of relevant) {
      const local = ((p.time-start-phase)%period+period)%period;
      const distance = Math.min(local, period-local);
      const strength = Math.sqrt(Math.max(0,p.strength / max));
      score += strength*Math.exp(-.5*(distance/sigma)**2);
    }
    scores.push(score);
    if(score > strongest) {strongest=score;bestShift=phase>period/2?phase-period:phase;}
  }
  const mean=scores.reduce((a,b)=>a+b,0)/scores.length;
  const confidence=Math.max(0,Math.min(1,(strongest/Math.max(.001,mean)-1)/2));
  if (strongest < 1 || confidence < .13) return {shift:0,confidence:0};
  return {shift:bestShift,confidence};
}

export function alignBeatEvents(events, peaks, {
  enabled = true, toleranceMs = 105, phaseLock = true, strength = 1,
  minConfidence = .13
} = {}) {
  if (!enabled || !events?.length || !peaks?.length) {
    return {events:events || [],aligned:0,phaseShift:0,confidence:0};
  }
  const sortedPeaks = [...peaks].sort((a,b)=>a.time-b.time);
  const sortedEvents = [...events].sort((a,b)=>a.time-b.time);
  const moved = [];
  let aligned=0, phaseWeighted=0,weight=0,confidenceSum=0;
  const toleranceLimit=Math.max(.015,Math.min(.2,toleranceMs / 1000));
  // Tempo changes are separate phase domains; do not reuse a global phase across regions.
  const groups = [];
  for (const event of sortedEvents) {
    let previous=groups[groups.length-1];
    if(!previous || Math.abs(previous.bpm-event.bpm)>0.05 || event.regionId !== previous.regionId) {
      previous={bpm:event.bpm,regionId:event.regionId,events:[]};
      groups.push(previous);
    }
    previous.events.push(event);
  }
  for(const group of groups) {
    const period=60/Math.max(40,Math.min(250,group.bpm||150));
    const start=group.events[0].regionStart??group.events[0].time;
    const end=group.events[group.events.length-1].regionEnd??(group.events[group.events.length-1].time+period);
    const usablePeaks=sortedPeaks.filter(p=>p.time>=start&&p.time<end);
    const phase=phaseLock?estimateBeatPhase(usablePeaks,group.bpm,start,end):{shift:0,confidence:0};
    // Phasing relative to the region boundary also works for manual grid offsets.
    const phaseShift=(phase.confidence>=minConfidence)?phase.shift:0;
    phaseWeighted+=phaseShift*group.events.length;
    confidenceSum+=phase.confidence*group.events.length;
    weight+=group.events.length;
    for(const event of group.events) {
      const prealigned=event.time + phaseShift;
      const tolerance=Math.min(toleranceLimit,period*.33);
      const nearest=nearestPeak(usablePeaks,prealigned,tolerance);
      // A missing transient keeps a mathematically on-grid event (plus reliable global shift).
      const proposed=nearest?nearest.time:prealigned;
      const result=event.time+(proposed-event.time)*Math.max(0,Math.min(1,strength));
      if(Math.abs(result-event.time)>.003)aligned++;
      moved.push({...event,time:Math.max(0,result),transientAligned:!!nearest});
    }
  }
  return {events:moved.sort((a,b)=>a.time-b.time),aligned,phaseShift:weight?phaseWeighted/weight:0,
    confidence:weight?confidenceSum/weight:0};
}
