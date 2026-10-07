import test from 'node:test';
import assert from 'node:assert/strict';
import {fitCanvasView} from '../web/lib/atlas-view.ts';
import {arrangeRelationships,nodeLayoutBounds,MIN_CANVAS_ZOOM,READING_ZOOM} from '../shared/relationship-layout.mjs';
const check=(notes,viewport)=>{
 const fit=fitCanvasView(notes,viewport,{width:200,height:88},MIN_CANVAS_ZOOM);assert.ok(fit.zoom>0);
 for(const n of notes){const b=nodeLayoutBounds(n);assert.ok(b.left*fit.zoom+fit.panX>=-.01);assert.ok(b.right*fit.zoom+fit.panX<=viewport.width+.01);assert.ok(b.top*fit.zoom+fit.panY>=-.01);assert.ok(b.bottom*fit.zoom+fit.panY<=viewport.height+.01);}
 assert.ok(fitCanvasView(notes,viewport,{width:200,height:88}).zoom>=READING_ZOOM);
};
test('explicit overview fits100 and1000 longest titles and legal extreme coordinates; reading stays readable',()=>{
 for(const count of [100,1000]){const notes=Array.from({length:count},(_,i)=>({id:'long-'+i,title:'W'.repeat(200),x:0,y:0,tags:['topic-'+i%7]})),arranged=arrangeRelationships(notes,[]);
  for(const viewport of [{width:1000,height:700},{width:320,height:640},{width:900,height:400}])check(arranged,viewport);
 }
 check([{id:'left',title:'长'.repeat(200),x:-1000000,y:-1000000},{id:'right',title:'W'.repeat(200),x:1000000,y:1000000}],{width:320,height:640});
});
