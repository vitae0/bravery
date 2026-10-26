import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  AudioLines, Check, ChevronDown, CircleHelp, Copy, Download, FileAudio, FolderOpen,
  Headphones, Keyboard, Layers, Magnet, Menu, Mic2, Minus, MoreHorizontal,
  Music2, Pause, Play, Plus, Redo2, RotateCcw, Scissors, Search, Settings2,
  SkipBack, SlidersHorizontal, Sparkles, Square, Trash2, Undo2, Upload, Volume2,
  VolumeX, WandSparkles, X, Zap
} from 'lucide-react';
import { CATEGORIES, EFFECTS, SOUNDS } from './catalog.js';
import { ViewMenu, RemixDock, WindowLayer } from './StudioWindows.jsx';
import {
  analyzeTempo, suggestSections, reduceNoise, masterBass, synthPiano,
  timelineBeats, periodicProcess
} from './studio.js';
import './studio.css';
import {
  applyEffect, audibleTracks, downloadBlob, durationOf, formatTime, generateSound,
  makeBuffer, renderMix, scheduleClips, slicedClip, wavBlob, MAX_RENDER_SECONDS
} from './audio.js';

const uid = () => crypto.randomUUID();
const COLORS = ['#bb9dff','#8fd9ff','#ffae80','#a6e9c0','#e9a9d7','#edda8a','#91c5fc'];
const initialTrack = (name, color) => ({
  id:uid(),name,color,gain:1,pan:0,muted:false,solo:false,clips:[]
});
const clipFrom = (name, buffer, start = 0) => ({
  id:uid(),name,buffer,start,offset:0,duration:buffer.duration
});
const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
const fileSafe = name => (name || 'untitled').replace(/[^a-z0-9_-]/gi, '_').slice(0,60);
const emptyState = [];

function Waveform({clip, color, selected, width}) {
  const canvasRef=useRef(null);
  useEffect(() => {
    const canvas=canvasRef.current;
    if (!canvas) return;
    const w=Math.min(1800,Math.max(80,Math.ceil(width))),h=72;
    canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d');
    const data=clip.buffer.getChannelData(0);
    const from=Math.floor(clip.offset*clip.buffer.sampleRate);
    const count=Math.floor(clip.duration*clip.buffer.sampleRate);
    const slice=Math.max(1,Math.ceil(count/w));
    ctx.clearRect(0,0,w,h);
    ctx.strokeStyle=selected?'#f7edff':color;
    ctx.globalAlpha=selected?0.94:0.78;
    ctx.lineWidth=1.35;
    ctx.beginPath();
    for(let x=0;x<w;x++) {
      let min=1,max=-1;
      const start=from+x*slice,end=Math.min(from+count,start+slice);
      const step=Math.max(1,Math.floor((end-start)/24));
      for(let i=start;i<end;i+=step){const v=data[i]||0;min=Math.min(min,v);max=Math.max(max,v);}
      const mid=h/2,scale=(h/2-3);
      ctx.moveTo(x,mid-max*scale);
      ctx.lineTo(x,mid-min*scale);
    }
    ctx.stroke();
  },[clip.buffer,clip.offset,clip.duration,color,selected,width]);
  return <canvas ref={canvasRef} className="wave-canvas" aria-hidden="true" />;
}

function IconButton({title,children,onClick,disabled=false,active=false,className=''}) {
  return <button type="button" title={title} aria-label={title} disabled={disabled}
    className={'icon-button '+(active?'active ':'')+className} onClick={onClick}>{children}</button>;
}

