// Geometry shared by placement, temporary views and the relationship canvas.
// Coordinates are the top-left of a node's complete title/hit area.
export const NODE_SIZE = Object.freeze({width:200, height:88});
export const NODE_ANCHOR = Object.freeze({x:100, y:56});
export const NODE_GAP = Object.freeze({x:32, y:104});
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

export const READING_ZOOM=.35;
export function nodeDisplayGeometry(zoom) {
  const scale=Math.min(1/zoom,1/READING_ZOOM),factor=zoom*scale;
  return {scale,factor,titleWidth:Math.max(70,Math.min(200,200/scale)),fontSize:13,lineHeight:17,titleTop:24,selectedTitleTop:18};
}
// Conservative union of either title state, 36px selected point, focus ring and
// touch target. Canvas translation and scale are shared with the SVG endpoints.
export function nodeVisualBounds(point,transform) {
  const g=nodeDisplayGeometry(transform.zoom),x=(point.x+NODE_ANCHOR.x)*transform.zoom+transform.panX,y=(point.y+NODE_ANCHOR.y)*transform.zoom+transform.panY;
  const half=Math.max(25,g.titleWidth/2)*g.factor;
  return {left:x-half,right:x+half,top:y-38*g.factor,bottom:y+25*g.factor};
}
function boundsOverlap(a,b,gap=4){return a.left-gap<b.right&&a.right+gap>b.left&&a.top-gap<b.bottom&&a.bottom+gap>b.top;}
export function themeLabels(zones,ideas,transform,viewport) {
  const nodes=ideas.map(n=>nodeVisualBounds(n,transform)),placed=[];
  return zones.map(zone=>{
    const text=Array.from(zone.tag).slice(0,12).join('')+' · '+zone.count;
    // At the fixed 13px caption size, reserve a full glyph cell even for Latin W.
    const width=Array.from(text).length*13,cx=zone.x*transform.zoom+transform.panX,cy=zone.y*transform.zoom+transform.panY,rx=zone.rx*transform.zoom,ry=zone.ry*transform.zoom;
    const candidates=[[cx,cy-ry-18],[cx-rx*.65,cy-ry*.65-18],[cx+rx*.65,cy-ry*.65-18],[cx,cy+ry+20],[cx-rx-12-width/2,cy],[cx+rx+12+width/2,cy]];
    let label=null;
    for(const[x,y]of candidates){const box={left:x-width/2,right:x+width/2,top:y-14,bottom:y+3};if(box.left<16||box.right>viewport.width-16||box.top<100||box.bottom>viewport.height-80||nodes.some(n=>boundsOverlap(box,n))||placed.some(n=>boundsOverlap(box,n)))continue;placed.push(box);label={x:(x-transform.panX)/transform.zoom,y:(y-transform.panY)/transform.zoom};break;}
    return {...zone,label};
  });
}

function hashFraction(value) {
  let hash=2166136261;
  for(const char of String(value)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}
  return (hash>>>0)/4294967296;
}
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
const tagsOf=idea=>[...new Set((idea.tags??[]).filter(tag=>typeof tag==='string'&&tag.length))].sort();

