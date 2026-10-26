import { applyEffect, makeBuffer, slicedClip, generateSound, SAMPLE_RATE } from './audio.js';

// A tempo is an attribute of a region, not necessarily of the entire song.
export function bpmAt(time, regions, fallback = 150) {
  const region = (regions || []).find(r => time >= r.start && time < r.end);
  return region?.bpm || fallback;
}
export function beatGrid(start, end, bpm, everyBeats = 1, phaseBeats = 0) {
  const beat = 60 / Math.max(20, bpm);
  const step = beat * Math.max(1, everyBeats);
  const phase = beat * phaseBeats;
  const first = Math.ceil((start - phase - 1e-7) / step);
  const result = [];
  for (let n = Math.max(0, first); phase + n * step < end - 1e-6 && result.length < 1500; n++) {
    result.push(phase + n * step);
  }
  return result;
}
export function timelineBeats(start, end, {source = 'project', bpm = 150, customBpm = 150, regions = [], every = 4, offset = 0} = {}) {
  if (end <= start) return [];
  const segments = source === 'map' && regions?.length
    ? [...regions].filter(r => r.end > start && r.start < end).sort((a, b) => a.start - b.start)
    : [{start:0, end, bpm:source==='custom'?customBpm:bpm}];
  const events = [];
  for (const s of segments) {
    const b = 60 / Math.max(40, Math.min(250,s.bpm||bpm));
    const cycle = b * Math.max(1,every);
    const begin = Math.max(start,s.start), finish = Math.min(end,s.end);
    const phase = s.start + offset*b;
    const n0 = Math.max(0,Math.ceil((begin-phase-1e-7)/cycle));
    for (let n=n0; n<4000; n++){
      const t = phase+n*cycle;
      if (t>=finish-1e-6)break;
      events.push({time:t, bpm:s.bpm || bpm, beatIndex:n*Math.max(1,every)});
      if(events.length>=1200)return events;
    }
  }
  return events.sort((a,b)=>a.time-b.time);
}

function monoSignal(buffer, limitSeconds = 180) {
  const rate=buffer.sampleRate;
  const sampleEvery=Math.max(1,Math.floor(rate/11025));
  const length=Math.min(buffer.length, Math.floor(rate*limitSeconds));
  const raw=buffer.getChannelData(0), right=buffer.numberOfChannels>1?buffer.getChannelData(1):null;
  const out=new Float32Array(Math.ceil(length/sampleEvery));
  for(let i=0;i<out.length;i++){
    const k=i*sampleEvery;
    out[i]=right ? 0.5*(raw[k]+right[k]):raw[k];
  }
  return {audio:out,rate:rate/sampleEvery};
}
function onsetEnvelope(buffer,maxSeconds=180) {
  const {audio,rate}=monoSignal(buffer,maxSeconds);
  // Two-band approximate spectral flux from rectified energy & high-passed motion.
  const hop=256,window=1024;
  const count=Math.max(1,Math.floor((audio.length-window)/hop)+1);
  const flux=new Float64Array(count);
  let previousEnergy=0, previousHigh=0;
  for(let frame=0;frame<count;frame++){
    let energy=0,high=0,prev=0;
    const from=frame*hop;
    for(let k=0;k<window;k+=4){
      const x=audio[from+k]||0;
      energy+=x*x;
      const d=x-prev;high+=d*d;prev=x;
    }
    const e=Math.sqrt(energy/window),h=Math.sqrt(high/window);
    flux[frame]=Math.max(0,e-previousEnergy)*0.75+Math.max(0,h-previousHigh)*0.25;
    previousEnergy=e;previousHigh=h;
  }
  const smooth=new Float64Array(count);
  for(let i=0;i<count;i++){
    let avg=0,n=0;
    for(let d=-13;d<=13;d++){if(i+d>=0&&i+d<count){avg+=flux[i+d];n++;}}
    smooth[i]=Math.max(0,flux[i]-avg/n*0.7);
  }
  return {values:smooth, fps:rate/hop, duration:audio.length/rate};
}
function bpmFromEnvelope(env,start=0,end=env.values.length) {
  const {values,fps}=env;
  const a=Math.max(0,Math.floor(start)),b=Math.min(values.length,Math.ceil(end));
  if(b-a<fps*3)return {bpm:null,confidence:0};
  let bestBpm=120,best=-Infinity,second=-Infinity;
  const scores=[];
  for(let bpm=55;bpm<=245;bpm+=0.5){
    const lag=fps*60/bpm;
    let corr=0,norm=0;
    for(let i=a;i+lag*2+1<b;i+=2){
      const x=values[i],ind=i+lag|0,t=i+lag-ind;
      const y=values[ind]*(1-t)+values[ind+1]*t;
      const ind2=i+2*lag|0,v=i+2*lag-ind2;
      const z=(values[ind2]||0)*(1-v)+(values[ind2+1]||0)*v;
      corr+=x*(y+0.45*z);
      norm+=x*x;
    }
    const score=corr/(norm+1e-9);
    scores.push([bpm,score]);
    if(score>best){second=best;best=score;bestBpm=bpm;}
    else if(score>second)second=score;
  }
  // Refine to BPM integers and favor stable, broadly supported peaks.
  const neighborhood=scores.filter(x=>Math.abs(x[0]-bestBpm)>2);
  neighborhood.sort((a,b)=>b[1]-a[1]);
  const rival=neighborhood[0]?.[1]||0;
  const confidence=Math.max(0,Math.min(1,(best/(rival+1e-5)-0.92)*2));
  return {bpm:Math.round(bestBpm*10)/10,confidence,score:best};
}

