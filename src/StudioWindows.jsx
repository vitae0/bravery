import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AudioLines, BarChart3, ChevronDown, CircleHelp, Disc3, Download,
  GripVertical, Layers, LayoutPanelLeft, ListMusic, Mic2, Music2, Pause, Piano,
  Play, Plus, RefreshCw, Search, Settings2, SlidersHorizontal, Sparkles, Trash2,
  WandSparkles, Waves, X, Zap
} from 'lucide-react';
import { EFFECTS, SOUNDS } from './catalog.js';
import { bpmAt, signalStats, spectrum } from './studio.js';
import { formatTime } from './audio.js';

export const PANEL_TITLES={
  'mixer':'Mixer','piano':'Piano Roll','tempo':'Tempo Map','sections':'Song Sections',
  'bass':'Bass Lab','noise':'Noise Reduction','sound':'Sound Editor',
  'effects':'Effects Rack','settings':'Studio Settings','recurrence':'Periodic FX'
};
export const PANEL_ICONS={
  mixer:SlidersHorizontal,piano:Piano,tempo:Activity,sections:Layers,bass:BarChart3,
  noise:Waves,sound:Music2,effects:WandSparkles,settings:Settings2,recurrence:RefreshCw
};
const uid=()=>crypto.randomUUID();
const range=(n)=>Array.from({length:n},(_,i)=>i);
const clip=(a,b,c)=>Math.max(b,Math.min(c,a));
const Parameter=({label,value,min,max,step=1,onChange,unit='',hint=''})=><label className="parameter">
  <span><strong>{label}</strong><small title={hint}>{Number(value).toFixed(step<1?step<0.01?2:1:0)}{unit}</small></span>
  <input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))}/>
</label>;
const Select=({label,value,options,onChange})=><label className="panel-field"><span>{label}</span>
  <select value={value} onChange={e=>onChange(e.target.value)}>{options.map(v=>typeof v==='string'?<option key={v}>{v}</option>:<option key={v.value} value={v.value}>{v.label}</option>)}</select>
</label>;
const Numeric=({label,value,onChange,min=0,max=999,step=1})=><label className="panel-field"><span>{label}</span>
  <input type="number" min={min} max={max} step={step} value={value} onChange={e=>onChange(clip(Number(e.target.value)||0,min,max))}/>
</label>;
const Action=({onClick,children,disabled=false})=><button type="button" className="panel-action" onClick={onClick} disabled={disabled}>{children}</button>;

export function ViewMenu({onOpen,remixOpen,setRemixOpen,onImport,onExport,onUndo,onRedo,onSave,onShortcut}) {
  const [menu,setMenu]=useState(null);
  const wrapper=useRef(null);
  useEffect(()=>{
    const onClick=(e)=>{if(!wrapper.current?.contains(e.target))setMenu(null);};
    const onKey=e=>{if(e.key==='Escape')setMenu(null);};
    document.addEventListener('pointerdown',onClick);window.addEventListener('keydown',onKey);
    return ()=>{document.removeEventListener('pointerdown',onClick);window.removeEventListener('keydown',onKey);};
  },[]);
  const entries={
    File:[
      ['Import audio',onImport],['Save project',onSave],['Export WAV',onExport]
    ],
    Edit:[
      ['Undo',onUndo],['Redo',onRedo],['Keyboard shortcuts',onShortcut]
    ],
    View:[
      [remixOpen?'✓ Remix panel':'Remix panel',()=>setRemixOpen(v=>!v)],
      ...Object.entries(PANEL_TITLES).map(([id,title])=>[title,()=>onOpen(id)])
    ],
    Tools:[
      ['Piano Roll',()=>onOpen('piano')],['Automatic BPM / tempo map',()=>onOpen('tempo')],
      ['Detect song sections',()=>onOpen('sections')],['Bass Mastering',()=>onOpen('bass')],
      ['Spectral Noise Reduction',()=>onOpen('noise')],['Periodic FX',()=>onOpen('recurrence')]
    ]
  };
  return <div className="app-menu-bar" ref={wrapper}>{Object.entries(entries).map(([name,items])=><div className="menu-group" key={name}>
    <button className={'menu-trigger '+(menu===name?'menu-open':'')} onClick={()=>setMenu(menu===name?null:name)}>{name}</button>
    {menu===name&&<div className="app-dropdown">{items.map(([title,action],i)=><button key={title+i} onClick={()=>{setMenu(null);action();}}>{title}</button>)}</div>}
  </div>)}</div>;
}