function App() {
  const [tracks,setTracks]=useState(emptyState);
  const tracksRef=useRef(emptyState);
  const undoRef=useRef([]),redoRef=useRef([]);
  const [historyRevision,setHistoryRevision]=useState(0);
  const [projectName,setProjectName]=useState('Untitled remix');
  const [selection,setSelection]=useState(null);
  const [playhead,setPlayhead]=useState(0);
  const playheadRef=useRef(0);
  const [playing,setPlaying]=useState(false);
  const [recording,setRecording]=useState(false);
  const playbackRef=useRef(null);
  const audioCtxRef=useRef(null);
  const recorderRef=useRef(null);
  const [bpm,setBpm]=useState(150);
  const [tempoRegions,setTempoRegions]=useState([]);
  const [songSections,setSongSections]=useState([]);
  const [remixOpen,setRemixOpen]=useState(true);
  const [openWindows,setOpenWindows]=useState([]);
  const [context,setContext]=useState(null);
  const [contextStrength,setContextStrength]=useState(1);
  const [studioSettings,setStudioSettings]=useState({snapToGrid:true,autoOpenEditor:false,confirmDestructive:false});
  const [snap,setSnap]=useState(true);
  const [zoom,setZoom]=useState(75);
  const [libraryTab,setLibraryTab]=useState('effects');
  const [category,setCategory]=useState('All');
  const [query,setQuery]=useState('');
  const [libraryOpen,setLibraryOpen]=useState(true);
  const [busy,setBusy]=useState(false);
  const [toast,setToast]=useState('');
  const [shortcutOpen,setShortcutOpen]=useState(false);
  const audioInput=useRef(null),projectInput=useRef(null);
  const clipClipboard=useRef(null);
  const dragState=useRef(null);
  const msgTimer=useRef(null);

  const notify = useCallback((text) => {
    setToast(text);
    clearTimeout(msgTimer.current);
    msgTimer.current=setTimeout(()=>setToast(''),4300);
  },[]);

  const live = useCallback(next=>{
    tracksRef.current=next;
    setTracks(next);
  },[]);

  const record = useCallback(before=>{
    undoRef.current=[...undoRef.current.slice(-39),before];
    redoRef.current=[];
    setHistoryRevision(n=>n+1);
  },[]);

  const commit = useCallback(updater=>{
    const before=tracksRef.current;
    const next=typeof updater==='function'?updater(before):updater;
    if(next===before)return;
    record(before);live(next);
  },[live,record]);

  const undo=useCallback(()=>{
    if(!undoRef.current.length)return;
    const previous=undoRef.current.pop();
    redoRef.current.push(tracksRef.current);
    live(previous);setHistoryRevision(x=>x+1);
  },[live]);

  const redo=useCallback(()=>{
    if(!redoRef.current.length)return;
    const next=redoRef.current.pop();
    undoRef.current.push(tracksRef.current);
    live(next);setHistoryRevision(x=>x+1);
  },[live]);

  const duration=useMemo(()=>durationOf(tracks),[tracks]);
  const end=Math.max(16,Math.ceil(duration+7));
  const timelineWidth=Math.max(1050,Math.round(end*zoom));
  const activeTrack=tracks.find(t=>t.id===selection?.trackId);
  const activeClip=activeTrack?.clips.find(c=>c.id===selection?.clipId);
  const openWindow=useCallback((id)=>{
    setOpenWindows(old=>[...old.filter(x=>x.id!==id),{id}]);
  },[]);
  const closeWindow=useCallback(id=>setOpenWindows(old=>old.filter(x=>x.id!==id)),[]);
  const focusWindow=useCallback(id=>setOpenWindows(old=>[...old.filter(x=>x.id!==id),...old.filter(x=>x.id===id)]),[]);
  const onSettings=useCallback(changes=>{
    setStudioSettings(old=>({...old,...changes}));
    if('snapToGrid' in changes)setSnap(changes.snapToGrid);
  },[]);
  const currentSongDuration=useCallback(()=>durationOf(tracksRef.current),[]);
  const selectedPrimaryClip=useCallback(()=>{
    const all=tracksRef.current.flatMap(t=>t.clips);
    if(!all.length)return null;
    return all.reduce((best,c)=>!best||c.duration>best.duration?c:best,null);
  },[]);
  const snapSeconds=60/Math.max(40,bpm)/4;
  const quantize=useCallback(t=>snap?Math.round(t/snapSeconds)*snapSeconds:t,[snap,snapSeconds]);

  const stopPlayback=useCallback((reset=false)=>{
    const current=playbackRef.current;
    if(current){
      if(current.raf)cancelAnimationFrame(current.raf);
      for(const source of current.sources)try{source.stop();}catch{ /* already ended */ }
      playbackRef.current=null;
    }
    setPlaying(false);
    if(reset){playheadRef.current=0;setPlayhead(0);}
  },[]);

  const playFrom=useCallback(async(pos)=>{
    stopPlayback();
    const currentTracks=tracksRef.current;
    if(!currentTracks.length||durationOf(currentTracks)<=0){notify('Import audio or add a sound to start.');return;}
    try{
      if(!audioCtxRef.current)audioCtxRef.current=new AudioContext();
      const ctx=audioCtxRef.current;
      await ctx.resume();
      const from=clamp(pos,0,Math.max(0,durationOf(currentTracks)-0.001));
      const when=ctx.currentTime+0.025;
      const sources=scheduleClips(ctx,currentTracks,from,when);
      const playback={ctx,when,from,sources,raf:0};
      playbackRef.current=playback;
      playheadRef.current=from;setPlayhead(from);setPlaying(true);
      let previous=0;
      const tick=(now)=>{
        if(playbackRef.current!==playback)return;
        const current=from+Math.max(0,ctx.currentTime-when);
        if(current>=durationOf(currentTracks)){
          stopPlayback();
          const at=durationOf(currentTracks);playheadRef.current=at;setPlayhead(at);
          return;
        }
        if(now-previous>26){previous=now;playheadRef.current=current;setPlayhead(current);}
        playback.raf=requestAnimationFrame(tick);
      };
      playback.raf=requestAnimationFrame(tick);
    }catch(err){notify('Playback failed: '+err.message);}
  },[notify,stopPlayback]);

  const onTrackWheel=useCallback(event=>{
    if(!event.target.closest('.clip-lane, .ruler, .clip'))return;
    if(event.altKey)return;
    event.preventDefault();
    const scroll=event.currentTarget;
    const rect=scroll.getBoundingClientRect();
    const x=event.clientX-rect.left+scroll.scrollLeft-210;
    const before=Math.max(0,x)/zoom;
    const after=clamp(Math.round(zoom*(event.deltaY<0?1.16:1/1.16)),30,260);
    setZoom(after);
    requestAnimationFrame(()=>{scroll.scrollLeft=Math.max(0,before*after-(event.clientX-rect.left-210));});
  },[zoom]);
  const pause=useCallback(()=>{
    if(!playing){playFrom(playheadRef.current);return;}
    const at=playheadRef.current;
    stopPlayback();setPlayhead(at);playheadRef.current=at;
  },[playing,playFrom,stopPlayback]);

  const seek=useCallback(pos=>{
    const p=clamp(pos,0,Math.max(durationOf(tracksRef.current),0));
    const wasPlaying=!!playbackRef.current;
    stopPlayback();
    setPlayhead(p);playheadRef.current=p;
    if(wasPlaying)playFrom(p);
  },[playFrom,stopPlayback]);

  const getAudioContext=useCallback(async()=>{
    if(!audioCtxRef.current)audioCtxRef.current=new AudioContext();
    await audioCtxRef.current.resume();
    return audioCtxRef.current;
  },[]);

  const importAudio=useCallback(async(list)=>{
    const files=Array.from(list).filter(f=>f);
    if(!files.length)return;
    setBusy(true);
    try {
      const ctx=await getAudioContext();
      const incoming=[];
      for(const file of files){
        try{
          const data=await file.arrayBuffer();
          const buffer=await ctx.decodeAudioData(data.slice(0));
          const name=file.name.replace(/\.[^.]+$/,'');
          const track=initialTrack(name,COLORS[(tracksRef.current.length+incoming.length)%COLORS.length]);
          track.clips=[clipFrom(name,buffer,0)];
          incoming.push(track);
        }catch(err){notify('Could not decode '+file.name+': '+err.message);}
      }
      if(incoming.length){stopPlayback(true);commit(old=>[...old,...incoming]);setSelection({trackId:incoming[0].id,clipId:incoming[0].clips[0].id});notify('Imported '+incoming.length+' audio file(s).');}
    }catch(err){notify(err.message);}
    finally{setBusy(false);}
  },[commit,getAudioContext,notify,stopPlayback]);

  const toggleRecording=useCallback(async()=>{
    if(recorderRef.current){
      if(recorderRef.current.state!=='inactive')recorderRef.current.stop();
      return;
    }
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){
      notify('Microphone recording is not supported in this browser.');return;
    }
    let stream;
    try {
      stopPlayback();
      stream=await navigator.mediaDevices.getUserMedia({audio:true});
      const recorder=new MediaRecorder(stream);
      const chunks=[];
      const startAt=playheadRef.current;
      recorderRef.current=recorder;
      recorder.ondataavailable=e=>{if(e.data.size>0)chunks.push(e.data);};
      recorder.onerror=e=>notify('Microphone recording failed.');
      recorder.onstop=async()=>{
        recorderRef.current=null;
        setRecording(false);
        stream.getTracks().forEach(t=>t.stop());
        if(!chunks.length){notify('No recording data was captured.');return;}
        setBusy(true);
        try {
          const context=await getAudioContext();
          const blob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});
          const buffer=await context.decodeAudioData(await blob.arrayBuffer());
          const track=initialTrack('Microphone '+(tracksRef.current.length+1),'#f5a4b4');
          const clip=clipFrom('Mic recording',buffer,startAt);
          track.clips=[clip];
          commit(old=>[...old,track]);
          setSelection({trackId:track.id,clipId:clip.id});
          notify('Recording added to the timeline.');
        }catch(err){notify('Could not decode the recording: '+err.message);}
        finally{setBusy(false);}
      };
      recorder.start(250);
      setRecording(true);
      notify('Recording microphone. Press the red button to stop.');
    }catch(err){
      stream?.getTracks().forEach(t=>t.stop());
      notify('Microphone access failed: '+err.message);
    }
  },[commit,getAudioContext,notify,stopPlayback]);

  const addTrack=useCallback(()=>{
    const track=initialTrack('Audio '+(tracksRef.current.length+1),COLORS[tracksRef.current.length%COLORS.length]);
    commit(old=>[...old,track]);
    setSelection({trackId:track.id,clipId:null});
  },[commit]);

  const addSound=useCallback(id=>{
    stopPlayback();
    const item=SOUNDS.find(s=>s.id===id);
    const buffer=generateSound(id);
    const start=quantize(playheadRef.current);
    const track=initialTrack(item.name,COLORS[tracksRef.current.length%COLORS.length]);
    const clip=clipFrom(item.name,buffer,start);
    track.clips=[clip];
    commit(old=>[...old,track]);
    setSelection({trackId:track.id,clipId:clip.id});
    notify(item.name+' added.');
  },[commit,notify,quantize,stopPlayback]);

  const apply=useCallback(async(effect)=>{
    if(!activeClip){notify('Select an audio clip to apply an effect.');return;}
    stopPlayback();setBusy(true);
    try{
      const buffer=await applyEffect(activeClip,effect);
      const newClip={...activeClip,buffer,offset:0,duration:buffer.duration};
      commit(old=>old.map(t=>t.id===selection.trackId?{...t,clips:t.clips.map(c=>c.id===activeClip.id?newClip:c)}:t));
      notify(effect.name+' applied. Undo is available.');
    }catch(err){notify(effect.name+': '+err.message);}
    finally{setBusy(false);}
  },[activeClip,commit,notify,selection,stopPlayback]);

  const deleteSelection=useCallback(()=>{
    if(!selection?.clipId)return;
    stopPlayback();
    commit(old=>old.map(t=>t.id===selection.trackId?{...t,clips:t.clips.filter(c=>c.id!==selection.clipId)}:t));
    setSelection({trackId:selection.trackId,clipId:null});
  },[commit,selection,stopPlayback]);

  const duplicate=useCallback(()=>{
    if(!activeClip)return;
    const next={...activeClip,id:uid(),name:activeClip.name+' copy',start:activeClip.start+activeClip.duration};
    commit(old=>old.map(t=>t.id===selection.trackId?{...t,clips:[...t.clips,next]}:t));
    setSelection({trackId:selection.trackId,clipId:next.id});
  },[activeClip,commit,selection]);

  const splitAtCursor=useCallback(()=>{
    if(!activeClip){notify('Select a clip to split.');return;}
    const time=playheadRef.current;
    if(time<=activeClip.start+0.02||time>=activeClip.start+activeClip.duration-0.02){
      notify('Move the playhead inside the selected clip.');return;
    }
    const a={...activeClip,id:uid(),duration:time-activeClip.start};
    const b={...activeClip,id:uid(),start:time,offset:activeClip.offset+(time-activeClip.start),duration:activeClip.duration-a.duration};
    commit(old=>old.map(t=>t.id===selection.trackId?{...t,clips:t.clips.flatMap(c=>c.id===activeClip.id?[a,b]:[c])}:t));
    setSelection({trackId:selection.trackId,clipId:b.id});
  },[activeClip,commit,notify,selection]);

  const paste=useCallback(()=>{
    if(!clipClipboard.current)return;
    const trackId=selection?.trackId??tracksRef.current[0]?.id;
    if(!trackId)return;
    const base=clipClipboard.current;
    const clip={...base,id:uid(),start:quantize(playheadRef.current)};
    commit(old=>old.map(t=>t.id===trackId?{...t,clips:[...t.clips,clip]}:t));
    setSelection({trackId,clipId:clip.id});
  },[commit,quantize,selection]);

  const addBoomToBeats=useCallback(()=>{
    const currentDuration=durationOf(tracksRef.current);
    if(!currentDuration){notify('Import a song first.');return;}
    const spacing=60/Math.max(40,bpm);
    const count=Math.min(700,Math.ceil(currentDuration/spacing));
    const sound=generateSound('hard-kick');
    const track=initialTrack('Hardstyle • '+bpm+' BPM','#ee9a7b');
    track.clips=Array.from({length:count},(_,i)=>clipFrom('Hardstyle Kick',sound,i*spacing));
    stopPlayback();commit(old=>[...old,track]);
    setSelection({trackId:track.id,clipId:track.clips[0].id});
    notify('Added '+count+' hardstyle kicks on the '+bpm+' BPM grid.');
  },[bpm,commit,notify,stopPlayback]);

  const doExport=useCallback(async()=>{
    if(!duration){notify('Your project is empty.');return;}
    setBusy(true);stopPlayback();
    try{
      const buffer=await renderMix(tracksRef.current,durationOf(tracksRef.current));
      downloadBlob(wavBlob(buffer),fileSafe(projectName)+'.wav');
      notify('WAV mix exported locally.');
    }catch(err){notify('Export failed: '+err.message);}
    finally{setBusy(false);}
  },[duration,notify,projectName,stopPlayback]);

  const saveProject=useCallback(async()=>{
    setBusy(true);
    try{
      const zip=new JSZip(),refs=new Map();
      let counter=0;
      const serialized=tracksRef.current.map(track=>({
        ...track,
        clips:track.clips.map(clip=>{
          let key=refs.get(clip.buffer);
          if(!key){
            key='audio/'+(counter++)+'.wav';
            refs.set(clip.buffer,key);
            zip.file(key,wavBlob(clip.buffer));
          }
          const {buffer,...plain}=clip;
          return {...plain,audio:key};
        })
      }));
      zip.file('project.json',JSON.stringify({format:'bravery-project',version:1,name:projectName,bpm,tracks:serialized},null,2));
      const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE'});
      downloadBlob(blob,fileSafe(projectName)+'.bravery');
      notify('Project saved. Keep the .bravery file to reopen it.');
    }catch(err){notify('Could not save project: '+err.message);}
    finally{setBusy(false);}
  },[bpm,notify,projectName]);

  const loadProject=useCallback(async(file)=>{
    if(!file)return;
    setBusy(true);
    try{
      const zip=await JSZip.loadAsync(file);
      const manifest=zip.file('project.json');
      if(!manifest)throw new Error('Missing project.json');
      const meta=JSON.parse(await manifest.async('string'));
      if(meta.format!=='bravery-project'||!Array.isArray(meta.tracks))throw new Error('Invalid Bravery project.');
      if(meta.tracks.length>128)throw new Error('Too many tracks.');
      const context=await getAudioContext();
      const buffers=new Map(),restored=[];
      for(const track of meta.tracks){
        const clips=[];
        for(const item of track.clips||[]){
          if(!buffers.has(item.audio)){
            const entry=zip.file(item.audio);
            if(!entry)throw new Error('Missing audio file in project.');
            const data=await entry.async('arraybuffer');
            buffers.set(item.audio,await context.decodeAudioData(data));
          }
          const buffer=buffers.get(item.audio);
          clips.push({...item,buffer,
            start:Math.max(0,Number(item.start)||0),
            offset:clamp(Number(item.offset)||0,0,buffer.duration),
            duration:clamp(Number(item.duration)||0,0,buffer.duration-(Number(item.offset)||0))
          });
        }
        restored.push({
          ...initialTrack(track.name||'Audio',track.color||COLORS[restored.length%COLORS.length]),
          ...track, clips, gain:clamp(Number(track.gain??1),0,2),
          pan:clamp(Number(track.pan??0),-1,1)
        });
      }
      stopPlayback(true);commit(restored);setSelection(null);
      setProjectName(meta.name||'Imported project');
      setBpm(clamp(Number(meta.bpm)||150,40,240));
      notify('Project loaded.');
    }catch(err){notify('Could not open project: '+err.message);}
    finally{setBusy(false);}
  },[commit,getAudioContext,notify,stopPlayback]);

  const removeTrack=useCallback(id=>{
    stopPlayback();commit(old=>old.filter(t=>t.id!==id));
    if(selection?.trackId===id)setSelection(null);
  },[commit,selection,stopPlayback]);

  const modifyTrack=useCallback((id,changes)=>{
    const previous=tracksRef.current;
    live(previous.map(t=>t.id===id?{...t,...changes}:t));
  },[live]);

  const replaceClipBuffer=useCallback((target,buffer)=>{
    if(!target)return;
    const next={...target,buffer,offset:0,duration:buffer.duration};
    commit(before=>before.map(track=>({...track,clips:track.clips.map(c=>c.id===target.id?next:c)})));
  },[commit]);

  const withStrength=useCallback((effect,strength=1)=>{
    const config={...effect.config};
    const k=effect.kind;
    if(k==='filter' && typeof config.gain==='number')config.gain*=strength;
    else if(k==='filter' && typeof config.frequency==='number')config.frequency*=Math.pow(1.28,strength-1);
    if(['reverb','delay','chorus'].includes(k)&&config.wet!==undefined)config.wet=clamp(config.wet*strength,0,1);
    if(k==='distortion'&&config.drive)config.drive=Math.max(.5,config.drive*strength);
    if(k==='compressor'&&config.threshold)config.threshold=clamp(config.threshold*strength,-90,0);
    if(k==='gain'&&config.db)config.db=clamp(config.db*strength,-50,36);
    if(k==='tremolo'&&config.depth)config.depth=clamp(config.depth*strength,0,1);
    if(k==='pitch'&&config.semitones)config.semitones=clamp(config.semitones*strength,-24,24);
    if(k==='speed'&&config.speed)config.speed=1+(config.speed-1)*strength;
    if(k==='bitcrush'&&config.bits)config.bits=Math.max(2,Math.round(16-(16-config.bits)*strength));
    return {...effect,config};
  },[]);

  const processClip=useCallback(async(processor,label)=>{
    if(!activeClip){notify('Select a clip first.');return;}
    if(studioSettings.confirmDestructive&&!window.confirm('Apply "'+label+'" to this clip? Undo can restore it.'))return;
    const target=activeClip;
    stopPlayback();
    setBusy(true);
    try{
      const rendered=await processor(target);
      if(!rendered)throw new Error('No processed audio was generated.');
      replaceClipBuffer(target,rendered);
      notify(label+' applied. Ctrl+Z to undo.');
    }catch(err){notify(label+': '+err.message);}
    finally{setBusy(false);}
  },[activeClip,studioSettings.confirmDestructive,stopPlayback,replaceClipBuffer,notify]);

  const applyStrength=useCallback((effect,intensity=1)=>{
    if(!effect)return;
    processClip(c=>applyEffect(c,withStrength(effect,intensity)),effect.name);
  },[processClip,withStrength]);

  const remixLayer=useCallback(config=>{
    const {tool,every,source,customBpm,offset,intensity,swing,humanize,pattern,regions}=config;
    const duration=durationOf(tracksRef.current);
    const start=clamp(config.start||0,0,Math.max(duration,1));
    const finish=config.finish>start ? Math.min(config.finish,duration) : duration;
    if(finish<=start){notify('Import a song before generating a beat layer.');return;}
    let events=timelineBeats(start,finish,{source,customBpm,bpm,regions,every,offset});
    if(pattern==='offbeat')events=events.map(e=>({...e,time:e.time+60/(e.bpm||bpm)/2})).filter(e=>e.time<finish);
    if(pattern==='alternating')events=events.filter((e,i)=>i%2===0);
    if(!events.length){notify('No beats fall in this interval. Check the start/end settings.');return;}
    const original=generateSound(tool);
    const amplified=makeBuffer(original.numberOfChannels,original.length,original.sampleRate);
    for(let c=0;c<amplified.numberOfChannels;c++){
      const src=original.getChannelData(c),dst=amplified.getChannelData(c);
      for(let i=0;i<dst.length;i++)dst[i]=clamp(src[i]*intensity,-1,1);
    }
    const layer=initialTrack(SOUNDS.find(s=>s.id===tool)?.name+' · every '+every+' beats','#ffb18e');
    const beat=60/Math.max(40,source==='custom'?customBpm:bpm);
    layer.clips=events.map((e,i)=>{
      const swung=(i%2===1 ? swing/100*beat/2 : 0);
      const human=humanize?Math.sin(i*731.31+25)*humanize/1000:0;
      return clipFrom(SOUNDS.find(s=>s.id===tool)?.name||'Sample',amplified,Math.max(0,e.time+swung+human));
    });
    stopPlayback();
    commit(before=>[...before,layer]);
    setSelection({trackId:layer.id,clipId:layer.clips[0].id});
    notify('Created '+layer.clips.length+' rhythmic events at '+every+'-beat intervals.');
  },[bpm,commit,notify,stopPlayback]);

  const applyPeriodic=useCallback(async config=>{
    const effect=config.effect;
    if(!effect||!activeClip){notify('Select a clip and effect first.');return;}
    const target=activeClip;
    const start=Math.max(target.start,config.start||0);
    const finish=Math.min(target.start+target.duration,config.finish>start?config.finish:target.start+target.duration);
    const events=timelineBeats(start,finish,{source:config.source,customBpm:config.customBpm,bpm,regions:tempoRegions,every:config.every,offset:config.offset});
    if(!events.length){notify('No periodic events in the selected clip.');return;}
    await processClip(c=>periodicProcess(c,withStrength(effect,config.intensity),events,{widthBeats:config.width,mix:config.mix,intensity:1,bpm}),'Periodic '+effect.name);
  },[activeClip,bpm,tempoRegions,notify,processClip,withStrength]);

  const autoTempo=useCallback(async()=>{
    const candidate=activeClip||selectedPrimaryClip();
    if(!candidate){notify('Add a song to analyze its BPM.');return;}
    setBusy(true);
    try{
      const result=await analyzeTempo(slicedClip(candidate));
      setBpm(Math.round(result.bpm));
      const extended=result.regions.map((r,i,arr)=>({
        ...r,id:uid(),start:r.start+candidate.start,
        end:i===arr.length-1?candidate.start+candidate.duration:r.end+candidate.start
      }));
      setTempoRegions(extended);
      notify('Detected '+result.bpm+' BPM with '+extended.length+' tempo region(s). Check the tempo map for corrections.');
      openWindow('tempo');
    }catch(err){notify('BPM detection failed: '+err.message);}
    finally{setBusy(false);}
  },[activeClip,notify,openWindow,selectedPrimaryClip]);

  const detectSections=useCallback(()=>{
    const candidate=activeClip||selectedPrimaryClip();
    if(!candidate){notify('Import music before detecting sections.');return;}
    setBusy(true);
    try{
      const sections=suggestSections(slicedClip(candidate));
      setSongSections(sections.map(s=>({...s,id:uid(),start:s.start+candidate.start,end:s.end+candidate.start})));
      notify('Created '+sections.length+' arrangement markers. Rename verse/chorus guesses as needed.');
    }catch(err){notify('Section analysis: '+err.message);}
    finally{setBusy(false);}
  },[activeClip,notify,selectedPrimaryClip]);

  const addTempoRegion=useCallback(()=>{
    const start=playheadRef.current,end=Math.max(start+4,durationOf(tracksRef.current));
    setTempoRegions(old=>[...old,{id:uid(),start,end,bpm}].sort((a,b)=>a.start-b.start));
  },[bpm]);
  const addSection=useCallback(()=>{
    const start=playheadRef.current,end=Math.max(start+4,durationOf(tracksRef.current));
    setSongSections(old=>[...old,{id:uid(),name:'New section',start,end,color:'#aa84eb'}].sort((a,b)=>a.start-b.start));
  },[]);

  const addPiano=useCallback((notes,settings)=>{
    const buffer=synthPiano(notes,settings);
    const track=initialTrack(settings.instrument+' · piano roll',COLORS[tracksRef.current.length%COLORS.length]);
    const newClip=clipFrom('Piano pattern',buffer,Math.max(0,playheadRef.current));
    track.clips=[newClip];
    commit(old=>[...old,track]);
    setSelection({trackId:track.id,clipId:newClip.id});
    notify('Synthesized '+notes.length+' MIDI notes into an editable audio track.');
  },[commit,notify]);

  const bassMaster=useCallback(settings=>processClip(c=>masterBass(slicedClip(c),settings),'Bass Master'),[processClip]);
  const denoise=useCallback(settings=>processClip(c=>reduceNoise(slicedClip(c),settings),'Spectral Noise Reduction'),[processClip]);

  const editSound=useCallback(settings=>processClip(async target=>{
    const {gain,speed,fadeIn,fadeOut,reverse,normalize,trimStart,trimEnd}=settings;
    const length=target.duration;
    const trimA=clamp(trimStart,0,Math.max(0,length-.1));
    const trimB=clamp(trimEnd,0,Math.max(0,length-trimA-.1));
    const segment={...target,offset:target.offset+trimA,duration:length-trimA-trimB};
    let rendered=slicedClip(segment);
    if(normalize)rendered=await applyEffect({buffer:rendered,offset:0,duration:rendered.duration},EFFECTS.find(x=>x.id==='normalize'));
    if(Math.abs(speed-1)>.01)rendered=await applyEffect({buffer:rendered,offset:0,duration:rendered.duration}, {kind:'speed',config:{speed}});
    if(reverse)rendered=await applyEffect({buffer:rendered,offset:0,duration:rendered.duration},EFFECTS.find(x=>x.id==='reverse'));
    const amp=Math.pow(10,gain/20),rate=rendered.sampleRate;
    const fadeInSamples=Math.min(rendered.length,fadeIn*rate),fadeOutSamples=Math.min(rendered.length,fadeOut*rate);
    for(let c=0;c<rendered.numberOfChannels;c++){
      const a=rendered.getChannelData(c);
      for(let i=0;i<a.length;i++){
        const fade=Math.min(1,fadeInSamples?i/fadeInSamples:1,fadeOutSamples?(a.length-i-1)/fadeOutSamples:1);
        a[i]=clamp(a[i]*amp*fade,-1,1);
      }
    }
    return rendered;
  },'Sound Editor'),[processClip]);

  const contextClip=useCallback((event,trackId,clipId)=>{
    event.preventDefault();
    event.stopPropagation();
    setSelection({trackId,clipId});
    setContext({type:'clip',trackId,clipId,x:Math.min(event.clientX,innerWidth-240),y:Math.min(event.clientY,innerHeight-340)});
  },[]);
  const contextEffect=useCallback((event,item,type='effect')=>{
    event.preventDefault();event.stopPropagation();
    setContextStrength(1);
    setContext({type,id:item.id,x:Math.min(event.clientX,innerWidth-250),y:Math.min(event.clientY,innerHeight-310)});
  },[]);
  const onSelectClip=useCallback((trackId,clipId)=>{
    setSelection({trackId,clipId});
    if(studioSettings.autoOpenEditor)openWindow('sound');
  },[openWindow,studioSettings.autoOpenEditor]);

  const beginDrag=useCallback((event,trackId,clip,action)=>{
    if(event.button!==0||busy)return;
    event.preventDefault();event.stopPropagation();
    stopPlayback();
    setSelection({trackId,clipId:clip.id});
    const before=tracksRef.current;
    const originX=event.clientX;
    const origin={...clip};
    let changed=false;
    const onMove=e=>{
      const delta=(e.clientX-originX)/zoom;
      let next={...origin};
      if(action==='move')next.start=Math.max(0,quantize(origin.start+delta));
      if(action==='left'){
        const time=clamp(quantize(origin.start+delta),Math.max(0,origin.start-origin.offset),origin.start+origin.duration-0.04);
        const shift=time-origin.start;
        next.start=time;next.offset=origin.offset+shift;next.duration=origin.duration-shift;
      }
      if(action==='right')next.duration=clamp(quantize(origin.duration+delta),0.04,origin.buffer.duration-origin.offset);
      changed=true;
      live(before.map(t=>t.id===trackId?{...t,clips:t.clips.map(c=>c.id===clip.id?next:c)}:t));
    };
    const onUp=()=>{
      window.removeEventListener('pointermove',onMove);
      window.removeEventListener('pointerup',onUp);
      if(changed)record(before);
      dragState.current=null;
    };
    dragState.current={onMove,onUp};
    window.addEventListener('pointermove',onMove);
    window.addEventListener('pointerup',onUp,{once:true});
  },[busy,live,quantize,record,stopPlayback,zoom]);

  useEffect(()=>{
    const onKey=e=>{
      const element=e.target;
      if(element?.closest?.('input, textarea, [contenteditable="true"]'))return;
      const modifier=e.ctrlKey||e.metaKey;
      if(modifier&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}
      if(modifier&&e.key.toLowerCase()==='y'){e.preventDefault();redo();return;}
      if(modifier&&e.key.toLowerCase()==='c'){if(activeClip){e.preventDefault();clipClipboard.current={...activeClip};notify('Clip copied.');}return;}
      if(modifier&&e.key.toLowerCase()==='v'){e.preventDefault();paste();return;}
      if(e.code==='Space'){e.preventDefault();pause();}
      if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();deleteSelection();}
      if(e.key.toLowerCase()==='s'&&!modifier){e.preventDefault();splitAtCursor();}
      if(e.key==='Escape'){setSelection(null);}
    };
    window.addEventListener('keydown',onKey);
    return ()=>window.removeEventListener('keydown',onKey);
  },[activeClip,deleteSelection,notify,paste,pause,redo,splitAtCursor,undo]);

  useEffect(()=>()=>{
    if(dragState.current){
      window.removeEventListener('pointermove',dragState.current.onMove);
      window.removeEventListener('pointerup',dragState.current.onUp);
    }
    clearTimeout(msgTimer.current);
    if(playbackRef.current)for(const source of playbackRef.current.sources)try{source.stop();}catch{}
    if(recorderRef.current?.state==='recording')recorderRef.current.stop();
    audioCtxRef.current?.close();
  },[]);

  const filtered=useMemo(()=>{
    const data=libraryTab==='effects'?EFFECTS:SOUNDS;
    return data.filter(item=>(category==='All'||item.category===category)
      &&(item.name+' '+item.detail+' '+item.category).toLowerCase().includes(query.toLowerCase()));
  },[libraryTab,category,query]);

  const onRootDrop=async e=>{
    e.preventDefault();
    const files=Array.from(e.dataTransfer.files);
    const project=files.find(f=>f.name.toLowerCase().endsWith('.bravery'));
    if(project)await loadProject(project);else await importAudio(files);
  };

  const rulerMarks=[];
  const step=zoom>=140?1:zoom>=70?2:5;
  for(let sec=0;sec<=end;sec+=step)rulerMarks.push(sec);

  return <div className="app-shell" onDragOver={e=>e.preventDefault()} onDrop={onRootDrop}>
    <header className="topbar">
      <div className="brand"><span className="brand-icon"><AudioLines size={21} strokeWidth={2.7}/></span><span>bravery<span className="brand-period">.</span></span></div>
      <div className="topbar-divider" />
      <div className="project-area">
        <input className="project-title" aria-label="Project name" value={projectName} onChange={e=>setProjectName(e.target.value)} />
        <span className="project-label">BROWSER STUDIO <span className="green-light" /></span>
      </div>
      <div className="topbar-actions">
        <span className="privacy-label"><span className="green-light"/> Local audio processing</span>
        <button className="soft-button" onClick={()=>projectInput.current?.click()}><FolderOpen size={16}/> Open project</button>
        <button className="soft-button" onClick={saveProject} disabled={busy}><Download size={16}/> Save project</button>
        <button className="primary-button" onClick={doExport} disabled={busy||!duration}><Download size={16}/> Export WAV</button>
      </div>
    </header>

    <div className="workspace">
      {libraryOpen&&<aside className="library">
        <div className="panel-head">
          <div><div className="small-heading">YOUR WORKSPACE</div><h2>Sound library</h2></div>
          <IconButton title="Hide library" onClick={()=>setLibraryOpen(false)}><X size={17}/></IconButton>
        </div>
        <div className="lib-tabs">
          <button className={libraryTab==='effects'?'chosen':''} onClick={()=>{setLibraryTab('effects');setCategory('All');}}><SlidersHorizontal size={15}/> Effects</button>
          <button className={libraryTab==='sounds'?'chosen':''} onClick={()=>{setLibraryTab('sounds');setCategory('All');}}><Music2 size={15}/> Sounds</button>
        </div>
        <div className="search-box"><Search size={16}/><input aria-label="Search library" placeholder="Search sounds & effects..." value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button onClick={()=>setQuery('')}><X size={13}/></button>}</div>
        <div className="categories">
          {(libraryTab==='effects'?CATEGORIES:['All',...new Set(SOUNDS.map(x=>x.category))]).map(cat=><button key={cat} className={category===cat?'selected':''} onClick={()=>setCategory(cat)}>{cat}</button>)}
        </div>
        <div className="library-scroll">
          <div className="list-heading"><span>{category==='All'?'EXPLORE '+(libraryTab==='effects'?'EFFECTS':'SOUNDS'):category.toUpperCase()}</span><span>{filtered.length}</span></div>
          {filtered.length?filtered.map(item=><button key={item.id} className="effect-card" title={item.detail} disabled={busy} onClick={()=>libraryTab==='effects'?apply(item):addSound(item.id)}>
            <span className={'effect-symbol '+(libraryTab==='sounds'?'sound-symbol':'')}>{libraryTab==='effects'?<WandSparkles size={17}/>:<Zap size={17}/>}</span>
            <span className="effect-copy"><strong>{item.name}</strong><small>{item.detail}</small></span>
            <span className="effect-add"><Plus size={16}/></span>
          </button>):<p className="no-results">No matching items.</p>}
        </div>
        <div className="library-bottom"><Sparkles size={17}/><div><strong>Instant remix</strong><span>Pick a clip, then choose an effect.</span></div></div>
      </aside>}

      <main className="editor">
        <div className="editor-toolbar">
          <div className="tool-section">
            {!libraryOpen&&<IconButton title="Show library" onClick={()=>setLibraryOpen(true)}><Menu size={18}/></IconButton>}
            <button className="tool-button import-button" onClick={()=>audioInput.current?.click()}><Plus size={17}/> Import audio</button>
            <div className="toolbar-sep"/>
            <IconButton title="Undo (Ctrl+Z)" disabled={!undoRef.current.length} onClick={undo}><Undo2 size={18}/></IconButton>
            <IconButton title="Redo (Ctrl+Shift+Z)" disabled={!redoRef.current.length} onClick={redo}><Redo2 size={18}/></IconButton>
            <div className="toolbar-sep"/>
            <IconButton title="Split at playhead (S)" disabled={!activeClip} onClick={splitAtCursor}><Scissors size={18}/></IconButton>
            <IconButton title="Duplicate clip" disabled={!activeClip} onClick={duplicate}><Copy size={17}/></IconButton>
            <IconButton title="Delete clip" disabled={!activeClip} onClick={deleteSelection}><Trash2 size={17}/></IconButton>
          </div>
          <div className="tool-section options">
            <button title="Snap clips to sixteenth-note grid" className={'snap-toggle '+(snap?'enabled':'')} onClick={()=>setSnap(v=>!v)}><Magnet size={15}/> Snap</button>
            <div className="bpm-box"><span>BPM</span><input aria-label="Project BPM" type="number" min="40" max="240" value={bpm} onChange={e=>setBpm(clamp(Number(e.target.value)||40,40,240))}/></div>
            <div className="toolbar-sep"/>
            <IconButton title="Zoom out" onClick={()=>setZoom(v=>Math.max(30,v-15))}><Minus size={17}/></IconButton>
            <span className="zoom-text">{Math.round(zoom/75*100)}%</span>
            <IconButton title="Zoom in" onClick={()=>setZoom(v=>Math.min(250,v+15))}><Plus size={17}/></IconButton>
          </div>
        </div>

        <div className="transport-panel">
          <div className="transport-left">
            <button className={'record-button '+(recording?'recording':'')} title={recording?'Stop recording microphone':'Record microphone'} aria-label={recording?'Stop recording microphone':'Record microphone'} onClick={toggleRecording}>{recording?<Square size={16} fill="currentColor"/>:<Mic2 size={18}/>}</button>
            <IconButton title="Back to start" onClick={()=>seek(0)}><SkipBack size={17}/></IconButton>
            <button aria-label={playing?'Pause':'Play'} title="Play / Pause (Space)" className="play-button" onClick={pause}>{playing?<Pause size={19} fill="currentColor"/>:<Play size={19} fill="currentColor"/>}</button>
            <IconButton title="Stop" onClick={()=>stopPlayback(true)}><Square size={15} fill="currentColor"/></IconButton>
            <span className="time-display">{formatTime(playhead)}</span><span className="time-separator">/</span><span className="total-time">{formatTime(duration)}</span>
          </div>
          <div className="transport-right">
            <span className="bpm-indicator"><span className="beat-indicator" /> 4/4</span>
            <button className="hardstyle-button" disabled={!duration||busy} onClick={addBoomToBeats}><Zap size={16}/> Hardstyle on beats</button>
            <IconButton title="Keyboard shortcuts" onClick={()=>setShortcutOpen(true)}><Keyboard size={18}/></IconButton>
          </div>
        </div>

        <section className="timeline-section">
          <div className="section-title"><div><Layers size={17}/><h3>Timeline</h3><span className="track-counter">{tracks.length} tracks</span></div><span className="timeline-hint">Drag clips to move · Drag edges to trim · S to split</span></div>
          <div className="timeline-scroll">
            <div className="timeline-content" style={{width:timelineWidth+210}}>
              <div className="ruler-row">
                <div className="track-head ruler-label"><span>TRACKS</span></div>
                <div className="ruler" style={{width:timelineWidth}} onPointerDown={e=>seek((e.clientX-e.currentTarget.getBoundingClientRect().left)/zoom)}>
                  {rulerMarks.map(sec=><div key={sec} className="tick" style={{left:sec*zoom}}><span>{formatTime(sec).split('.')[0]}</span></div>)}
                </div>
              </div>
              {tracks.map((track,index)=><div className="track-row" key={track.id}>
                <div className={'track-head track-info '+(selection?.trackId===track.id?'track-active':'')}>
                  <div className="track-heading"><span className="track-color" style={{background:track.color}}/><input aria-label="Track name" value={track.name} onChange={e=>modifyTrack(track.id,{name:e.target.value})}/><IconButton title="Remove track" onClick={()=>removeTrack(track.id)}><X size={15}/></IconButton></div>
                  <div className="track-controls">
                    <button className={track.muted?'mute engaged':'mute'} title="Mute track" onClick={()=>modifyTrack(track.id,{muted:!track.muted})}>M</button>
                    <button className={track.solo?'solo engaged':'solo'} title="Solo track" onClick={()=>modifyTrack(track.id,{solo:!track.solo})}>S</button>
                    <Volume2 size={13}/><input aria-label={track.name+' volume'} type="range" min="0" max="2" step="0.02" value={track.gain} onChange={e=>modifyTrack(track.id,{gain:Number(e.target.value)})}/>
                  </div>
                  <div className="track-bottom"><span>#{String(index+1).padStart(2,'0')}</span><span>{track.clips.length} clips</span></div>
                </div>
                <div className="clip-lane" style={{width:timelineWidth}} onDoubleClick={e=>{const x=e.clientX-e.currentTarget.getBoundingClientRect().left;seek(x/zoom);}}>
                  <div className="beat-grid" style={{backgroundSize:(zoom*60/bpm)+'px 100%'}}/>
                  {track.clips.map(clip=>{
                    const selected=selection?.clipId===clip.id&&selection?.trackId===track.id;
                    const width=Math.max(9,clip.duration*zoom);
                    return <div key={clip.id}
                      role="button" tabIndex={0} aria-label={'Clip '+clip.name}
                      className={'clip '+(selected?'clip-selected ':'')+(track.muted?'clip-muted':'')}
                      style={{left:clip.start*zoom,width,backgroundColor:track.color+'22',borderColor:selected?'#f7efff':track.color+'99'}}
                      onPointerDown={e=>beginDrag(e,track.id,clip,'move')}
                      onClick={()=>setSelection({trackId:track.id,clipId:clip.id})}>
                      <Waveform clip={clip} width={width} color={track.color} selected={selected}/>
                      <div className="clip-name"><Music2 size={12}/><span>{clip.name}</span></div>
                      <div className="clip-handle left" title="Trim beginning" onPointerDown={e=>beginDrag(e,track.id,clip,'left')}/>
                      <div className="clip-handle right" title="Trim end" onPointerDown={e=>beginDrag(e,track.id,clip,'right')}/>
                    </div>;
                  })}
                </div>
              </div>)}
              <div className="new-track-row"><div className="track-head add-track"><button onClick={addTrack}><Plus size={15}/> Add track</button></div><div className="empty-lane" style={{width:timelineWidth}}/></div>
              <div className="playhead-line" style={{left:210+playhead*zoom}}><div className="playhead-cap"/></div>
              {!tracks.length&&<div className="empty-studio" style={{left:210,width:timelineWidth}}>
                <div className="empty-ring"><AudioLines size={33}/></div>
                <h2>Make some noise.</h2>
                <p>Drop an audio file here, or choose a sound from the library.<br/>Your next remix starts in this browser.</p>
                <button className="primary-button" onClick={()=>audioInput.current?.click()}><Upload size={16}/> Import your first track</button>
                <div className="file-types">WAV · MP3 · OGG · M4A (browser-dependent)</div>
              </div>}
            </div>
          </div>
        </section>

        <div className="bottom-info">
          <div className="selection-info"><div className="selection-icon"><SlidersHorizontal size={18}/></div><div><strong>{activeClip?'Selected: '+activeClip.name:'No clip selected'}</strong><span>{activeClip?'Duration '+formatTime(activeClip.duration)+' · Choose a one-click effect from the library':'Select a clip to edit, split or process it'}</span></div></div>
          <div className="status-cards"><span><span className="status-dot"/> Web Audio engine</span><span>44.1 kHz export</span><span>On-device</span></div>
        </div>
      </main>
    </div>

    <input ref={audioInput} type="file" accept="audio/*,.wav,.mp3,.ogg,.m4a,.flac" multiple hidden onChange={e=>{importAudio(e.target.files);e.target.value='';}}/>
    <input ref={projectInput} type="file" accept=".bravery" hidden onChange={e=>{loadProject(e.target.files[0]);e.target.value='';}}/>
    {busy&&<div className="busy-layer"><div className="spinner"/><span>Processing audio in your browser...</span></div>}
    {toast&&<div className="toast"><span>{toast}</span><IconButton title="Dismiss" onClick={()=>setToast('')}><X size={16}/></IconButton></div>}
    {shortcutOpen&&<div className="modal-backdrop" onClick={()=>setShortcutOpen(false)}>
      <div className="shortcut-modal" onClick={e=>e.stopPropagation()}>
        <div className="modal-title"><h2>Keyboard shortcuts</h2><IconButton title="Close" onClick={()=>setShortcutOpen(false)}><X size={18}/></IconButton></div>
        {[
          ['Space','Play / pause'],['S','Split selected clip'],['Delete','Remove selected clip'],
          ['Ctrl / Cmd + Z','Undo'],['Ctrl / Cmd + Shift + Z','Redo'],
          ['Ctrl / Cmd + C','Copy clip'],['Ctrl / Cmd + V','Paste at playhead']
        ].map(([key,desc])=><div className="shortcut-row" key={key}><kbd>{key}</kbd><span>{desc}</span></div>)}
      </div>
    </div>}
  </div>;
}
export default App;