export async function analyzeTempo(buffer,{windowSeconds=12, maxSeconds=180}={}) {
  if(!buffer||buffer.duration<3)throw new Error('A song of at least 3 seconds is required for BPM analysis.');
  const env=onsetEnvelope(buffer,maxSeconds);
  const global=bpmFromEnvelope(env);
  if(!global.bpm)throw new Error('Audio is too short for BPM analysis.');
  const duration=env.duration;
  const regions=[];
  const window=Math.max(7,Math.min(30,windowSeconds));
  for(let start=0;start<duration;start+=window){
    const end=Math.min(start+window,duration);
    const local=bpmFromEnvelope(env,start*env.fps,end*env.fps);
    const bpm=local.bpm||global.bpm;
    if(regions.length && Math.abs(regions[regions.length-1].bpm-bpm)<2.0){
      regions[regions.length-1].end=end;
    }else{
      regions.push({id:'tempo-'+start,start,end,bpm,confidence:local.confidence||0});
    }
  }
  return {
    bpm:global.bpm,
    confidence:global.confidence,
    regions,
    analyzedDuration:duration,
    truncated:buffer.duration>maxSeconds,
    note:'Estimated by onset autocorrelation. Half/double-time errors are possible; verify against the track.'
  };
}

export function suggestSections(buffer,{maxSections=16}={}) {
  if(!buffer||buffer.duration<=0)return [];
  const {audio,rate}=monoSignal(buffer,600);
  const seconds=Math.min(buffer.duration, audio.length/rate);
  const steps=Math.max(1,Math.ceil(seconds/2));
  const loudness=new Float32Array(steps), brightness=new Float32Array(steps);
  for(let s=0;s<steps;s++){
    const a=Math.floor(s*2*rate),end=Math.min(audio.length,Math.floor((s+1)*2*rate));
    let low=0,high=0,prev=0,amount=0;
    for(let i=a;i<end;i+=4){const v=audio[i];low+=v*v;high+=(v-prev)**2;prev=v;amount++;}
    loudness[s]=Math.sqrt(low/Math.max(1,amount));
    brightness[s]=Math.sqrt(high/Math.max(1,amount));
  }
  const candidates=[];
  for(let s=3;s<steps-3;s++){
    const l0=(loudness[s-3]+loudness[s-2]+loudness[s-1])/3;
    const l1=(loudness[s]+loudness[s+1]+loudness[s+2])/3;
    const h0=(brightness[s-3]+brightness[s-2]+brightness[s-1])/3;
    const h1=(brightness[s]+brightness[s+1]+brightness[s+2])/3;
    const score=Math.abs(Math.log((l1+.003)/(l0+.003)))+0.5*Math.abs(Math.log((h1+.003)/(h0+.003)));
    candidates.push({s,time:s*2,score});
  }
  candidates.sort((a,b)=>b.score-a.score);
  const cuts=[0];
  for(const c of candidates){
    if(c.score<0.18||cuts.some(t=>Math.abs(t-c.time)<9))continue;
    cuts.push(c.time);
    if(cuts.length>=maxSections)break;
  }
  cuts.sort((a,b)=>a-b);
  const names=['Intro','Verse','Pre-chorus','Chorus','Verse','Chorus','Bridge','Break','Chorus','Outro'];
  return cuts.map((start,i)=>({
    id:'section-'+i+'-'+Math.round(start),
    name: i===cuts.length-1 && i>2 ? 'Outro' : names[Math.min(i,names.length-1)],
    start, end:cuts[i+1]||seconds, color:['#aa83ef','#6eb9ed','#f0ba73','#db86c2','#9ad4ae'][i%5],
    confidence: i===0?1:Math.min(1,(candidates.find(c=>c.time===start)?.score||0)/1.2)
  }));
}