export function RemixDock({tracks,clipSelection,playhead,bpm,regions,sections,busy,onRemix,onPeriodic,onOpen,onClose}) {
  const [tool,setTool]=useState('hard-kick');
  const [every,setEvery]=useState(4);
  const [offset,setOffset]=useState(0);
  const [source,setSource]=useState('project');
  const [customBpm,setCustomBpm]=useState(150);
  const [intensity,setIntensity]=useState(0.84);
  const [swing,setSwing]=useState(0);
  const [start,setStart]=useState(0);
  const [finish,setFinish]=useState(0);
  const [mode,setMode]=useState('samples');
  const [effect,setEffect]=useState('bass-boost');
  const [width,setWidth]=useState(.5);
  const [mix,setMix]=useState(.75);
  const [humanize,setHumanize]=useState(0);
  const [pattern,setPattern]=useState('every');
  const selectedTrack=tracks.find(t=>t.id===clipSelection?.trackId);
  const chosenClip=selectedTrack?.clips.find(c=>c.id===clipSelection?.clipId);
  const effectDef=EFFECTS.find(e=>e.id===effect);
  const makeConfig=()=>({
    tool,every,offset,source,customBpm,bpm,intensity,swing,start,finish,
    effect:effectDef,width,mix,humanize,pattern,regions
  });
  return <aside className="remix-dock">
    <div className="dock-head"><div><span className="dock-eyebrow">PRODUCTION TOOLS</span><h2><Zap size={18}/> Remix Lab</h2></div><button title="Close remix panel" onClick={onClose}><X size={17}/></button></div>
    <div className="dock-scroll">
      <div className="remix-mode-tabs">
        <button className={mode==='samples'?'active':''} onClick={()=>setMode('samples')}>Beat layer</button>
        <button className={mode==='effects'?'active':''} onClick={()=>setMode('effects')}>Periodic FX</button>
      </div>
      <div className="dock-section">
        <div className="dock-section-title"><span>{mode==='samples'?'RHYTHM ELEMENT':'RECURRING AUDIO EFFECT'}</span><span className="dock-count">01</span></div>
        {mode==='samples'?<Select label="Sound" value={tool} onChange={setTool} options={SOUNDS.map(s=>({value:s.id,label:s.name}))}/>:
          <Select label="Effect" value={effect} onChange={setEffect} options={EFFECTS.map(s=>({value:s.id,label:s.name}))}/>}
        <div className="remix-presets">
          {[['Hardtekk · 4','hard-kick',4],['Hardstyle · 1','hard-kick',1],['Boom · 8','boom',8],['Clap · 2','clap',2]].map(([label,id,n])=><button key={label} onClick={()=>{setMode('samples');setTool(id);setEvery(n);}}>{label}</button>)}
        </div>
      </div>
      <div className="dock-section">
        <div className="dock-section-title"><span>BEAT SEQUENCER</span><span className="dock-count">02</span></div>
        <Select label="Timing" value={source} onChange={setSource} options={[{value:'project',label:'Auto · Header BPM ('+bpm+')'}, {value:'map',label:'Detected tempo map'}, {value:'custom',label:'Custom BPM'}]}/>
        {source==='custom'&&<Numeric label="Custom BPM" value={customBpm} min={40} max={240} onChange={setCustomBpm}/>}
        {source==='map'&&!regions.length&&<div className="panel-hint">No tempo map. Open Tempo Map to analyze the song.</div>}
        <Select label="Pattern" value={pattern} onChange={setPattern} options={[{value:'every',label:'Every N beats'}, {value:'offbeat',label:'Off-beat / syncopation'}, {value:'alternating',label:'Alternate accents'}]}/>
        <div className="remix-big-count">
          <span>REPEAT EVERY</span><div><button onClick={()=>setEvery(v=>Math.max(1,v-1))}>−</button><strong>{every}</strong><button onClick={()=>setEvery(v=>Math.min(64,v+1))}>+</button><small>beats</small></div>
        </div>
        <Parameter label="Beat offset" value={offset} min={0} max={16} onChange={setOffset}/>
        <Parameter label="Swing" value={swing} min={0} max={70} unit="%" onChange={setSwing}/>
        <Parameter label="Humanize" value={humanize} min={0} max={35} unit="ms" onChange={setHumanize}/>
      </div>
      <div className="dock-section">
        <div className="dock-section-title"><span>CHARACTER</span><span className="dock-count">03</span></div>
        <Parameter label="Intensity" value={intensity} min={0.05} max={2} step={0.05} onChange={setIntensity} unit="×"/>
        {mode==='effects'&&<>
          <Parameter label="FX wet mix" value={mix} min={0.05} max={1} step={.05} onChange={setMix} unit="×"/>
          <Parameter label="FX length (beats)" value={width} min={.125} max={4} step={.125} onChange={setWidth}/>
        </>}
        <div className="field-pair">
          <Numeric label="Start (sec)" value={start} max={36000} step={.25} onChange={setStart}/>
          <Numeric label="End (0 = song)" value={finish} max={36000} step={.25} onChange={setFinish}/>
        </div>
      </div>
      <div className="dock-section">
        <div className="dock-section-title"><span>ADVANCED TOOLS</span><span className="dock-count">04</span></div>
        <div className="tool-grid">
          <button onClick={()=>onOpen('piano')}><Piano size={16}/> Piano</button>
          <button onClick={()=>onOpen('tempo')}><Activity size={16}/> Tempo map</button>
          <button onClick={()=>onOpen('bass')}><BarChart3 size={16}/> Bass Lab</button>
          <button onClick={()=>onOpen('sections')}><Layers size={16}/> Sections</button>
          <button onClick={()=>onOpen('noise')}><Waves size={16}/> Denoise</button>
          <button onClick={()=>onOpen('mixer')}><SlidersHorizontal size={16}/> Mixer</button>
        </div>
      </div>
    </div>
    <div className="dock-footer">
      <div className="remix-ready"><span className="status-dot"/> {mode==='effects'?(chosenClip?'Selected '+chosenClip.name:'Select a clip for periodic FX'):'Independent beat layer'}</div>
      <button className="remix-apply" disabled={busy||(mode==='effects'&&!chosenClip)} onClick={()=>mode==='samples'?onRemix(makeConfig()):onPeriodic(makeConfig())}><Zap size={17}/>{mode==='samples'?'Generate beat layer':'Apply periodic effect'}</button>
    </div>
  </aside>;
}

