// Geometry shared by placement, temporary views and the relationship canvas.
// Coordinates are the top-left of a node's complete title/hit area.
export const NODE_SIZE = Object.freeze({width:200, height:56});
export const NODE_ANCHOR = Object.freeze({x:100, y:40});
export const NODE_GAP = Object.freeze({x:32, y:40});
export const PREVIEW_SIZE = Object.freeze({width:300, height:400});

export function directNeighborhood(id, connections, visibleIds) {
  const allowed = new Set(visibleIds), result = new Set();
  if (!id || !allowed.has(id)) return result;
  result.add(id);
  for (const link of connections) {
    if (link.fromId === id && allowed.has(link.toId)) result.add(link.toId);
    if (link.toId === id && allowed.has(link.fromId)) result.add(link.fromId);
  }
  return result;
}

function intersects(a, b) {
  return Math.abs(a.x-b.x) < NODE_SIZE.width+NODE_GAP.x && Math.abs(a.y-b.y) < NODE_SIZE.height+NODE_GAP.y;
}

// Stable connected-component arrangement. Edges affect grouping, never create
// relationships. Unconnected nodes have their own bounded tile. No animation
// frame, selection or browser cache becomes a persistent position source.
export function arrangeRelationships(ideas, connections, viewport={width:1000,height:700}) {
  if (!ideas.length) return [];
  const order = new Map(ideas.map((idea,index)=>[idea.id,index]));
  const adjacency = new Map(ideas.map(idea=>[idea.id,new Set()]));
  for (const link of connections) {
    if (!adjacency.has(link.fromId) || !adjacency.has(link.toId) || link.fromId === link.toId) continue;
    adjacency.get(link.fromId).add(link.toId); adjacency.get(link.toId).add(link.fromId);
  }
  const visited = new Set(), groups = [];
  for (const idea of ideas) {
    if (visited.has(idea.id)) continue;
    const ids = [idea.id]; visited.add(idea.id);
    for (let i=0;i<ids.length;i++) for (const id of adjacency.get(ids[i])) {
      if (!visited.has(id)) {visited.add(id); ids.push(id);}
    }
    groups.push(ids);
  }
  groups.sort((a,b)=>b.length-a.length || order.get(a[0])-order.get(b[0]));
  const tiles = groups.map(ids=>{
    const root = [...ids].sort((a,b)=>adjacency.get(b).size-adjacency.get(a).size || order.get(a)-order.get(b))[0];
    const points = new Map([[root,{x:0,y:0}]]), queue = [root], seen = new Set([root]);
    let level = 1, start = 0;
    while (start < queue.length) {
      const end = queue.length, next = [];
      for (let i=start;i<end;i++) for (const id of adjacency.get(queue[i])) if (!seen.has(id)) {seen.add(id); next.push(id);}
      const radius = Math.max(160*level, next.length*(NODE_SIZE.width+NODE_GAP.x)/(2*Math.PI));
      for (let i=0;i<next.length;i++) {
        const angle = -Math.PI/2 + 2*Math.PI*i/next.length;
        let point = {x:Math.round(Math.cos(angle)*radius),y:Math.round(Math.sin(angle)*radius)};
        // Collision resolution also protects long chains and dense components.
        while ([...points.values()].some(other=>intersects(point,other))) point.y += NODE_SIZE.height+NODE_GAP.y;
        points.set(next[i],point);
      }
      queue.push(...next); start=end; level++;
    }
    const minX=Math.min(...[...points.values()].map(p=>p.x)), minY=Math.min(...[...points.values()].map(p=>p.y));
    const width=Math.max(...[...points.values()].map(p=>p.x))-minX+NODE_SIZE.width;
    const height=Math.max(...[...points.values()].map(p=>p.y))-minY+NODE_SIZE.height;
    return {points:[...points].map(([id,p])=>({id,x:p.x-minX,y:p.y-minY})),width,height};
  });
  const area=tiles.reduce((sum,tile)=>sum+(tile.width+80)*(tile.height+80),0);
  const ratio=Math.max(.5,Math.min(2,viewport.width/Math.max(1,viewport.height)));
  const rowWidth=Math.max(600,Math.sqrt(area*ratio),...tiles.map(tile=>tile.width));
  let x=0,y=0,rowHeight=0;
  const positions=new Map();
  for (const tile of tiles) {
    if (x && x+tile.width>rowWidth) {x=0;y+=rowHeight+80;rowHeight=0;}
    for (const point of tile.points) positions.set(point.id,{x:point.x+x+80,y:point.y+y+120});
    x+=tile.width+80;rowHeight=Math.max(rowHeight,tile.height);
  }
  return ideas.map(idea=>({...idea,...positions.get(idea.id)}));
}

export function previewPosition(point, transform, viewport, detailOpen=false) {
  const narrow=viewport.width<=760,bottom=narrow?124:72,top=narrow?136:80;
  const width=Math.min(PREVIEW_SIZE.width,Math.max(0,viewport.width-32),Math.max(0,(viewport.height-top-bottom)*.75));
  const height=width*4/3, margin=16, available=viewport.width-(detailOpen?Math.min(490,viewport.width*.42):0);
  const right=point.x*transform.zoom+transform.panX+NODE_SIZE.width*transform.zoom+20;
  const left=right+width<=available-margin?right:point.x*transform.zoom+transform.panX-width-20;
  return {left:Math.max(margin,Math.min(left,viewport.width-width-margin)),top:Math.max(top,Math.min(point.y*transform.zoom+transform.panY,viewport.height-height-bottom)),width,height};
}
