import {useEffect,useRef,useState} from 'react';
import {ArrowLeft, AudioLines, Download, Pause, Play, Upload, RotateCcw, Sparkles} from 'lucide-react';
import {FLOW_PADS, classifyFlowGesture, flowSectionAt} from './flow.js';
import {formatTime} from './audio.js';
import './flow.css';

const COLORS={kick:'#f99d72',snare:'#9faeff',hat:'#78d7c9',impact:'#f5cb82'};
const gesturePath=points=>points.map((p,i)=>(i?'L':'M')+(p.x*1000).toFixed(1)+' '+(p.y*400).toFixed(1)).join(' ');

export default function FlowMode({
  playing,playhead,duration,bpm,sections,tracks, status,
  onPlay,onExit,onImport,onSave,onExport,onPad,onGesture,onClear
}) {
  const [drawing,setDrawing]=useState(null);
  const [trails,setTrails]=useState([]);
  const [lastPad,setLastPad]=useState('');
  const drawRef=useRef(null);
  const padRef=useRef(null);
  const section=flowSectionAt(playhead,sections,bpm,duration);
  const beatLength=60/Math.max(40,bpm);
  const beatProgress=duration?((playhead-section.start)/beatLength)%4:0;
  const barProgress=(playhead-section.start)/Math.max(0.1,section.end-section.start);
  const flowTracks=tracks.filter(t=>t.flowKind);
  const heardCount=flowTracks.reduce((sum,t)=>sum+t.clips.filter(c=>!c.flowAuto).length,0);
  const loopCount=flowTracks.reduce((sum,t)=>sum+t.clips.filter(c=>c.flowAuto).length,0);

  useEffect(()=>{
    const onKey=e=>{
      if(e.repeat||e.altKey||e.ctrlKey||e.metaKey ||
         e.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
      const key=e.key.toLowerCase();
      const hit=FLOW_PADS.find(p=>p.key===key);
      if(hit){
        e.preventDefault();
        e.stopImmediatePropagation();
        if(playing){onPad(hit.kind);setLastPad(hit.kind);}
      }
      if(e.key==='Escape'){
        e.preventDefault();e.stopImmediatePropagation();onExit();
      }
    };
    window.addEventListener('keydown',onKey,true);
    return ()=>window.removeEventListener('keydown',onKey,true);
  },[onPad,onExit,playing]);

  const coords=e=>{
    const r=padRef.current.getBoundingClientRect();
    return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/Math.max(1,r.width))),
      y:Math.max(0,Math.min(1,(e.clientY-r.top)/Math.max(1,r.height))),at:performance.now()};
  };
  const onDown=e=>{
    if(!playing || e.button!==0)return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const points=[coords(e)];
    drawRef.current={id:e.pointerId,points};
    setDrawing(points);
  };
  const onMove=e=>{
    const active=drawRef.current;
    if(!active||active.id!==e.pointerId)return;
    const p=coords(e),previous=active.points.at(-1);
    if(active.points.length<220 && (Math.hypot(p.x-previous.x,p.y-previous.y)>0.006 || p.at-previous.at>45)){
      active.points.push(p);
      setDrawing([...active.points]);
    }
  };
  const onUp=e=>{
    const active=drawRef.current;
    if(!active||active.id!==e.pointerId)return;
    const points=[...active.points,coords(e)];
    drawRef.current=null;setDrawing(null);
    if(!playing)return;
    const gesture=classifyFlowGesture(points);
    if(gesture.kind==='tap'){
      const p=FLOW_PADS[Math.min(3,Math.floor(points[0].x*4))];
      onPad(p.kind);setLastPad(p.kind);
    } else {
      onGesture(points);
      setLastPad('gesture');
      setTrails(previous=>[...previous.slice(-3),{id:Date.now()+Math.random(),points}]);
    }
  };
  const sectionPercent=Math.max(0,Math.min(100,barProgress*100));
  return <section className="flow-mode">
    <div className="flow-top">
      <div className="flow-brand"><AudioLines size={23}/><span>bravery<span className="flow-period">.</span></span><strong>FLOW</strong></div>
      <div className="flow-top-actions">
        <button className="flow-quiet" onClick={onImport}><Upload size={17}/> <span>Import</span></button>
        <button className="flow-quiet" onClick={onSave} disabled={!duration}><Download size={17}/> <span>Save</span></button>
        <button className="flow-exit" onClick={onExit}><ArrowLeft size={17}/> Studio</button>
      </div>
    </div>
    <div className="flow-hero">
      <div className="flow-eyebrow"><span className={'flow-live-dot '+(playing?'on':'')}/> {playing?'LIVE PERFORMANCE':'READY WHEN YOU ARE'} <span className="flow-eyebrow-divider">·</span> {Math.round(bpm)} BPM</div>
      <h1>Don't edit. <em>Feel it.</em></h1>
      <p>The song keeps moving. Tap a rhythm, draw a sound, and Bravery learns your groove for this part.</p>
    </div>
    <div className="flow-transport">
      <button className="flow-play" onClick={onPlay} disabled={!duration} aria-label={playing?'Pause song':'Play song'}>
        {playing?<Pause size={22} fill="currentColor"/>:<Play size={22} fill="currentColor"/>}
      </button>
      <div className="flow-track-progress">
        <div className="flow-track-top"><strong>{section.name}</strong><span>{formatTime(playhead)} / {formatTime(duration)}</span></div>
        <div className="flow-progress"><span style={{width:(duration?playhead/duration*100:0)+'%'}}/></div>
        <div className="flow-beats" aria-label="Current beat">{[0,1,2,3].map(i=><span key={i} className={Math.floor(Math.max(0,beatProgress))===i&&playing?'lit':''}/>)}</div>
      </div>
      <span className="flow-save-info">{heardCount} gestures / hits<br/>{loopCount} learned repeats</span>
    </div>
    <div className="flow-stage-head"><div><strong>THE CANVAS</strong><span>Draw a sweep · scribble a texture · click to drop a beat</span></div><span className="flow-stage-index">01 / LIVE</span></div>
    <div className={'flow-canvas '+(!playing?'flow-idle':'')} ref={padRef}
      role="button" tabIndex={0} aria-label="Draw a sound while playing; press Enter for a kick"
      onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(playing)onPad('kick');}}}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={()=>{drawRef.current=null;setDrawing(null);}}>
      <svg className="flow-canvas-lines" viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true">
        {Array.from({length:9},(_,i)=><line key={'v'+i} x1={i*125} y1="0" x2={i*125} y2="400"/>)}
        {Array.from({length:5},(_,i)=><line key={'h'+i} x1="0" y1={i*100} x2="1000" y2={i*100}/>)}
        <line className="flow-beat-cursor" x1={beatProgress/4*1000} x2={beatProgress/4*1000} y1="0" y2="400"/>
      </svg>
      <svg className="flow-drawings" viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true">
        {trails.map(t=><path key={t.id} className="flow-trail" d={gesturePath(t.points)}/>)}
        {drawing&&<path className="flow-current-stroke" d={gesturePath(drawing)}/>}
      </svg>
      {!drawing&&<div className="flow-canvas-center"><Sparkles size={24}/><strong>{!duration?'Drop a song to begin':!playing?'Press play to start drawing':'Your movement is the instrument'}</strong><span>{playing?'Up = rising pitch · Down = falling pitch · Fast scribbles = grit':'Your audio stays in the browser'}</span></div>}
      <div className="flow-canvas-bottom"><span>DRAW / TAP</span><div className="flow-section-bar"><span style={{width:sectionPercent+'%'}}/></div><span>PART {Math.floor(sectionPercent)}%</span></div>
    </div>
    <div className="flow-pads-title"><div><strong>PLAY THE SONG</strong><span>Keys A S D F · tap as naturally as you would on a DJ desk</span></div><span>{status?.mode==='pulse'?'PULSE LOCKED':status?.mode==='phrase'?'PHRASE LEARNED':'LISTENING'}</span></div>
    <div className="flow-pads">
      {FLOW_PADS.map(p=><button key={p.key} className={'flow-pad flow-pad-'+p.kind+(lastPad===p.kind?' flow-pad-last':'')}
        onClick={()=>{if(playing){onPad(p.kind);setLastPad(p.kind);}}}
        disabled={!playing} style={{'--pad-color':COLORS[p.kind]}}>
        <span className="flow-pad-key">{p.key.toUpperCase()}</span><strong>{p.label}</strong><span className="flow-pad-hint">{p.hint}</span>
      </button>)}
    </div>
    <div className="flow-footer">
      <div className="flow-intelligence"><span className={'flow-intelligence-light '+(loopCount?'is-on':'')}/><span>{status?.message||'Play four hits on a pad. Bravery will continue the rhythm until the current section ends.'}</span></div>
      <div className="flow-footer-actions">
        <button type="button" className="flow-quiet" disabled={!flowTracks.length} onClick={onClear}><RotateCcw size={15}/> Clear Flow</button>
        <button type="button" className="flow-export" disabled={!duration} onClick={onExport}><Download size={16}/> Export mix</button>
      </div>
    </div>
  </section>;
}