function DraggableWindow({id,index,onClose,onFocus,children,position}){
  const Icon=PANEL_ICONS[id]||SlidersHorizontal;
  const [pos,setPos]=useState(position||{x:180+index*25,y:130+index*20});
  const dragging=useRef(false);
  const begin=e=>{
    if(e.button!==0||e.target.closest('button'))return;
    e.preventDefault();onFocus();
    dragging.current={x:e.clientX,y:e.clientY,px:pos.x,py:pos.y};
    const move=ev=>{if(!dragging.current)return;setPos({x:clip(dragging.current.px+ev.clientX-dragging.current.x,0,innerWidth-260),y:clip(dragging.current.py+ev.clientY-dragging.current.y,68,innerHeight-80)});};
    const stop=()=>{dragging.current=false;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);};
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop,{once:true});
  };
  return <div className={'studio-window window-'+id} style={{left:pos.x,top:pos.y,zIndex:100+index}} onPointerDown={onFocus}>
    <div className="studio-window-title" onPointerDown={begin}><div><Icon size={16}/><strong>{PANEL_TITLES[id]}</strong></div><span className="window-drag-hint"><GripVertical size={15}/></span><button title="Close window" onClick={onClose}><X size={17}/></button></div>
    <div className="studio-window-body">{children}</div>
  </div>;
}

function Mixer({tracks,onTrackEdit}){
  const max=Math.max(1,tracks.length);
  return <div className="mixer-columns">
    {tracks.length?tracks.map(t=><div className="mixer-strip" key={t.id}>
      <div className="mixer-track-title"><span style={{background:t.color}}/>{t.name}</div>
      <div className="mixer-meter"><i style={{height:(t.muted?2:15+(t.gain||0)*36)+'%'}}/></div>
      <input className="vertical-fader" type="range" min="0" max="2" step=".02" value={t.gain} aria-label={t.name+' mixer volume'} onChange={e=>onTrackEdit(t.id,{gain:Number(e.target.value)})}/>
      <strong>{Math.round(20*Math.log10(Math.max(.00001,t.gain)))} dB</strong>
      <Parameter label="Pan" min={-1} max={1} step={.05} value={t.pan||0} onChange={pan=>onTrackEdit(t.id,{pan})}/>
      <div className="mixer-ms"><button className={t.muted?'on':''} onClick={()=>onTrackEdit(t.id,{muted:!t.muted})}>M</button><button className={t.solo?'on':''} onClick={()=>onTrackEdit(t.id,{solo:!t.solo})}>S</button></div>
    </div>):<div className="panel-hint">Import audio to populate the mixer.</div>}
  </div>;
}

