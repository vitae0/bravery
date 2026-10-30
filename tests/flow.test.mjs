import test from 'node:test';
import assert from 'node:assert/strict';
import {flowSectionAt,inferFlowLoop,classifyFlowGesture,synthesizeFlowGesture} from '../src/flow.js';

const section={start:0,end:32,name:'Verse'};
const events=times=>times.map(time=>({time,kind:'kick',intensity:.7}));

test('Flow respects named section boundaries',()=>{
  assert.deepEqual(flowSectionAt(6,[section],120,45),section);
  const fallback=flowSectionAt(40,[],120,80);
  assert.equal(fallback.start,32);
  assert.equal(fallback.end,48);
});

test('Flow needs four performed hits before looping',()=>{
  assert.equal(inferFlowLoop(events([1,1.5,2]),120,section,2).events.length,0);
  const learned=inferFlowLoop(events([1,1.5,2,2.5]),120,section,2.5);
  assert.equal(learned.mode,'pulse');
  assert.ok(learned.events.length>10);
  assert.ok(Math.abs(learned.events[0].time-3)<.01);
  assert.ok(learned.events.every(e=>e.time>2.5&&e.time<32));
});

test('Flow does not double the pulse for sparse two-beat taps',()=>{
  const result=inferFlowLoop(events([1,2,3,4]),120,section,4);
  assert.equal(result.mode,'pulse');
  assert.ok(Math.abs(result.events[1].time-result.events[0].time-1)<0.001);
});

test('Flow can learn a syncopated phrase rather than invent a straight pulse',()=>{
  const input=events([1,1.5,2.75,3.25]);
  const result=inferFlowLoop(input,120,section,3.25);
  assert.equal(result.mode,'phrase');
  assert.ok(result.events.length>4);
  assert.ok(result.events.every(e=>e.time>=3.39&&e.time<32));
});

test('Flow refuses to schedule notes beyond a section or event cap',()=>{
  const tiny={start:0,end:4.5,name:'Break'};
  const result=inferFlowLoop(events([1,1.5,2,2.5]),120,tiny,2.5);
  assert.ok(result.events.every(e=>e.time<tiny.end));
  assert.equal(inferFlowLoop(events([1,1.5,2,2.5]),120,section,2.5,5).events.length,5);
});

test('Flow distinguishes directional motion from taps',()=>{
  assert.equal(classifyFlowGesture([{x:.5,y:.5},{x:.501,y:.502}]).kind,'tap');
  assert.equal(classifyFlowGesture([{x:.2,y:.8},{x:.5,y:.3}]).kind,'rise');
  assert.equal(classifyFlowGesture([{x:.2,y:.2},{x:.7,y:.7}]).kind,'fall');
});

test('Flow gesture synthesis stays finite and produces stereo samples',()=>{
  const wave=synthesizeFlowGesture([
    {x:.1,y:.85,at:1000},{x:.5,y:.46,at:1120},{x:.9,y:.1,at:1240}
  ],8000);
  assert.equal(wave.kind,'rise');
  assert.equal(wave.left.length,wave.right.length);
  assert.ok(wave.left.length>=1000);
  assert.ok(wave.left.some(value=>Math.abs(value)>0.001));
  assert.ok(wave.left.every(Number.isFinite));
  assert.ok(wave.right.every(Number.isFinite));
  assert.ok(Math.max(...wave.left)<1);
});
