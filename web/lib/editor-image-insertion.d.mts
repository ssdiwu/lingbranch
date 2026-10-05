import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import type { Node, NodeType } from '@milkdown/kit/prose/model';
export function imageInsertionTransaction(state:EditorState,picture:Node,paragraphType:NodeType):Transaction;
