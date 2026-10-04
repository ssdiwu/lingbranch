// Browser data contract. All persistent operations live in server/library.mjs.
export type Attachment = { id:string; ideaId:string; name:string; mimeType:string; bytes:number; indexedText:string; createdAt:string; sha256:string };
export type Idea = {
  id:string; title:string; body:string; sourceLabel:string; sourceUrl:string; sourceAt:string;
  tags:string[]; x:number; y:number; archived:boolean; createdAt:string; updatedAt:string;
  attachments:Attachment[];
};
export type Connection = { id:string; fromId:string; toId:string };
export type CanvasState = { panX:number; panY:number; zoom:number; updatedAt?:string };
export type Atlas = { ideas:Idea[]; connections:Connection[]; canvas:CanvasState };
export type TagSummary = { name:string; count:number; activeCount:number; archivedCount:number };
export type TagChange = { outcome:'renamed'|'removed'|'unchanged'; affectedCount:number; affectedItems:{id:string; tags:string[]; updatedAt:string}[] };
