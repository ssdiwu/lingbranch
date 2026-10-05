import { TextSelection } from '@milkdown/kit/prose/state';

export function imageInsertionTransaction(state,picture,paragraphType) {
  const transaction=state.tr.replaceSelectionWith(picture,false);
  let after;
  transaction.doc.descendants((node,position)=>{
    if(node.type===picture.type&&node.attrs.src===picture.attrs.src)after=position+node.nodeSize;
  });
  if(after===undefined)throw new Error('图片未能进入当前正文。');
  // 图片不能继续占据输入选区；保留右侧段落，或建立一个可继续输入的段落。
  if(transaction.doc.resolve(after).nodeAfter?.type!==paragraphType)transaction.insert(after,paragraphType.create());
  transaction.setSelection(TextSelection.create(transaction.doc,after+1));
  return transaction.scrollIntoView();
}
