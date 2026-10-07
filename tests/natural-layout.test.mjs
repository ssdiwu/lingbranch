import test from 'node:test';
import assert from 'node:assert/strict';
import {arrangeRelationships,themeZones,themeLabels,nodeVisualBounds,NODE_SIZE} from '../shared/relationship-layout.mjs';
const sample=n=>Array.from({length:n},(_,i)=>({id:`note-${String(i).padStart(4,'0')}`,x:i*300,y:i*90,tags:[`topic-${i%7}`],body:'原文与附件不改变',attachments:[{id:'original'}]}));
const mean=values=>values.reduce((sum,n)=>sum+n,0)/values.length;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function noOverlap(nodes){for(let i=0;i<nodes.length;i++)for(let j=0;j<i;j++)assert.ok(Math.abs(nodes[i].x-nodes[j].x)>=NODE_SIZE.width||Math.abs(nodes[i].y-nodes[j].y)>=NODE_SIZE.height,`${nodes[i].id}/${nodes[j].id}`);}
test('shared themes form natural proximity with stable ordering, full fields and no invented edges',()=>{
 const original=sample(77),snapshot=structuredClone(original),edges=[];
 const arranged=arrangeRelationships(original,edges),inside=[],outside=[];
 for(let i=0;i<arranged.length;i++)for(let j=0;j<i;j++)(original[i].tags[0]===original[j].tags[0]?inside:outside).push(distance(arranged[i],arranged[j]));
 assert.ok(mean(inside)<mean(outside)*.65,{inside:mean(inside),outside:mean(outside)});
 assert.ok(new Set(arranged.map(n=>n.x)).size>60);assert.ok(new Set(arranged.map(n=>n.y)).size>60);noOverlap(arranged);
 const reverse=arrangeRelationships([...original].reverse(),edges);assert.deepEqual(new Map(reverse.map(n=>[n.id,[n.x,n.y]])),new Map(arranged.map(n=>[n.id,[n.x,n.y]])));
 assert.deepEqual(original,snapshot);assert.deepEqual(edges,[]);for(let i=0;i<original.length;i++)assert.deepEqual({...arranged[i],x:original[i].x,y:original[i].y},original[i]);
});
test('real connections exert stronger pull while multi-tag and untagged notes remain full records',()=>{
 const original=sample(35),before=arrangeRelationships(original,[]);const edges=[{fromId:original[0].id,toId:original[3].id}],after=arrangeRelationships(original,edges);
 assert.ok(distance(after[0],after[3])<distance(before[0],before[3])*.75);
 original[0].tags=['topic-0','topic-3'];original[1].tags=[];const copy=structuredClone(original),arranged=arrangeRelationships(original,edges);assert.deepEqual(original,copy);noOverlap(arranged);assert.equal(arranged[0].tags.length,2);assert.equal(arranged[1].tags.length,0);
 const hints=themeZones(arranged);assert.ok(hints.length<=6);assert.ok(hints.every(h=>h.count>=3&&Number.isFinite(h.x)&&Number.isFinite(h.ry)));assert.deepEqual(original,copy);assert.equal(edges.length,1);
});
test('bounded 1000-node layout stays finite and separates full hit areas; oversize rejects before layout',()=>{
 const original=sample(1000),arranged=arrangeRelationships(original,[]);assert.equal(arranged.length,1000);assert.ok(arranged.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)&&Math.abs(n.x)<1e6&&Math.abs(n.y)<1e6));noOverlap(arranged);
 assert.throws(()=>arrangeRelationships(sample(1001),[]),/1000/);assert.deepEqual(arrangeRelationships([],[]),[]);
});

test('35% and 39% visual bounds include selected point, focus and neighboring titles',()=>{
 const tag='WWWWWWWWWWWW',wide=[...Array.from({length:12},(_,i)=>({id:`topic-${i}`,x:400,y:344,tags:[tag]})),{id:'adjacent',title:'W'.repeat(40),x:575,y:244,tags:[]},...Array.from({length:7},(_,i)=>({id:`far-${i}`,x:5000+i*300,y:5000,tags:[]}))],view={panX:0,panY:0,zoom:1};
 // Measured in the actual Inter/PingFang browser font: 173.251px, wider than
 // the former ASCII estimate. The former label at (500,282) hit the neighbor.
 const hint=themeLabels(themeZones(wide),wide,view,{width:1000,height:700})[0];
 assert.ok(hint);if(hint.label){const box={left:hint.label.x-173.251/2,right:hint.label.x+173.251/2,top:hint.label.y-14,bottom:hint.label.y+3};assert.ok(wide.map(n=>nodeVisualBounds(n,view)).every(n=>box.right<=n.left||box.left>=n.right||box.bottom<=n.top||box.top>=n.bottom),'wide Latin caption overlaps a node');}
 const nodes=arrangeRelationships(sample(77),[]);
 for(const zoom of [.35,.39,1,2]){
  const transform={panX:80,panY:40,zoom},boxes=nodes.map(n=>nodeVisualBounds(n,transform));
  for(let i=0;i<boxes.length;i++)for(let j=0;j<i;j++){const a=boxes[i],b=boxes[j];assert.ok(a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom,`screen collision ${zoom} ${nodes[i].id}/${nodes[j].id}`);}
  const labels=themeLabels(themeZones(nodes),nodes,transform,{width:1000,height:700});
  for(const hint of labels){if(!hint.label)continue;const x=hint.label.x*zoom+80,y=hint.label.y*zoom+40;assert.ok(y>=100&&y<=620);const half=Array.from(hint.tag.slice(0,12)+' · '+hint.count).length*13/2;const box={left:x-half,right:x+half,top:y-14,bottom:y+3};assert.ok(boxes.every(n=>box.right<=n.left||box.left>=n.right||box.bottom<=n.top||box.top>=n.bottom),'theme caption overlaps a node');}
 }
});
