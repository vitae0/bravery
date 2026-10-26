import test from 'node:test';
import assert from 'node:assert/strict';
import {orderedClipIds,selectClipIds,translateSelectedClips} from '../src/selection.js';
const tracks=[
 {id:'t1',clips:[{id:'a',start:0},{id:'b',start:2}]},
 {id:'t2',clips:[{id:'c',start:1},{id:'d',start:3}]}
];
test('Ctrl toggles individual selected clips',()=>{
  const ordered=orderedClipIds(tracks);
  const one=selectClipIds({ordered,target:'a'});
  const two=selectClipIds({...one,ordered,target:'c',ctrl:true});
  assert.deepEqual(two.ids,['a','c']);
  const three=selectClipIds({...two,ordered,target:'a',ctrl:true});
  assert.deepEqual(three.ids,['c']);
});
test('Shift selects a continuous span in track order',()=>{
  const ordered=orderedClipIds(tracks);
  const base=selectClipIds({ordered,target:'a'});
  const extended=selectClipIds({...base,ordered,target:'d',shift:true});
  assert.deepEqual(extended.ids,['a','b','c','d']);
  const append=selectClipIds({...base,ordered,target:'d',shift:true,ctrl:true});
  assert.deepEqual(append.ids,['a','b','c','d']);
});
test('plain click can preserve group for dragging',()=>{
  const ordered=orderedClipIds(tracks);
  const chosen=selectClipIds({ordered,target:'b',anchor:'a',ids:['a','b'],keepGroup:true});
  assert.deepEqual(chosen.ids,['a','b']);
});
test('dragging selected group shifts all without crossing before zero',()=>{
  const moved=translateSelectedClips(tracks,['a','c'],.5);
  assert.deepEqual(moved.flatMap(t=>t.clips.map(c=>c.start)),[.5,2,1.5,3]);
  const limited=translateSelectedClips(tracks,['a','c'],-3);
  assert.equal(limited[0].clips[0].start,0);
  assert.equal(limited[1].clips[0].start,1);
});
