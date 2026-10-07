import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Library} from '../server/library.mjs';
import {exportBundle,restoreBundle} from '../server/bundle.mjs';
test('overview zoom persists across restart and full bundle restore; invalid zero remains rejected',async t=>{
 const root=await mkdtemp(join(tmpdir(),'lingbranch-overview-')),path=join(root,'original'),restoredPath=join(root,'restored');let db=new Library(path);t.after(async()=>{db.close();await rm(root,{recursive:true,force:true});});
 const before=db.atlas();db.saveCanvas({panX:100,panY:200,zoom:.00001,expectedUpdatedAt:before.canvas.updatedAt,idempotencyKey:randomUUID()});const saved=db.atlas().canvas;
 assert.throws(()=>db.saveCanvas({panX:0,panY:0,zoom:0,expectedUpdatedAt:saved.updatedAt,idempotencyKey:randomUUID()}),e=>e.code==='invalid_input');assert.deepEqual(db.atlas().canvas,saved);
 const bundle=await exportBundle(db);db.close();db=new Library(path);assert.deepEqual(db.atlas().canvas,saved);await restoreBundle(bundle,restoredPath);const other=new Library(restoredPath);try{assert.deepEqual(other.atlas().canvas,saved);}finally{other.close();}
});