export function noiseProfile(buffer,seconds=0.8){
  const src=buffer.getChannelData(0);
  const N=1024,hop=256,frames=Math.max(1,Math.floor(Math.min(buffer.duration,seconds)*buffer.sampleRate/hop));
  const out=new Float64Array(N/2+1);
  const magnitudes=[];
  for(let f=0;f<frames;f++){
    const at=f*hop; if(at+N>src.length)break;
    const real=new Float64Array(N),imag=new Float64Array(N);
    for(let i=0;i<N;i++)real[i]=src[at+i]*(0.5-0.5*Math.cos(2*Math.PI*i/(N-1)));
    fft(real,imag,false);
    const magnitude=new Float64Array(out.length);
    for(let k=0;k<out.length;k++)magnitude[k]=Math.hypot(real[k],imag[k]);
    magnitudes.push({mag:magnitude,energy:magnitude.reduce((a,b)=>a+b*b,0)});
  }
  magnitudes.sort((a,b)=>a.energy-b.energy);
  const selected=magnitudes.slice(0,Math.max(1,Math.ceil(magnitudes.length*0.25)));
  for(const frame of selected)for(let k=0;k<out.length;k++)out[k]+=frame.mag[k]/selected.length;
  return out;
}
function fft(real,imag,inverse=false){
  const n=real.length;
  for(let i=1,j=0;i<n;i++){
    let bit=n>>1;
    for(;j&bit;bit>>=1)j^=bit;
    j^=bit;
    if(i<j){let a=real[i];real[i]=real[j];real[j]=a;a=imag[i];imag[i]=imag[j];imag[j]=a;}
  }
  for(let len=2;len<=n;len<<=1){
    const angle=(inverse?2:-2)*Math.PI/len,wr=Math.cos(angle),wi=Math.sin(angle);
    for(let i=0;i<n;i+=len){
      let xr=1,xi=0;
      for(let j=0;j<len/2;j++){
        const a=i+j,b=a+len/2;
        const tr=real[b]*xr-imag[b]*xi,ti=real[b]*xi+imag[b]*xr;
        real[b]=real[a]-tr;imag[b]=imag[a]-ti;
        real[a]+=tr;imag[a]+=ti;
        const nr=xr*wr-xi*wi;xi=xr*wi+xi*wr;xr=nr;
      }
    }
  }
  if(inverse)for(let i=0;i<n;i++){real[i]/=n;imag[i]/=n;}
}

