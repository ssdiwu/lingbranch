import test from 'node:test';
import assert from 'node:assert/strict';
import {arrangeRelationships,aggregationBasis,nodeVisualBounds,freeNodePosition,nodesOverlap,NODE_SIZE} from '../shared/relationship-layout.mjs';
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
 const basis=aggregationBasis(arranged,edges);assert.equal(basis.connections.length,1);assert.ok(basis.tags.some(t=>t.members.includes(original[0].id)&&t.tag==='topic-3'));assert.equal(basis.untaggedCount,1);assert.deepEqual(original,copy);assert.equal(edges.length,1);
});
test('bounded 1000-node layout stays finite and separates full hit areas; oversize rejects before layout',()=>{
 const original=sample(1000),arranged=arrangeRelationships(original,[]);assert.equal(arranged.length,1000);assert.ok(arranged.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)&&Math.abs(n.x)<1e6&&Math.abs(n.y)<1e6));noOverlap(arranged);
 assert.throws(()=>arrangeRelationships(sample(1001),[]),/1000/);assert.deepEqual(arrangeRelationships([],[]),[]);
});

test('complete Chinese, Latin, wide and 200-character titles reserve screen bounds at all reading zooms',()=>{
 const original=sample(77).map((n,i)=>({...n,title:i===0?'灵感完整标题'.repeat(33).slice(0,200):i===1?'W'.repeat(200):i%2?'Readable project title: purpose and context '+i:'方法笔记：完整主体与使用场景 '+i})),copy=structuredClone(original),nodes=arrangeRelationships(original,[]);
 assert.deepEqual(original,copy);for(let i=0;i<nodes.length;i++)assert.equal(nodes[i].title,original[i].title);
 for(const zoom of [.35,.39,1,2]){
  const boxes=nodes.map(n=>nodeVisualBounds(n,{panX:80,panY:40,zoom}));
  for(let i=0;i<boxes.length;i++)for(let j=0;j<i;j++){const a=boxes[i],b=boxes[j];assert.ok(a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom,`full title collision ${zoom} ${nodes[i].id}/${nodes[j].id}`);}
 }
 const candidate=freeNodePosition({...original[0],x:nodes[1].x,y:nodes[1].y},nodes);assert.ok(nodes.every(n=>!nodesOverlap({...original[0],...candidate},n)));assert.deepEqual(original,copy);
});
test('aggregation basis reports exact current members, real links and no untagged or outside members',()=>{
 const notes=[{id:'a',tags:['broad','specific','specific']},{id:'b',tags:['broad']},{id:'c',tags:['specific']},{id:'d',tags:[]}],links=[{fromId:'a',toId:'c'},{fromId:'c',toId:'a'},{fromId:'a',toId:'outside'},{fromId:'a',toId:'a'}],before=structuredClone({notes,links}),basis=aggregationBasis(notes,links);
 assert.deepEqual(basis.tags.map(t=>[t.tag,t.count,[...t.members].sort()]),[['broad',2,['a','b']],['specific',2,['a','c']]]);assert.equal(basis.connections.length,1);assert.equal(basis.untaggedCount,1);assert.deepEqual({notes,links},before);assert.equal(aggregationBasis([],[]).nodeCount,0);
});