const NOTE_NAMES=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const noteLabel=midi=>NOTE_NAMES[midi%12]+(Math.floor(midi/12)-1);
function PianoRoll({bpm,onGenerate}){
  const [notes,setNotes]=useState([]);
  const [bars,setBars]=useState(4);
  const [instrument,setInstrument]=useState('synth');
  const [velocity,setVelocity]=useState(100);
  const [length,setLength]=useState(2);
  const [swing,setSwing]=useState(0);
  const [localBpm,setLocalBpm]=useState(bpm);
  const [root,setRoot]=useState(60);
  const steps=bars*16;
  const pitches=range(36).map(i=>root+23-i);
  const addNote=(step,midi)=>{
    setNotes(old=>{
      const exists=old.find(n=>n.step===step&&n.midi===midi);
      if(exists)return old.filter(n=>n!==exists);
      return [...old,{id:uid(),step,midi,length,velocity}];
    });
  };
  const preset=(type)=>{
    if(type==='clear'){setNotes([]);return;}
    const rootMidi=root+12;
    const melody=[];
    for(let i=0;i<bars;i++){
      if(type==='chords'){
        for(const midi of [rootMidi,rootMidi+4,rootMidi+7])
          melody.push({id:uid(),midi,step:i*16,length:12,velocity:85});
      }else if(type==='bass'){
        for(let j=0;j<4;j++)melody.push({id:uid(),midi:root,step:i*16+j*4,length:3,velocity:110});
      }else if(type==='arp'){
        for(let j=0;j<8;j++)melody.push({id:uid(),midi:[rootMidi,rootMidi+4,rootMidi+7,rootMidi+12][j%4],step:i*16+j*2,length:2,velocity:95});
      }
    }
    setNotes(melody);
  };
  return <div className="piano-panel">
    <div className="panel-row wrap">
      <Select label="Instrument" value={instrument} onChange={setInstrument} options={['synth','bass','pluck','pad']}/>
      <Numeric label="BPM" min={40} max={240} value={localBpm} onChange={setLocalBpm}/>
      <Numeric label="Bars" min={1} max={8} value={bars} onChange={n=>{setBars(n);setNotes(old=>old.filter(note=>note.step<n*16));}}/>
      <Numeric label="Root MIDI" min={24} max={72} value={root} onChange={setRoot}/>
    </div>
    <div className="panel-row wrap">
      <Parameter label="Velocity" min={1} max={127} value={velocity} onChange={setVelocity}/>
      <Parameter label="Length (16ths)" min={1} max={16} value={length} onChange={setLength}/>
      <Parameter label="Swing" min={0} max={.8} step={.05} value={swing} onChange={setSwing}/>
    </div>
    <div className="piano-quick"><button onClick={()=>preset('chords')}>Generate chords</button><button onClick={()=>preset('bass')}>Bass line</button><button onClick={()=>preset('arp')}>Arpeggio</button><button onClick={()=>preset('clear')}>Clear notes</button></div>
    <div className="piano-scroll"><div className="piano-grid" style={{gridTemplateColumns:'65px repeat('+steps+',24px)',width:65+steps*24}}>
      {pitches.map(midi=><div className="piano-row" key={midi} style={{display:'contents'}}>
        <div className={'piano-key '+([1,3,6,8,10].includes(midi%12)?'black-key':'')} title={noteLabel(midi)}>{noteLabel(midi)}</div>
        {range(steps).map(step=>{
          const found=notes.find(n=>n.step===step&&n.midi===midi);
          return <button key={step} title={found?'Remove '+noteLabel(midi):'Add '+noteLabel(midi)}
            className={'piano-cell '+(step%16===0?'bar-start ':'')+(step%4===0?'beat-start ':'')+(found?'note-on':'')}
            onClick={()=>addNote(step,midi)}>{found&&<span style={{width:Math.max(1,Math.min(found.length,steps-step))*24-2}}/>}</button>;
        })}
      </div>)}
    </div></div>
    <div className="panel-footline">{notes.length} notes · Click a cell to draw/remove a note. Length sets the next note.</div>
    <Action onClick={()=>onGenerate(notes,{instrument,bars,bpm:localBpm,swing,gain:.8})} disabled={!notes.length}><Plus size={16}/> Add melody to timeline</Action>
  </div>;
}
function TempoPanel({tracks,regions,bpm,onAnalyze,onUpdate,onAdd,onRemove,busy}){
  return <div className="tempo-panel">
    <div className="panel-banner"><Activity size={20}/><span><strong>Tempo map</strong><small>Detect tempo changes across the track. Local sections can have different BPM values.</small></span></div>
    <Action disabled={busy||!tracks.some(t=>t.clips.length)} onClick={onAnalyze}><RefreshCw size={15}/> Detect BPM + changing tempo</Action>
    <div className="tempo-visual">{(regions.length?regions:[{start:0,end:10,bpm}]).map((r,i)=><div key={r.id||i} style={{flex:Math.max(.5,r.end-r.start),background:['#816ac0','#6a90c7','#cb9172','#9670bb'][i%4]}} title={r.bpm+' BPM · '+formatTime(r.start)+'–'+formatTime(r.end)}><strong>{r.bpm}</strong></div>)}</div>
    <div className="tempo-list">
      {regions.length?regions.map((r,i)=><div className="tempo-row" key={r.id}>
        <span>#{i+1}</span><Numeric label="Start" value={r.start} max={36000} step={.5} onChange={v=>onUpdate(r.id,{start:v})}/>
        <Numeric label="End" value={r.end} max={36000} step={.5} onChange={v=>onUpdate(r.id,{end:v})}/>
        <Numeric label="BPM" min={40} max={240} step={.1} value={r.bpm} onChange={v=>onUpdate(r.id,{bpm:v})}/>
        <button title="Delete tempo region" onClick={()=>onRemove(r.id)}><Trash2 size={15}/></button>
      </div>):<p className="panel-hint">The header BPM is currently the project tempo. Scan a track to create separate tempo regions.</p>}
    </div>
    <Action onClick={onAdd}><Plus size={15}/> Add custom tempo region</Action>
    <p className="panel-hint">Estimates use onset autocorrelation. Verify complex music manually; double/half-time ambiguity is normal.</p>
  </div>;
}
function SectionsPanel({sections,onDetect,onUpdate,onRemove,onAdd,tracks,busy,onJump}){
  return <div>
    <div className="panel-banner"><Layers size={21}/><span><strong>Song sections</strong><small>Detect arrangement changes and label verse / chorus / drop / bridge.</small></span></div>
    <Action disabled={busy||!tracks.some(t=>t.clips.length)} onClick={onDetect}><Sparkles size={16}/> Analyze and segment song</Action>
    <div className="section-bar">{sections.map(s=><button key={s.id} style={{background:s.color,flex:Math.max(0.1,s.end-s.start)}} onClick={()=>onJump(s.start)} title={s.name+' '+formatTime(s.start)}/> )}</div>
    <div className="tempo-list">{sections.map(s=><div className="tempo-row" key={s.id}>
      <input className="section-title-input" value={s.name} onChange={e=>onUpdate(s.id,{name:e.target.value})}/>
      <Numeric label="From" value={s.start} max={36000} step={.25} onChange={v=>onUpdate(s.id,{start:v})}/>
      <Numeric label="To" value={s.end} max={36000} step={.25} onChange={v=>onUpdate(s.id,{end:v})}/>
      <button title="Jump to section" onClick={()=>onJump(s.start)}><Play size={14}/></button>
      <button title="Remove section" onClick={()=>onRemove(s.id)}><Trash2 size={14}/></button>
    </div>)}</div>
    <Action onClick={onAdd}><Plus size={15}/> Add manual section</Action>
    <p className="panel-hint">Sections are change-point suggestions, not semantic voice recognition. Rename detected sections to match the song.</p>
  </div>;
}
function SpectrumGraph({buffer,eq}){
  const values=useMemo(()=>spectrum(buffer),[buffer]);
  return <div className="spectrum-graph">
    <div className="spectrum-guides"><span>+12</span><span>0 dB</span><span>−24</span><span>−48</span></div>
    {values.map((v,i)=><div className="spectrum-band" key={v.freq}><div className="spectrum-stick" style={{height:(Math.max(0,90+v.db)/90*100)+'%'}}/>
      <div className="spectrum-label">{v.freq>=1000?Math.round(v.freq/1000)+'k':v.freq}</div></div>)}
    <svg className="eq-curve" viewBox="0 0 600 120" preserveAspectRatio="none" aria-label="EQ curve">
      <polyline fill="none" stroke="#f1be8f" strokeWidth="2.6" points={(eq||[0,0,0,0,0,0]).map((db,i)=>[i*120,60-db*3]).join(' ')}/>
    </svg>
  </div>;
}
function BassPanel({buffer,onApply,busy}){
  const [settings,setSettings]=useState({sub:4,bass:5,lowMid:-2,body:0,presence:0,air:0,targetDb:-11,ceilingDb:-1,compress:.5,highpass:24});
  const stats=useMemo(()=>signalStats(buffer),[buffer]);
  const eq=[settings.sub,settings.bass,settings.lowMid,settings.body,settings.presence,settings.air];
  const set=(key,n)=>setSettings(old=>({...old,[key]:n}));
  return <div className="bass-panel">
    <div className="panel-banner"><BarChart3 size={20}/><span><strong>Sub & Bass Mastering</strong><small>Six-band tone controls with compression, RMS targeting and output ceiling.</small></span></div>
    <SpectrumGraph buffer={buffer} eq={eq}/>
    <div className="bass-stats"><div><strong>{stats.db.toFixed(1)}</strong><span>INPUT RMS dBFS</span></div><div><strong>{(20*Math.log10(Math.max(.0001,stats.peak))).toFixed(1)}</strong><span>INPUT PEAK</span></div><div><strong>{stats.crest.toFixed(1)}</strong><span>CREST FACTOR</span></div></div>
    <div className="bass-grid">
      {[
        ['sub','Sub · 50 Hz',-18,18,1,' dB'],['bass','Bass · 110 Hz',-18,18,1,' dB'],['lowMid','Low-mid · 290 Hz',-18,18,1,' dB'],
        ['body','Body · 750 Hz',-18,18,1,' dB'],['presence','Presence · 3.3 kHz',-18,18,1,' dB'],['air','Air · 9.5 kHz',-18,18,1,' dB'],
        ['compress','Compression',0,1,.05,'×'],['highpass','Sub cut',10,60,1,' Hz'],
        ['targetDb','Target RMS',-22,-6,1,' dB'],['ceilingDb','Peak ceiling',-6,-.1,.1,' dB']
      ].map(([id,title,min,max,step,unit])=><Parameter key={id} label={title} value={settings[id]} min={min} max={max} step={step} unit={unit} onChange={v=>set(id,v)}/>)}
    </div>
    <div className="piano-quick">{[['Warm', {sub:3,bass:4,lowMid:1,body:1,presence:0,air:-1}],['Hardtekk',{sub:6,bass:8,lowMid:-4,body:-2,presence:3,air:1,compress:.75}],['Clean', {sub:0,bass:1,lowMid:-2,body:0,presence:1,air:2,compress:.35}],['Flat',{sub:0,bass:0,lowMid:0,body:0,presence:0,air:0}]].map(([title,changes])=><button key={title} onClick={()=>setSettings(o=>({...o,...changes}))}>{title}</button>)}</div>
    <Action disabled={busy||!buffer} onClick={()=>onApply(settings)}><WandSparkles size={16}/> Render bass master to selected clip</Action>
    <p className="panel-hint">Target is approximate RMS, not EBU R128 integrated LUFS. Hard peak ceiling uses sample clipping, not true-peak limiting.</p>
  </div>;
}
function NoisePanel({buffer,onApply,busy}){
  const [reduction,setReduction]=useState(.7);
  const [floor,setFloor]=useState(.12);
  const [smoothing,setSmoothing]=useState(.75);
  const [seconds,setSeconds]=useState(.8);
  return <div>
    <div className="panel-banner"><Waves size={20}/><span><strong>Spectral noise reduction</strong><small>STFT, quiet-frame noise profiling and weighted overlap-add.</small></span></div>
    <Parameter label="Reduction strength" min={0} max={1} step={.05} value={reduction} onChange={setReduction}/>
    <Parameter label="Spectral floor" min={0} max={.6} step={.02} value={floor} onChange={setFloor}/>
    <Parameter label="Smoothing" min={0} max={.97} step={.01} value={smoothing} onChange={setSmoothing}/>
    <Parameter label="Profile window" min={.2} max={3} step={.2} value={seconds} unit="s" onChange={setSeconds}/>
    <Action disabled={!buffer||busy} onClick={()=>onApply({reduction,floor,smoothing,profileSeconds:seconds})}><Waves size={15}/> Reduce noise on selected clip</Action>
    <p className="panel-hint">Works best on steady hiss and hum. Strong reduction may introduce musical artifacts. The noise profile uses the quietest frames of the initial window. Undo reverses the change.</p>
  </div>;
}
function SoundPanel({activeClip,onSoundEdit,onApply,busy,onOpen}){
  const [gain,setGain]=useState(0);
  const [speed,setSpeed]=useState(1);
  const [fadeIn,setFadeIn]=useState(0);
  const [fadeOut,setFadeOut]=useState(0);
  const [reverse,setReverse]=useState(false);
  const [normalize,setNormalize]=useState(false);
  const [trimStart,setTrimStart]=useState(0);
  const [trimEnd,setTrimEnd]=useState(0);
  useEffect(()=>{setTrimStart(0);setTrimEnd(0);setGain(0);setSpeed(1);setFadeIn(0);setFadeOut(0);setReverse(false);setNormalize(false);},[activeClip?.id]);
  return <div>
    <div className="panel-banner"><Music2 size={19}/><span><strong>{activeClip?.name||'No clip selected'}</strong><small>{activeClip?'Clip length '+formatTime(activeClip.duration):'Right-click or select a clip.'}</small></span></div>
    <Parameter label="Gain" min={-24} max={24} step={.5} value={gain} unit=" dB" onChange={setGain}/>
    <Parameter label="Playback speed" min={.5} max={2} step={.05} value={speed} unit="×" onChange={setSpeed}/>
    <Parameter label="Fade in" min={0} max={4} step={.1} value={fadeIn} unit="s" onChange={setFadeIn}/>
    <Parameter label="Fade out" min={0} max={4} step={.1} value={fadeOut} unit="s" onChange={setFadeOut}/>
    <div className="field-pair">
      <Numeric label="Trim start" min={0} max={activeClip?.duration||60} step={.05} value={trimStart} onChange={setTrimStart}/>
      <Numeric label="Trim end" min={0} max={activeClip?.duration||60} step={.05} value={trimEnd} onChange={setTrimEnd}/>
    </div>
    <label className="checkbox-row"><input type="checkbox" checked={reverse} onChange={e=>setReverse(e.target.checked)}/> Reverse sound</label>
    <label className="checkbox-row"><input type="checkbox" checked={normalize} onChange={e=>setNormalize(e.target.checked)}/> Normalize first</label>
    <Action disabled={!activeClip||busy} onClick={()=>onSoundEdit({gain,speed,fadeIn,fadeOut,reverse,normalize,trimStart,trimEnd})}><WandSparkles size={16}/> Apply clip edits</Action>
    <div className="panel-hint">Edits render a new audio buffer. Undo restores the original clip.</div>
    <button className="text-link" onClick={()=>onOpen('effects')}>Explore effects and intensity controls →</button>
  </div>;
}
function EffectPanel({activeClip,onApply,busy,onPeriodicOpen}){
  const [query,setQuery]=useState('');
  const [id,setId]=useState('bass-boost');
  const [intensity,setIntensity]=useState(1);
  const effect=EFFECTS.find(e=>e.id===id);
  return <div className="effect-inspector">
    <div className="panel-banner"><WandSparkles size={20}/><span><strong>Advanced effects</strong><small>Choose an effect, adjust strength, then process a clip.</small></span></div>
    <input className="panel-search" placeholder="Search effect..." value={query} onChange={e=>setQuery(e.target.value)}/>
    <div className="fx-picker">{EFFECTS.filter(e=>(e.name+' '+e.category).toLowerCase().includes(query.toLowerCase())).map(e=><button className={id===e.id?'selected':''} key={e.id} onClick={()=>setId(e.id)}>{e.name}<small>{e.category}</small></button>)}</div>
    <div className="fx-selected"><strong>{effect?.name}</strong><small>{effect?.detail}</small></div>
    <Parameter label="Effect intensity" min={.05} max={2} step={.05} value={intensity} onChange={setIntensity} unit="×"/>
    <Action disabled={!activeClip||busy} onClick={()=>onApply(effect,intensity)}><Zap size={16}/> Apply to selected clip</Action>
    <button className="text-link" onClick={onPeriodicOpen}>Repeat this effect every N beats →</button>
  </div>;
}
function SettingsPanel({settings,onSettings,bpm,onSetBpm}){
  return <div>
    <div className="panel-banner"><Settings2 size={20}/><span><strong>Session preferences</strong><small>Settings remain local to this open browser session.</small></span></div>
    <Numeric label="Project BPM" min={40} max={240} value={bpm} onChange={onSetBpm}/>
    <label className="checkbox-row"><input type="checkbox" checked={settings.snapToGrid} onChange={e=>onSettings({snapToGrid:e.target.checked})}/> Snap edits to beat grid</label>
    <label className="checkbox-row"><input type="checkbox" checked={settings.autoOpenEditor} onChange={e=>onSettings({autoOpenEditor:e.target.checked})}/> Open Sound Editor when selecting a clip</label>
    <label className="checkbox-row"><input type="checkbox" checked={settings.confirmDestructive} onChange={e=>onSettings({confirmDestructive:e.target.checked})}/> Confirm destructive processing</label>
    <p className="panel-hint">Browser processing is local. Changes should be saved as a .bravery project before leaving the page.</p>
  </div>;
}
function PeriodicPanel({onOpenRemix}){
  return <div className="panel-banner"><RefreshCw size={20}/><span><strong>Periodic audio processing</strong><small>Use the Remix Lab's Periodic FX tab. Select a clip, an effect, a repetition interval, wet mix and window size.</small>
    <button className="text-link" onClick={onOpenRemix}>Open the right Remix Lab →</button></span></div>;
}
export function WindowLayer({windows,onClose,onFocus,tracks,bpm,setBpm,activeClip,regions,sections,
  onTrackEdit,onGeneratePiano,onAnalyzeTempo,onUpdateTempo,onAddTempo,onRemoveTempo,
  onDetectSections,onUpdateSection,onRemoveSection,onAddSection,onJump,onMaster,onDenoise,onSoundEdit,onEffect,
  busy,settings,onSettings,onOpen,onOpenRemix}){
  const buffer=activeClip?.buffer;
  const positions={piano:{x:140,y:115},mixer:{x:245,y:150},tempo:{x:310,y:125},sections:{x:360,y:140},
    bass:{x:250,y:90},noise:{x:390,y:165},sound:{x:450,y:130},effects:{x:350,y:110},
    settings:{x:490,y:140},recurrence:{x:550,y:180}};
  return <div className="floating-window-layer">{windows.map((w,i)=><DraggableWindow key={w.id} id={w.id} index={i} position={positions[w.id]} onClose={()=>onClose(w.id)} onFocus={()=>onFocus(w.id)}>
    {w.id==='mixer'&&<Mixer tracks={tracks} onTrackEdit={onTrackEdit}/>}
    {w.id==='piano'&&<PianoRoll bpm={bpm} onGenerate={onGeneratePiano}/>}
    {w.id==='tempo'&&<TempoPanel tracks={tracks} regions={regions} bpm={bpm} onAnalyze={onAnalyzeTempo} onUpdate={onUpdateTempo} onAdd={onAddTempo} onRemove={onRemoveTempo} busy={busy}/>}
    {w.id==='sections'&&<SectionsPanel sections={sections} onDetect={onDetectSections} onUpdate={onUpdateSection} onRemove={onRemoveSection} onAdd={onAddSection} tracks={tracks} busy={busy} onJump={onJump}/>}
    {w.id==='bass'&&<BassPanel buffer={buffer} onApply={onMaster} busy={busy}/>}
    {w.id==='noise'&&<NoisePanel buffer={buffer} onApply={onDenoise} busy={busy}/>}
    {w.id==='sound'&&<SoundPanel activeClip={activeClip} onSoundEdit={onSoundEdit} onOpen={onOpen} busy={busy}/>}
    {w.id==='effects'&&<EffectPanel activeClip={activeClip} onApply={onEffect} onPeriodicOpen={()=>onOpen('recurrence')} busy={busy}/>}
    {w.id==='settings'&&<SettingsPanel settings={settings} onSettings={onSettings} bpm={bpm} onSetBpm={setBpm}/>}
    {w.id==='recurrence'&&<PeriodicPanel onOpenRemix={onOpenRemix}/>}
  </DraggableWindow>)}</div>;
}