export async function reduceNoise(input,{reduction=0.7,floor=0.12,smoothing=0.75,profileSeconds=0.8}={}) {
  // Windowed spectral subtraction with weighted overlap-add. Noise is estimated from quiet frames.
  if(input.duration>120)throw new Error('For spectral denoise, select a clip under 120 seconds.');
  const N=1024,hop=256,rate=input.sampleRate;
  const out=makeBuffer(input.numberOfChannels,input.length,rate);
  const profile=noiseProfile(input,profileSeconds);
  const window=Float64Array.from({length:N},(_,i)=>0.5-0.5*Math.cos(2*Math.PI*i/(N-1)));
  const norm=new Float64Array(input.length);
  for(let start=0;start<input.length;start+=hop){
    for(let i=0;i<N && start+i<input.length;i++)norm[start+i]+=window[i]*window[i];
  }
  for(let channel=0;channel<input.numberOfChannels;channel++){
    const src=input.getChannelData(channel),dst=out.getChannelData(channel);
    const previous=new Float64Array(N/2+1).fill(1);
    for(let start=0;start<input.length;start+=hop){
      const re=new Float64Array(N),im=new Float64Array(N);
      for(let i=0;i<N;i++)re[i]=(src[start+i]||0)*window[i];
      fft(re,im,false);
      for(let k=0;k<=N/2;k++){
        const magnitude=Math.hypot(re[k],im[k]);
        const raw=Math.max(floor,1-reduction*1.8*profile[k]/Math.max(magnitude,1e-6));
        const gain=smoothing*previous[k]+(1-smoothing)*raw;
        previous[k]=gain;
        re[k]*=gain;im[k]*=gain;
        if(k>0&&k<N/2){re[N-k]*=gain;im[N-k]*=gain;}
      }
      fft(re,im,true);
      for(let i=0;i<N&&start+i<input.length;i++)dst[start+i]+=re[i]*window[i];
    }
    for(let i=0;i<dst.length;i++)dst[i]/=Math.max(norm[i],1e-5);
  }
  return out;
}

const FREQS=[35,55,85,125,200,350,650,1000,2000,4000,8000,14000];
export function spectrum(buffer){
  if(!buffer)return FREQS.map(freq=>({freq,db:-90}));
  const rate=buffer.sampleRate,src=buffer.getChannelData(0);
  const N=Math.min(16384,src.length);
  const offset=Math.max(0,Math.floor((src.length-N)/2));
  const result=[];
  for(const f of FREQS){
    const omega=2*Math.PI*f/rate,coefficient=2*Math.cos(omega);
    let s0=0,s1=0,s2=0;
    for(let i=0;i<N;i+=2){s0=src[offset+i]+coefficient*s1-s2;s2=s1;s1=s0;}
    const power=Math.max(1e-12,(s1*s1+s2*s2-coefficient*s1*s2)/(N*N));
    result.push({freq:f,db:Math.max(-90,Math.min(5,10*Math.log10(power)))});
  }
  return result;
}
export function signalStats(buffer) {
  if(!buffer)return {peak:0, rms:0,db:-90,crest:0};
  let sum=0,peak=0,n=0;
  for(let c=0;c<buffer.numberOfChannels;c++){
    const data=buffer.getChannelData(c);
    const step=Math.max(1,Math.floor(data.length/200000));
    for(let i=0;i<data.length;i+=step){const a=Math.abs(data[i]);peak=Math.max(a,peak);sum+=a*a;n++;}
  }
  const rms=Math.sqrt(sum/Math.max(1,n));
  return {peak,rms,db:20*Math.log10(Math.max(1e-8,rms)),crest:20*Math.log10(Math.max(1e-8,peak)/Math.max(1e-8,rms))};
}
export async function masterBass(buffer,{sub=4,bass=5,lowMid=-2,body=0,presence=0,air=0,targetDb=-11,ceilingDb=-1,compress=0.5,highpass=20}={}) {
  if(buffer.duration>120)throw new Error('Bass mastering is limited to clips under 120 seconds.');
  const ctx=new OfflineAudioContext(buffer.numberOfChannels,buffer.length,buffer.sampleRate);
  const src=ctx.createBufferSource();src.buffer=buffer;let last=src;
  const hp=ctx.createBiquadFilter();hp.type='highpass';hp.frequency.value=highpass;last.connect(hp);last=hp;
  for(const [type,frequency,gain,Q] of [
    ['lowshelf',50,sub,0.7],['peaking',110,bass,1],['peaking',290,lowMid,1],['peaking',750,body,0.8],
    ['peaking',3300,presence,0.9],['highshelf',9500,air,0.7]
  ]){
    const filter=ctx.createBiquadFilter();filter.type=type;filter.frequency.value=frequency;filter.gain.value=gain;
    if(type==='peaking')filter.Q.value=Q;
    last.connect(filter);last=filter;
  }
  if(compress>0){
    const comp=ctx.createDynamicsCompressor();comp.threshold.value=-13-25*compress;
    comp.ratio.value=1+10*compress;comp.attack.value=.004;comp.release.value=.15;last.connect(comp);last=comp;
  }
  last.connect(ctx.destination);src.start();
  const filtered=await ctx.startRendering();
  const {rms}=signalStats(filtered);
  const gain=Math.pow(10,targetDb/20)/Math.max(rms,1e-6);
  const ceiling=Math.pow(10,ceilingDb/20);
  const output=makeBuffer(filtered.numberOfChannels,filtered.length,filtered.sampleRate);
  for(let c=0;c<output.numberOfChannels;c++){
    const src=filtered.getChannelData(c),dst=output.getChannelData(c);
    for(let i=0;i<src.length;i++)dst[i]=Math.max(-ceiling,Math.min(ceiling,src[i]*gain));
  }
  return output;
}

