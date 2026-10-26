import test from 'node:test';
import assert from 'node:assert/strict';
import { alignBeatEvents, detectTransients, estimateBeatPhase } from '../src/beatSync.js';
import { timelineBeats } from '../src/studio.js';

const nearly=(a,b,eps=.038)=>assert.ok(Math.abs(a-b)<eps, 'Expected '+a+' close to '+b);

function pulses({bpm=120,phase=.137,length=12,rate=11025,weight=1}={}) {
  const samples=new Float32Array(Math.ceil(rate*length));
  const times=[];
  for(let time=phase; time<length-.15;time+=60/bpm) {
    times.push(time);
    const from=Math.floor(time*rate);
    for(let i=0;i<Math.floor(.035*rate);i++){
      const at=from+i;
      const x=i/rate;
      samples[at] += weight*Math.exp(-x*90)*Math.sin(i*.39);
    }
  }
  return {samples,times,rate};
}

test('attack detector identifies off-grid waveform spikes',()=>{
  const {samples,times,rate}=pulses();
  const peaks=detectTransients(samples,rate);
  assert.ok(peaks.length>=times.length-2, 'Detected too few transients: '+peaks.length);
  for(const time of times.slice(1,-1)){
    assert.ok(peaks.some(p=>Math.abs(p.time-time)<.038),'No transient near '+time);
  }
});

test('beat alignment corrects whole-grid phase and preserves N=4 spacing',()=>{
  const {samples,rate}=pulses();
  const peaks=detectTransients(samples,rate);
  const events=timelineBeats(0,11.5,{source:'project',bpm:120,every:4});
  const result=alignBeatEvents(events,peaks,{toleranceMs:150});
  assert.ok(result.aligned>2);
  nearly(result.events[1].time,2.137);
  nearly(result.events[2].time,4.137);
  nearly(result.events[3].time,6.137);
  assert.ok(events.every((e,i)=>e.time===i*2),'Original events should be immutable');
});

test('no attacks means strict BPM grid is preserved',()=>{
  const events=timelineBeats(0,8,{source:'project',bpm:120,every:4});
  const output=alignBeatEvents(events,[],{enabled:true});
  assert.deepEqual(output.events,events);
  assert.equal(output.aligned,0);
});

test('user can disable spike alignment',()=>{
  const beats=timelineBeats(0,7,{source:'project',bpm:120,every:4});
  const peaks=beats.map(e=>({time:e.time+.08,strength:1}));
  assert.deepEqual(alignBeatEvents(beats,peaks,{enabled:false}).events,beats);
});

test('different BPM regions have their own spike offsets',()=>{
  const regions=[
    {id:'a',start:0,end:4,bpm:120},
    {id:'b',start:4,end:8,bpm:160}
  ];
  const events=timelineBeats(0,8,{source:'map',regions,every:1});
  const peaks=[];
  for(let time=.1;time<3.9;time+=.5)peaks.push({time,strength:2});
  for(let time=4.19;time<7.95;time+=.375)peaks.push({time,strength:2});
  const result=alignBeatEvents(events,peaks,{toleranceMs:190});
  nearly(result.events[2].time,1.1,.06);
  nearly(result.events.find(e=>e.regionId==='b'&&e.time>4.8).time,4.94,.09);
});
