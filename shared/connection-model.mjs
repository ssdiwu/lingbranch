import { z } from 'zod';

export const CONNECTION_EPOCH = '1970-01-01T00:00:00.000Z';
export const RELATION_TYPES = Object.freeze([
  {value:'related',label:'关联'},
  {value:'workflow',label:'工作流衔接'},
  {value:'example',label:'案例归属'},
  {value:'application',label:'方法应用'},
  {value:'extension',label:'概念延伸'},
]);
export const relationTypeSchema = z.enum(['related','workflow','example','application','extension']);
export const connectionReasonSchema = z.string().trim().max(500);
const id = z.string().uuid(), key = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);
export const connectionCreateSchema = z.object({
  fromId:id,toId:id,relationType:relationTypeSchema.optional(),reason:connectionReasonSchema.optional(),idempotencyKey:key.optional(),
}).strict();
export const connectionUpdateSchema = z.object({
  connectionId:id,expectedUpdatedAt:z.string().datetime(),idempotencyKey:key,
  patch:z.object({relationType:relationTypeSchema.optional(),reason:connectionReasonSchema.optional()}).strict().refine(p=>Object.keys(p).length>0,'至少提供一个关系字段'),
}).strict();
export function relationLabel(value){return RELATION_TYPES.find(t=>t.value===value)?.label??'关联';}
export function connectionFromRow(row){
  return {id:String(row.id),fromId:String(row.from_id),toId:String(row.to_id),relationType:row.relation_type??'related',reason:row.reason??'',updatedAt:row.updated_at??CONNECTION_EPOCH};
}
export function sameConnectionPair(link,a,b){return link.fromId===a&&link.toId===b||link.fromId===b&&link.toId===a;}