// Notes are expressed in 16th-note steps; self-contained synthesized audio, not external samples.
export function synthPiano(notes,{bpm=150,bars=4,instrument='synth',swing=0,gain=.7}={}) {
  const seconds=bars*4*60/bpm;
  const out=makeBuffer(2,Math.ceil((seconds+0.65)*SAMPLE_RATE),SAMPLE_RATE);
  const left=out.getChannelData(0),right=out.getChannelData(1);
  for(const note of notes){
    const position=note.step*(60/bpm/4)+(note.step%2?swing*(60/bpm/8):0);
    const time=Math.max(0,position),duration=Math.max(0.02,(note.length||1)*60/bpm/4);
    const start=Math.floor(time*SAMPLE_RATE);
    const stop=Math.min(left.length,start+Math.ceil((duration+0.24)*SAMPLE_RATE));
    const hz=440*Math.pow(2,((note.midi||60)-69)/12);
    const volume=(note.velocity||95)/127*gain;
    let p=0;
    for(let i=start;i<stop;i++){
      const t=(i-start)/SAMPLE_RATE;
      p+=2*Math.PI*hz/SAMPLE_RATE;
      const release=Math.max(0, t-duration);
      const envelope=Math.min(1,t/.012)*Math.exp(-release*(instrument==='pad'?5:18));
      const shape=instrument==='bass'?Math.tanh((Math.sin(p)+.18*Math.sin(2*p))*2):
        instrument==='pluck'?(Math.sin(p)+.38*Math.sin(2*p)+.16*Math.sin(3*p))*Math.exp(-t*4):
        instrument==='pad'?(.75*Math.sin(p)+.19*Math.sin(p*1.004)+.14*Math.sin(p*.995)):
        (.62*Math.sin(p)+.28*Math.sin(2*p)+.1*Math.sin(3*p));
      const a=shape*envelope*volume*.5;
      left[i]+=a;right[i]+=a*0.98;
    }
  }
  return out;
}

export async function periodicProcess(clip,effect,events,{widthBeats=0.5,mix=0.75,intensity=1,bpm=150}={}) {
  if(!clip||!events.length)throw new Error('Choose a clip and a non-empty beat pattern.');
  if(events.length>600)throw new Error('A maximum of 600 repeated events is supported per effect pass.');
  const base=slicedClip(clip);
  const result=makeBuffer(base.numberOfChannels,base.length,base.sampleRate);
  for(let c=0;c<base.numberOfChannels;c++)result.getChannelData(c).set(base.getChannelData(c));
  const rate=base.sampleRate;
  let processedEvents=0;
  for(const event of events){
    if((processedEvents++ % 12)===0)await new Promise(resolve=>setTimeout(resolve,0));
    const pos=event.time-clip.start;
    if(pos<0||pos>=clip.duration)continue;
    const count=Math.min(base.length-Math.floor(pos*rate),Math.round(widthBeats*60/(event.bpm||bpm)*rate));
    if(count<256)continue;
    const segment=makeBuffer(base.numberOfChannels,count,rate);
    const offset=Math.floor(pos*rate);
    for(let c=0;c<segment.numberOfChannels;c++)segment.getChannelData(c).set(base.getChannelData(c).subarray(offset,offset+count));
    const processed=await applyEffect({buffer:segment,offset:0,duration:segment.duration,start:0},effect);
    const n=Math.min(count,processed.length);
    const fade=Math.max(32,Math.floor(n*.1));
    for(let c=0;c<segment.numberOfChannels;c++){
      const dst=result.getChannelData(c),fx=processed.getChannelData(Math.min(c,processed.numberOfChannels-1));
      for(let i=0;i<n;i++){
        const cross=Math.min(1,i/fade,(n-i-1)/fade)*mix*intensity;
        dst[offset+i]=dst[offset+i]*(1-cross)+fx[i]*cross;
      }
    }
  }
  return result;
}


