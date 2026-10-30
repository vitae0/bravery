// Flow Mode: deterministic, browser-local musical intent inference.
// All functions here are pure so timing behavior can be regression tested.
export const FLOW_PADS = [
  {key:'a', kind:'kick', sound:'hard-kick', label:'KICK', hint:'Body'},
  {key:'s', kind:'snare', sound:'snare', label:'SNARE', hint:'Snap'},
  {key:'d', kind:'hat', sound:'hat', label:'HAT', hint:'Motion'},
  {key:'f', kind:'impact', sound:'boom', label:'IMPACT', hint:'Drama'}
];

export const flowClamp = (value, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(value) ? value : lo));

export function flowSectionAt(time, sections=[], bpm=150, duration=0) {
  const t = Math.max(0, time);
  const end = Math.max(0, duration);
  const match = (sections || []).find(s => Number.isFinite(s.start) && Number.isFinite(s.end) &&
    t >= s.start && t < s.end && s.end > s.start);
  if (match) return {start: match.start, end: Math.min(end, match.end), name: match.name || 'This part'};
  // With no trustworthy structural boundaries, use eight-bar musical phrases.
  const bar = 4 * 60 / flowClamp(bpm, 40, 240);
  const phrase = 8 * bar;
  const start = Math.floor(t / phrase) * phrase;
  return {start, end: Math.min(end, start + phrase), name:'Current phrase'};
}

const median = array => {
  const values=[...array].sort((a,b)=>a-b);
  const m=Math.floor(values.length/2);
  return values.length ? (values.length%2 ? values[m] : (values[m-1]+values[m])/2) : 0;
};

export function inferFlowLoop(hits, bpm, section, now, limit=256) {
  const beat=60/flowClamp(bpm,40,240);
  const recent=(hits||[]).filter(h=>Number.isFinite(h.time) &&
    h.time>=section.start-0.001 && h.time<section.end+0.001 &&
    h.time<=now+0.1).sort((a,b)=>a.time-b.time).slice(-12);
  if(recent.length<4 || section.end<=now+0.14) return {mode:'listening', events:[], confidence:0};
  const times=recent.map(h=>h.time);
  const gaps=times.slice(1).map((t,i)=>t-times[i]).filter(x=>x>0.08);
  if(gaps.length<3)return {mode:'listening',events:[],confidence:0};
  const gap=median(gaps), deviation=median(gaps.map(v=>Math.abs(v-gap)));
  // Lock into a pulse only after several comparable taps. Preserve the user's
  // phase rather than assuming the imported song begins exactly on the beat.
  const regular=deviation<=Math.max(0.065, Math.min(0.19*beat, gap*0.16))
    && gaps.filter(g=>Math.abs(g-gap)<=Math.max(0.11,0.22*gap)).length>=Math.ceil(gaps.length*0.75);
  const maxEvents=Math.max(0,Math.min(256,Math.floor(limit)));
  const events=[];
  const future=Math.max(now+0.14, times.at(-1)+0.06);
  if(regular) {
    const candidates=[.25,.5,.75,1,1.5,2,3,4,6,8].map(n=>n*beat);
    const period=candidates.reduce((best,p)=>Math.abs(p-gap)<Math.abs(best-gap)?p:best,candidates[0]);
    if(Math.abs(period-gap)<Math.max(0.085, 0.24*gap)) {
      const anchor=median(recent.slice(-5).map((h,i,arr)=>h.time-(i-(arr.length-1))*period));
      const first=Math.max(1,Math.ceil((future-anchor)/period));
      for(let k=first; events.length<maxEvents; k++){
        const at=anchor+k*period;
        if(at>=section.end-0.005)break;
        events.push({time:at,intensity:median(recent.map(h=>h.intensity??0.7))});
      }
      return {mode:'pulse',events,confidence:flowClamp(1-deviation/Math.max(gap,0.1),0,1)};
    }
  }
  // Non-uniform playing becomes a remembered 2- or 4-bar phrase. Snapping
  // happens relative to the first actual tap, not to an arbitrary phase zero.
  const span=times.at(-1)-times[0];
  const length=span<=4*beat?4*beat:8*beat;
  const anchor=times[0];
  const subdivision=beat/4;
  const offsets=[...new Set(recent.map(h=>Math.round(((h.time-anchor)%length)/subdivision)))]
    .map(n=>n*subdivision).filter(n=>n>=0 && n<length).sort((a,b)=>a-b);
  const earliestCycle=Math.max(1,Math.floor((future-anchor)/length));
  for(let cycle=earliestCycle; events.length<maxEvents; cycle++){
    const base=anchor+cycle*length;
    if(base>=section.end)break;
    for(const offset of offsets){
      const at=base+offset;
      if(at>=future && at<section.end-0.005 && events.length<maxEvents)
        events.push({time:at,intensity:median(recent.map(h=>h.intensity??0.7))});
    }
  }
  return {mode:'phrase',events,confidence:0.55};
}

export function classifyFlowGesture(points) {
  if(!points || points.length<2)return {kind:'tap',intensity:0.65};
  const start=points[0], end=points.at(-1);
  let travel=0,turns=0,prevDx=0,prevDy=0;
  for(let i=1;i<points.length;i++){
    const dx=points[i].x-points[i-1].x,dy=points[i].y-points[i-1].y;
    travel+=Math.hypot(dx,dy);
    if(i>1 && dx*prevDx+dy*prevDy<0)turns++;
    prevDx=dx;prevDy=dy;
  }
  if(travel<0.075)return {kind:'tap',intensity:0.68};
  const dy=start.y-end.y;
  const kind=turns>=3 || travel>1.45 ? 'scribble' : dy>0.19 ? 'rise' : dy<-.19 ? 'fall' : 'sweep';
  return {kind,intensity:flowClamp(0.35+travel*0.48,0.38,0.89),travel};
}

export function synthesizeFlowGesture(points, sampleRate=44100) {
  const gesture=classifyFlowGesture(points);
  if(gesture.kind==='tap')return null;
  const rate=flowClamp(sampleRate,8000,96000);
  const start=points[0].at||0,end=points.at(-1).at||start;
  const seconds=flowClamp((end-start)/1000,0.16,1.6);
  const count=Math.ceil(seconds*rate);
  const left=new Float32Array(count),right=new Float32Array(count);
  const clean=points.map(p=>({x:flowClamp(p.x,0,1),y:flowClamp(p.y,0,1),
    at:flowClamp(((p.at||start)-start)/1000,0,seconds)}));
  let at=0,phase=0,seed=58123;
  const gain=gesture.intensity*0.26;
  for(let i=0;i<count;i++){
    const t=i/rate;
    while(at<clean.length-2 && clean[at+1].at<t)at++;
    const a=clean[at],b=clean[Math.min(clean.length-1,at+1)];
    const p=flowClamp((t-a.at)/Math.max(0.000001,b.at-a.at),0,1);
    const x=a.x+(b.x-a.x)*p,y=a.y+(b.y-a.y)*p;
    const freq=70*Math.pow(27,1-y);
    phase+=2*Math.PI*freq/rate;
    seed=(Math.imul(seed,1664525)+1013904223)|0;
    const noise=(seed>>>0)/2147483648-1;
    const shape=Math.min(1,t/.014, (seconds-t)/.055);
    const v=(Math.sin(phase)+.26*Math.sin(phase*2)+
      (gesture.kind==='scribble'?.42:.08)*noise)*gain*Math.max(0,shape);
    left[i]=v*(1-.32*x);
    right[i]=v*(.68+.32*x);
  }
  return {left,right,kind:gesture.kind,intensity:gesture.intensity,duration:seconds};
}
