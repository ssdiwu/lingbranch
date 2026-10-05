import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { history, undo, redo } from '@milkdown/kit/prose/history';
import { imageInsertionTransaction } from '../web/lib/editor-image-insertion.mjs';

test('真实 ProseMirror 插图事务保留左右文字，多图后继续中文输入，撤销重做不替换图片',()=>{
  const schema=new Schema({nodes:{
    doc:{content:'block+'},paragraph:{group:'block',content:'text*'},text:{group:'inline'},
    'image-block':{group:'block',atom:true,selectable:true,attrs:{src:{default:''}}},
  }});
  const paragraph=schema.nodes.paragraph;
  const doc=schema.nodes.doc.create(null,[paragraph.create(null,schema.text('左边右边'))]);
  let state=EditorState.create({doc,selection:TextSelection.create(doc,3),plugins:[history()]});
  const first=schema.nodes['image-block'].create({src:'blob:first'});
  state=state.apply(imageInsertionTransaction(state,first,paragraph));
  assert.equal(state.doc.child(0).textContent,'左边');assert.equal(state.doc.child(2).textContent,'右边');
  assert.ok(state.selection instanceof TextSelection);assert.equal(state.selection.$from.parent.type,paragraph);
  state=state.apply(state.tr.insertText('两图之间说明。'));
  const second=schema.nodes['image-block'].create({src:'blob:second'});
  state=state.apply(imageInsertionTransaction(state,second,paragraph));
  state=state.apply(state.tr.insertText('图片之后说明。'));
  const pictures=()=>{const sources=[];state.doc.descendants(node=>{if(node.type.name==='image-block')sources.push(node.attrs.src);});return sources;};
  assert.deepEqual(pictures(),['blob:first','blob:second']);
  assert.equal(state.doc.textContent,'左边两图之间说明。图片之后说明。右边');
  const complete=state.doc.toJSON();
  assert.equal(undo(state,transaction=>{state=state.apply(transaction);}),true);
  assert.equal(redo(state,transaction=>{state=state.apply(transaction);}),true);
  assert.deepEqual(state.doc.toJSON(),complete);assert.deepEqual(pictures(),['blob:first','blob:second']);
  // 连续多选也不会把后一张插到前一张的 NodeSelection 上。
  let many=EditorState.create({doc:schema.nodes.doc.create(null,[paragraph.create()])});
  for(let index=0;index<3;index++)many=many.apply(imageInsertionTransaction(many,schema.nodes['image-block'].create({src:`blob:many-${index}`}),paragraph));
  many=many.apply(many.tr.insertText('多选后的段落'));
  let count=0;many.doc.descendants(node=>{if(node.type.name==='image-block')count++;});
  assert.equal(count,3);assert.equal(many.doc.lastChild.textContent,'多选后的段落');
});