// Editable procedural one-shot designer: pitch, tail, saturation, envelopes and filters.
export function designSound(id,{
  semitones=0,attack=0,release=.1,length=0,gain=1,drive=1,
  lowpass=16000,highpass=15,reverse=false,stereo=.1
}={}){
  const source=generateSound(id),rate=source.sampleRate;
  const speed=Math.pow(2,semitones/12);
  const desired=length>0?length:source.duration/speed;
  const frames=Math.min(Math.round(rate*8),Math.max(1,Math.round(desired*rate)));
  const output=makeBuffer(2,frames,rate);
  for(let c=0;c<2;c++){
    const input=source.getChannelData(Math.min(c,source.numberOfChannels-1));
    const dst=output.getChannelData(c);
    const lp=Math.exp(-2*Math.PI*Math.min(lowpass,rate/2-1)/rate);
    const hp=Math.exp(-2*Math.PI*Math.max(0,highpass)/rate);
    let low=0,high=0,oldInput=0;
    for(let i=0;i<frames;i++){
      const at=i*speed;
      const j=Math.floor(at),fraction=at-j;
      const sample=j<input.length?(input[j]*(1-fraction)+(input[Math.min(input.length-1,j+1)]||0)*fraction):0;
      low=low*lp+sample*(1-lp);
      high=(high+low-oldInput)*hp;oldInput=low;
      const envelope=Math.min(1,attack>0?i/(attack*rate):1,release>0?(frames-1-i)/(release*rate):1);
      const width=c===0?1+stereo/3:1-stereo/3;
      const processed=Math.tanh(high*Math.max(.01,drive))/Math.tanh(Math.max(.01,drive));
      dst[i]=Math.max(-1,Math.min(1,processed*envelope*gain*width));
    }
    if(reverse)dst.reverse();
  }
  return output;
}

export const DRUM_LANES=[
  {id:'hard-kick',name:'Hardtekk kick',color:'#bd98f1'},
  {id:'boom',name:'Boom impact',color:'#ed9d80'},
  {id:'808',name:'808 sub',color:'#76bfbd'},
  {id:'clap',name:'Clap',color:'#efb6c1'},
  {id:'snare',name:'Snare',color:'#e6d19a'},
  {id:'hat',name:'Hi-hat',color:'#89c5e9'}
];
export function buildDrumEvents(pattern,{bars=4,bpm=150,swing=0,velocity=1,start=0}={}){
  const events=[];
  const stepLength=60/bpm/4;
  for(let bar=0;bar<bars;bar++){
    for(const lane of DRUM_LANES){
      const steps=pattern[lane.id]||[];
      for(let step=0;step<16;step++){
        const power=Number(steps[step]||0);
        if(power<=0)continue;
        events.push({
          time:start+(bar*16+step)*stepLength+(step%2?swing*stepLength:0),
          id:lane.id,level:Math.max(0,Math.min(1.5,velocity*power))
        });
      }
    }
  }
  return events.sort((a,b)=>a.time-b.time);
}


// Non-destructive structural slicing: each section retains the same audio buffer.
export function splitClipIntoSections(clip,sections,createId=()=>crypto.randomUUID()){
  if(!clip||clip.duration<=0)return [];
  const from=clip.start,to=clip.start+clip.duration;
  const cuts=[from,...sections.map(s=>s.start).filter(x=>x>from+.001&&x<to-.001),to]
    .sort((a,b)=>a-b).filter((x,i,arr)=>i===0||x-arr[i-1]>.001);
  if(cuts.length<=2)return [clip];
  return cuts.slice(0,-1).map((a,i)=>{
    const b=cuts[i+1];
    const label=sections.find(section=>a>=section.start-.01&&a<section.end-.01)?.name;
    return {
      ...clip,id:createId(),start:a,duration:b-a,
      offset:clip.offset+(a-clip.start),
      name:label?clip.name+' · '+label:clip.name
    };
  });
}
