// Browser data contract. All persistent operations live in server/library.mjs.
export type BodyFormat = "plain" | "markdown";
export type Attachment = { id:string; ideaId:string; name:string; mimeType:string; bytes:number; indexedText:string; createdAt:string; sha256:string };
export type BodyImage = { attachmentId:string; name:string; alt:string; mimeType:string };
export type Idea = {
  id:string; title:string; body:string; bodyFormat:BodyFormat; summary:string; bodyImages:BodyImage[];
  sourceLabel:string; sourceUrl:string; sourceAt:string;
  tags:string[]; x:number; y:number; archived:boolean; createdAt:string; updatedAt:string;
  attachments:Attachment[];
};
export type Connection = { id:string; fromId:string; toId:string };
export type CanvasState = { panX:number; panY:number; zoom:number; updatedAt?:string };
export type Atlas = { ideas:Idea[]; connections:Connection[]; canvas:CanvasState };
export type TagSummary = { name:string; count:number; activeCount:number; archivedCount:number };
export type TagChange = { outcome:'renamed'|'removed'|'unchanged'; affectedCount:number; affectedItems:{id:string; tags:string[]; updatedAt:string}[] };

// 文件附件区主要列非图片原件；图片进入右侧图文正文，未引用或暂不能预览的仍要有访问入口。
export const isPreviewableImage = (file:Attachment) => /^image\/(png|jpeg|gif|webp)$/.test(file.mimeType);
export const isImage = (file:Attachment) => file.mimeType.startsWith('image/');
export const attachmentUrl = (id:string) => `/api/attachments/${encodeURIComponent(id)}`;
export const imageCounts = (idea:Idea) => {
  const images = idea.attachments.filter(isImage);
  return { images:images.length, files:idea.attachments.length - images.length, total:idea.attachments.length };
};
// 封面按正文中图片的呈现顺序选择；旧纯文本记录沿用已有图片顺序。
export function coverImage(idea:Idea):Attachment|null {
  if (idea.bodyFormat === "markdown" && idea.bodyImages.length) {
    const byId = new Map(idea.attachments.map(file => [file.id, file]));
    for (const reference of idea.bodyImages) { const found = byId.get(reference.attachmentId); if (found) return found; }
  }
  return idea.attachments.find(isPreviewableImage) ?? null;
}
