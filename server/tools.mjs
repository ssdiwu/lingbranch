import { z } from 'zod';
import * as v from './validation.mjs';

// Both transports dispatch here; neither accepts a caller-provided library identity.
export const toolDefinitions = {
  list_inspirations:{description:'分页读取全部灵感，默认包含归档和未打标签记录。沿 nextCursor 读取到 hasMore=false。',schema:v.list,readOnly:true,run:(db,args) => db.listIdeas(args)},
  search_inspirations:{description:'按文字或标签检索正文、来源、附件名称和索引文字，支持完整分页。',schema:v.list.refine(x => !!(x.query || x.tag),'提供 query 或 tag'),readOnly:true,run:(db,args) => db.listIdeas(args)},
  read_inspiration:{description:'读取灵感完整正文、版本、来源、附件索引及位置。更新前先读取。',schema:z.object({id:v.id}).strict(),readOnly:true,run:(db,args) => db.readIdea(args.id)},
  create_inspiration:{description:'保存一条新灵感。保留用户给定标题，填写稳定 idempotencyKey；不把候选能力写成既成事实。重试沿用原参数。',schema:v.create,run:(db,args) => db.createIdea(args)},
  update_inspiration:{description:'修改指定字段，必须携带读取到的 expectedUpdatedAt 与稳定 idempotencyKey。冲突后重新读取，不能强行覆盖。patch.archived 控制归档与恢复。',schema:v.update,run:(db,args) => db.updateIdea(args)},
  list_inspiration_tags:{description:'列出标签和活跃、归档记录数量。',schema:z.object({includeArchived:z.boolean().default(true)}).strict(),readOnly:true,run:(db,args) => ({tags:db.listTags(args.includeArchived)})},
  rename_inspiration_tag:{description:'重命名标签；目标标签已存在时合并，不修改正文、附件与位置。',schema:v.rename,run:(db,args) => db.changeTag(args)},
  remove_inspiration_tag:{description:'从所有灵感中移除指定标签，保留灵感和附件。',schema:v.removeTag,run:(db,args) => db.changeTag(args,true)},
  connect_inspirations:{description:'连接两条活跃灵感；重复或反向连接返回已有连线。',schema:z.object({fromId:v.id,toId:v.id}).strict(),run:(db,args) => db.connect(args)},
  list_inspiration_connections:{description:'读取指定灵感的所有连线。',schema:z.object({id:v.id}).strict(),readOnly:true,run:(db,args) => ({connections:db.listConnections(args.id)})},
  remove_inspiration_connection:{description:'移除一条连线，保留灵感、附件及卡片位置；重复移除安全。',schema:z.object({connectionId:v.id}).strict(),run:(db,args) => db.removeConnection(args.connectionId)},
  read_inspiration_attachment:{description:'分段读取已校验的附件原件，每段最多 512 KiB。沿 nextOffset 读取到 complete=true，再核对总字节数与 sha256。没有 OCR 或全文理解承诺。',schema:z.object({attachmentId:v.id,offset:z.number().int().min(0).max(v.MAX_ATTACHMENT_BYTES).default(0),limit:z.number().int().min(1).max(512*1024).default(512*1024)}).strict(),readOnly:true,run:async(db,args) => {
    const {metadata,bytes}=await db.readAttachment(args.attachmentId);
    if(args.offset>=bytes.length)v.fail('invalid_input','附件读取偏移超过原件范围。');
    const end=Math.min(bytes.length,args.offset+args.limit),complete=end===bytes.length;
    // 只限制传输分段；每次仍验证完整原件，避免把损坏文件分段报告为成功。
    return {attachment:metadata,dataBase64:bytes.subarray(args.offset,end).toString('base64'),offset:args.offset,nextOffset:complete?null:end,complete};
  }},
  attach_inspiration_file:{description:'把完整 base64 原件保存到灵感。最多 20 MiB，必须提供实际 bytes、sha256 与稳定 idempotencyKey。不下载远程文件。',schema:v.attachmentInput.extend({dataBase64:z.string().min(4).max(Math.ceil(v.MAX_ATTACHMENT_BYTES/3)*4)}),run:async(db,args) => {
    const {dataBase64,...metadata} = args;
    const bytes = Buffer.from(dataBase64,'base64');
    if (bytes.toString('base64') !== dataBase64) v.fail('invalid_input','base64 格式无效。');
    return db.addAttachment(metadata,bytes);
  }},
};

export async function executeTool(library,name,args) {
  if (!Object.hasOwn(toolDefinitions,name)) v.fail('invalid_input','未知工具。');
  const tool = toolDefinitions[name];
  return tool.run(library,v.parse(tool.schema,args));
}
