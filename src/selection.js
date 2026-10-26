// Headless clip-selection policy. The editor uses clip IDs as globally unique keys.
export function orderedClipIds(tracks) {
  return tracks.flatMap(track =>
    [...track.clips].sort((a,b)=>a.start-b.start).map(clip=>clip.id)
  );
}

export function selectClipIds({ids=[],anchor=null,target,ordered=[],ctrl=false,shift=false,keepGroup=false}={}) {
  if (!target || !ordered.includes(target)) return {ids,anchor,focus:ids.at(-1)||null};
  if (shift) {
    const a=ordered.indexOf(anchor);
    const b=ordered.indexOf(target);
    const range=a>=0?ordered.slice(Math.min(a,b),Math.max(a,b)+1):[target];
    // Ctrl+Shift adds the range; plain Shift replaces the range.
    const next=ctrl?[...new Set([...ids,...range])]:range;
    return {ids:next,anchor:anchor&&ordered.includes(anchor)?anchor:target,focus:target};
  }
  if (ctrl) {
    const next=ids.includes(target)?ids.filter(id=>id!==target):[...ids,target];
    return {ids:next,anchor:target,focus:next.includes(target)?target:next.at(-1)||null};
  }
  if (keepGroup && ids.length>1 && ids.includes(target)) return {ids,anchor:target,focus:target};
  return {ids:[target],anchor:target,focus:target};
}

export function translateSelectedClips(tracks,selectedIds,delta) {
  const ids=new Set(selectedIds);
  const starts=tracks.flatMap(t=>t.clips.filter(c=>ids.has(c.id)).map(c=>c.start));
  if (!starts.length) return tracks;
  const safeDelta=Math.max(-Math.min(...starts),delta);
  return tracks.map(t=>({...t,clips:t.clips.map(c=>ids.has(c.id)?{...c,start:Math.max(0,c.start+safeDelta)}:c)}));
}
