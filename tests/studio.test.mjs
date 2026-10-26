import test from 'node:test';
import assert from 'node:assert/strict';
import { connectMixTrack } from '../src/audio.js';
import { bpmAt, buildDrumEvents, timelineBeats, splitClipIntoSections } from '../src/studio.js';
import { CATEGORIES, EFFECTS, SOUNDS } from '../src/catalog.js';

test('beat grid repeats one event every four beats',()=>{
  const events=timelineBeats(0,8,{source:'project',bpm:120,every:4,offset:0});
  assert.deepEqual(events.map(e=>e.time),[0,2,4,6]);
});

test('hardtekk four beat default remains 4 beats long',()=>{
  const events=timelineBeats(0,8,{source:'custom',customBpm:180,every:4});
  assert.equal(events.length,6);
  assert.ok(Math.abs(events[1].time-(4*60/180))<1e-6);
});

test('separate local tempi produce a segmented beat grid',()=>{
  const regions=[{start:0,end:4,bpm:120},{start:4,end:8,bpm:160}];
  const events=timelineBeats(0,8,{source:'map',regions,every:4});
  assert.equal(events.length,5);
  assert.deepEqual(events.map(e=>e.bpm),[120,120,160,160,160]);
  assert.ok(Math.abs(events[3].time-5.5)<1e-6);
});

test('manual offset applies to beat schedule',()=>{
  const events=timelineBeats(0,5,{source:'project',bpm:120,every:4,offset:1});
  assert.deepEqual(events.map(e=>e.time),[.5,2.5,4.5]);
});

test('tempo at sample time uses region and falls back to project BPM',()=>{
  const regions=[{start:3,end:9,bpm:174}];
  assert.equal(bpmAt(0,regions,150),150);
  assert.equal(bpmAt(5,regions,150),174);
});

test('drum machine makes repeats in distinct bars',()=>{
  const pattern={'hard-kick':[1,...Array(15).fill(0)],'clap':[0,0,0,0,1,...Array(11).fill(0)]};
  const events=buildDrumEvents(pattern,{bars:3,bpm:120});
  assert.equal(events.length,6);
  assert.deepEqual(events.map(e=>e.id),['hard-kick','clap','hard-kick','clap','hard-kick','clap']);
  assert.ok(Math.abs(events[2].time-2)<1e-8);
});

test('sequencer swing offsets alternate 16th note',()=>{
  const pattern={'hat':[1,1,...Array(14).fill(0)]};
  const events=buildDrumEvents(pattern,{bars:1,bpm:120,swing:.5});
  assert.equal(events.length,2);
  assert.ok(Math.abs(events[1].time-(.125+.0625))<1e-8);
});

test('effect and sound catalogs have unique identifiers',()=>{
  for(const data of [EFFECTS,SOUNDS]){
    assert.equal(new Set(data.map(item=>item.id)).size,data.length);
    assert.ok(data.every(item=>item.name&&item.category));
  }
  assert.ok(EFFECTS.length>=80);
});

test('all effects map to implemented Web Audio or sample operations',()=>{
  const supported=new Set([
    'filter','telephone','reverb','delay','chorus','phaser','tremolo',
    'distortion','compressor','gate','normalize','reverse','fadein','fadeout',
    'gain','mono','stereowiden','bitcrush','speed','pitch','autopitch','pump','stutter','transient'
  ]);
  for(const effect of EFFECTS){
    assert.ok(supported.has(effect.kind),effect.name+' has an unknown processor');
    assert.ok(CATEGORIES.includes(effect.category),effect.name+' has an unknown category');
  }
});

test('automation ramps are scheduled for both live and offline mixers',()=>{
  const calls=[];
  const fakeParam={setValueAtTime:(...args)=>calls.push(['set',...args]),linearRampToValueAtTime:(...args)=>calls.push(['ramp',...args])};
  const node=()=>({connect:()=>{},gain:fakeParam,pan:{value:0}});
  const context={destination:{},createGain:node,createStereoPanner:node};
  connectMixTrack(context,{
    gain:.8,pan:.2,automation:[{time:0,value:.25},{time:2,value:1},{time:3,value:.5}]
  },context.destination,0,0);
  assert.deepEqual(calls,[['set',.2,0],['ramp',.8,2],['ramp',.4,3]]);
});

test('structural splits preserve sample offsets and full source duration',()=>{
  const buffer={};
  const original={id:'original',name:'Song',buffer,start:5,offset:2,duration:12};
  let counter=0;
  const sections=[{start:0,end:10,name:'Verse'},{start:10,end:15,name:'Chorus'},{start:15,end:21,name:'Drop'}];
  const pieces=splitClipIntoSections(original,sections,()=>String(++counter));
  assert.equal(pieces.length,3);
  assert.deepEqual(pieces.map(c=>c.start),[5,10,15]);
  assert.deepEqual(pieces.map(c=>c.duration),[5,5,2]);
  assert.deepEqual(pieces.map(c=>c.offset),[2,7,12]);
  assert.ok(pieces.every(c=>c.buffer===buffer));
  assert.ok(Math.abs(pieces.reduce((sum,c)=>sum+c.duration,0)-original.duration)<1e-8);
});