// Visit nearby pairs once. Local spacing stays bounded at the supported 1000
// nodes; distant nodes use the weak global and topic anchors instead of N² charge.
function nearbyPairs(nodes,visit) {
  const cell=NODE_SIZE.width+NODE_GAP.x, buckets=new Map();
  for(let i=0;i<nodes.length;i++){
    const node=nodes[i],cx=Math.floor(node.x/cell),cy=Math.floor(node.y/cell);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const j of buckets.get(`${cx+dx},${cy+dy}`)??[])visit(node,nodes[j]);
    const key=`${cx},${cy}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(i);
  }
}

// A finite, deterministic layout. Tags are weak positional hints, never edges.
// It runs for an explicit arrangement or a temporary view, never on library read.
export function arrangeRelationships(ideas, connections, viewport={width:1000,height:700}) {
  if(!ideas.length)return [];
  if(ideas.length>1000)throw new RangeError('一次最多整理 1000 个节点。');
  const ordered=[...ideas].sort((a,b)=>String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0);
  const frequencies=new Map();for(const idea of ordered)for(const tag of tagsOf(idea))frequencies.set(tag,(frequencies.get(tag)??0)+1);
  const topics=[...frequencies].filter(([,count])=>count>1).map(([tag])=>tag).sort();
  const ratio=clamp(Number.isFinite(viewport.width/viewport.height)?viewport.width/viewport.height:1.4,.65,1.85);
  const area=ideas.length*(NODE_SIZE.width+NODE_GAP.x)*(NODE_SIZE.height+NODE_GAP.y)*1.65;
  const width=Math.max(720,Math.sqrt(area*ratio)),height=Math.max(520,Math.sqrt(area/ratio));
  const anchors=new Map(topics.map((tag,i)=>{const angle=-Math.PI/2+2*Math.PI*i/topics.length;return [tag,{x:topics.length===1?0:Math.cos(angle)*width*.42,y:topics.length===1?0:Math.sin(angle)*height*.42}];}));
  const spread=Math.max(180,Math.sqrt(area/Math.max(1,topics.length))*.32);
  const nodes=ordered.map(idea=>{
    const available=tagsOf(idea).filter(tag=>anchors.has(tag));
    let ax=0,ay=0,weight=0;
    for(const tag of available){const w=1/Math.sqrt(frequencies.get(tag)),a=anchors.get(tag);ax+=a.x*w;ay+=a.y*w;weight+=w;}
    if(weight){ax/=weight;ay/=weight;}
    const angle=hashFraction(idea.id)*Math.PI*2,radius=Math.sqrt(hashFraction(`${idea.id}:radius`));
    const x=weight?ax+Math.cos(angle)*spread*radius:(hashFraction(`${idea.id}:x`)-.5)*width*.9;
    const y=weight?ay+Math.sin(angle)*spread*.8*radius:(hashFraction(`${idea.id}:y`)-.5)*height*.9;
    return {id:idea.id,x,y,ax,ay,topic:available.length>0,vx:0,vy:0,fx:0,fy:0,degree:0};
  });
  const byId=new Map(nodes.map(n=>[n.id,n])),links=[],seen=new Set();
  for(const link of connections){const a=byId.get(link.fromId),b=byId.get(link.toId);if(!a||!b||a===b)continue;const key=JSON.stringify([String(a.id),String(b.id)].sort());if(seen.has(key))continue;seen.add(key);links.push([a,b]);a.degree++;b.degree++;}
  const spaceX=NODE_SIZE.width+NODE_GAP.x,spaceY=NODE_SIZE.height+NODE_GAP.y;
  for(let step=0;step<(nodes.length>250?100:190);step++){
    for(const n of nodes){n.fx=-n.x*.001+(n.topic?(n.ax-n.x)*.012:0);n.fy=-n.y*.001+(n.topic?(n.ay-n.y)*.012:0);}
    nearbyPairs(nodes,(a,b)=>{
      let dx=a.x-b.x,dy=a.y-b.y;if(Math.abs(dx)+Math.abs(dy)<.01)dx=.1;
      const d=Math.hypot(dx,dy),force=5500/(d*d+200),fx=dx/Math.max(1,d)*force,fy=dy/Math.max(1,d)*force;
      a.fx+=fx;a.fy+=fy;b.fx-=fx;b.fy-=fy;
      const ox=spaceX-Math.abs(dx),oy=spaceY-Math.abs(dy);
      if(ox>0&&oy>0){if(ox/spaceX<oy/spaceY){const push=Math.min(14,ox*.2)*(dx>=0?1:-1);a.fx+=push;b.fx-=push;}else{const push=Math.min(14,oy*.2)*(dy>=0?1:-1);a.fy+=push;b.fy-=push;}}
    });
    for(const[a,b]of links){const dx=b.x-a.x,dy=b.y-a.y,d=Math.max(1,Math.hypot(dx,dy)),force=(d-spaceX*1.08)*.026/Math.sqrt(Math.max(a.degree,b.degree,1));const fx=dx/d*force,fy=dy/d*force;a.fx+=fx;a.fy+=fy;b.fx-=fx;b.fy-=fy;}
    for(const n of nodes){n.vx=clamp((n.vx+n.fx)*.72,-18,18);n.vy=clamp((n.vy+n.fy)*.72,-18,18);n.x+=n.vx;n.y+=n.vy;}
  }
  // Projection removes the remaining pressure overlap after the solver settles.
  // No row or tile packing: corrections follow the nearest separating axis.
  for(let step=0;step<200;step++){
    let overlap=false;
    nearbyPairs(nodes,(a,b)=>{const dx=a.x-b.x,dy=a.y-b.y,ox=spaceX-Math.abs(dx),oy=spaceY-Math.abs(dy);if(ox>0&&oy>0){overlap=true;if(ox/spaceX<oy/spaceY){const push=(ox+.2)*.51*(dx>=0?1:-1);a.x+=push;b.x-=push;}else{const push=(oy+.2)*.51*(dy>=0?1:-1);a.y+=push;b.y-=push;}}});
    if(!overlap)break;
  }
  // Exact final spacing protects titles even in an unusually dense component.
  // Incremental placement only separates residual overlaps; it is not a grid.
  const placed=[];
  for(const n of nodes){
    let attempts=0;const origin={x:n.x,y:n.y};
    while(placed.some(p=>Math.abs(n.x-p.x)<spaceX+2&&Math.abs(n.y-p.y)<spaceY+2)){
      const angle=hashFraction(n.id)*2*Math.PI+attempts*2.399963,distance=Math.sqrt(attempts+1)*Math.max(spaceX,spaceY)*.45;n.x=origin.x+Math.cos(angle)*distance;n.y=origin.y+Math.sin(angle)*distance;attempts++;
      if(attempts>1000)throw new Error('无法在限定计算内完成节点避让，位置未保存。');
    }
    placed.push(n);
  }
  const minX=Math.min(...nodes.map(n=>n.x)),minY=Math.min(...nodes.map(n=>n.y));
  const points=new Map(nodes.map(n=>[n.id,{x:Math.round((n.x-minX+80)*100)/100,y:Math.round((n.y-minY+120)*100)/100}]));
  return ideas.map(idea=>({...idea,...points.get(idea.id)}));
}

// Theme washes describe the currently displayed positions, including manual
// moves. They do not run the solver, mutate tags, or invent stored relations.
export function themeZones(ideas) {
  const groups=new Map();for(const idea of ideas)for(const tag of tagsOf(idea)){if(!groups.has(tag))groups.set(tag,[]);groups.get(tag).push(idea);}
  return [...groups].filter(([,members])=>members.length>=3&&members.length<ideas.length*.8)
    .sort((a,b)=>b[1].length-a[1].length||(a[0]<b[0]?-1:1)).slice(0,6).map(([tag,members])=>{
      const x=members.reduce((sum,n)=>sum+n.x+NODE_ANCHOR.x,0)/members.length,y=members.reduce((sum,n)=>sum+n.y+NODE_ANCHOR.y,0)/members.length;
      const spreadX=Math.sqrt(members.reduce((sum,n)=>sum+(n.x+NODE_ANCHOR.x-x)**2,0)/members.length),spreadY=Math.sqrt(members.reduce((sum,n)=>sum+(n.y+NODE_ANCHOR.y-y)**2,0)/members.length);
      return {tag,count:members.length,x,y,rx:Math.max(150,spreadX*1.45+100),ry:Math.max(100,spreadY*1.45+70)};
    });
}

export function previewPosition(point, transform, viewport, detailOpen=false) {
  const narrow=viewport.width<=760,bottom=narrow?124:72,top=narrow?136:80;
  const width=Math.min(PREVIEW_SIZE.width,Math.max(0,viewport.width-32),Math.max(0,(viewport.height-top-bottom)*.75));
  const height=width*4/3, margin=16, available=viewport.width-(detailOpen?Math.min(490,viewport.width*.42):0);
  const right=point.x*transform.zoom+transform.panX+NODE_SIZE.width*transform.zoom+20;
  const left=right+width<=available-margin?right:point.x*transform.zoom+transform.panX-width-20;
  return {left:Math.max(margin,Math.min(left,viewport.width-width-margin)),top:Math.max(top,Math.min(point.y*transform.zoom+transform.panY,viewport.height-height-bottom)),width,height};
}
