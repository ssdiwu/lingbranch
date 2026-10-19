import { z } from 'zod';
import * as v from './validation.mjs';
import {layoutSchema} from '../shared/layout-request.mjs';
import {connectionCreateSchema,connectionUpdateSchema} from '../shared/connection-model.mjs';

// Both transports dispatch here; neither accepts a caller-provided library identity.
export const toolDefinitions = {
  arrange_inspirations:{description:'按用户授权一次保存一批灵感位置（最多 1000 条），仅改位置和版本。每条携带读回的 expectedUpdatedAt，稳定 idempotencyKey；冲突整批拒绝。回执 previous 是可恢复的原位置及所需版本，恢复仍调用本工具。原请求重试返回凭据，不覆盖后续修改。',schema:layoutSchema,run:(db,args)=>db.arrangeIdeas(args)},
  list_inspirations:{description:'分页读取全部灵感，默认包含归档和未打标签记录。沿 nextCursor 读取到 hasMore=false。',schema:v.list,readOnly:true,run:(db,args) => db.listIdeas(args)},
  search_inspirations:{description:'按文字或标签检索正文、来源、附件名称和索引文字，支持完整分页；多词全部匹配，不是语义推荐。当前任务已选定并允许读取本库，且用户点名参考或具体缺口会改变方法、工具、交互或呈现时，可主动定向查询；已有充分设计的局部修改不重查，多库不明不跨库并搜。默认显式 includeArchived:false，用不超过六词的短查询，足够即停，不默认全库。摘要只筛选，依赖前用 read_inspiration 读全文、来源及必要原件；给出具体使用位置、复用部分、条件、适配与最小验证，允许零推荐，然后继续原任务。受限或空结果不代表全库没有。此检索及建议不保存、不打标签、不连线或改布局。',schema:v.list.refine(x => !!(x.query || x.tag),'提供 query 或 tag'),readOnly:true,run:(db,args) => db.listIdeas(args)},
  read_inspiration:{description:'读取灵感完整正文、版本、来源、附件索引及位置。更新前先读取。',schema:z.object({id:v.id}).strict(),readOnly:true,run:(db,args) => db.readIdea(args.id)},
  create_inspiration:{description:'保存用户授权的一条新灵感。保留给定标题和来源，稳定 idempotencyKey 重试沿原参数；不把候选能力写成既成事实。普通完整保存前先列标签，优先复用已有准确名称，按已读正文补少量主体／用途词，无等价时可用正文明确新词，低置信不写；精确标签集合、空数组、仅保存或原样保存不附带补标签。空壳或未完成上传暂不自动打标，在最终正文更新时提交；API自身不分类。完整正文与必要附件保存读回后，按技能检索、全文读取旧节点，仅为有明确内容依据的候选另调用 connect_inspirations，提供类型、理由和稳定键；仅保存、不要关联或先建议时遵从。标签不能独自证明关联。创建调用本身不连线或重排旧节点，分项报告保存、标签与关联。',schema:v.create,run:(db,args) => db.createIdea(args)},
  update_inspiration:{description:'只修改授权字段，先 read_inspiration 读完整正文、全部标签与版本，传 expectedUpdatedAt 和稳定 idempotencyKey。普通标题／正文实质更新可先列标签，复用已有准确名、只补有正文依据的少量主体／用途词；低置信不写。patch.tags替换完整数组，保留原标签及顺序，新项在后去重，最多十二个每个四十字符，满额不挤掉旧项，与最终正文同次提交。精确标签集合／[]按用户要求；仅改正文、不要改标签、原样或仅保存、只改来源时间／位置／归档／格式且含义不变时不自动重标，不批量改名合并删除。冲突读回核对，不能自动换版本覆盖；不确定时原请求重试，历史回执后再读当前正文、标签与版本。API自身不判断标签，不重做关联；patch.archived控制归档与恢复。',schema:v.update,run:(db,args) => db.updateIdea(args)},
  list_inspiration_tags:{description:'只读列出现有标签和活跃、归档数量；保存时优先复用准确名称，同次批次可复用目录并纳入刚读回的新标签。列目录不修改或自动归并标签；单条标签通过已读版本的update_inspiration保存。',schema:z.object({includeArchived:z.boolean().default(true)}).strict(),readOnly:true,run:(db,args) => ({tags:db.listTags(args.includeArchived)})},
  rename_inspiration_tag:{description:'重命名标签；目标标签已存在时合并，不修改正文、附件与位置。',schema:v.rename,run:(db,args) => db.changeTag(args)},
  remove_inspiration_tag:{description:'从所有灵感中移除指定标签，保留灵感和附件。',schema:v.removeTag,run:(db,args) => db.changeTag(args,true)},
  connect_inspirations:{description:'按用户要求连接两条活跃灵感，提供具体 reason 和可选 relationType；同标签不能单独当作理由。稳定 idempotencyKey 可用于重试；重复或反向不重复，说明不同需读取版本后更新，重试不重建后来移除的连接。旧只给两端的调用保留。',schema:connectionCreateSchema,run:(db,args) => db.connect(args)},
  update_inspiration_connection:{description:'只修改已有实线的关系类型和理由。先列出关联读版本，传 connectionId、expectedUpdatedAt、稳定 idempotencyKey 与 patch；冲突拒绝，重试读回当前关系，不改灵感、原件或位置。',schema:connectionUpdateSchema,run:(db,args)=>db.updateConnection(args)},
  list_inspiration_connections:{description:'读取指定灵感的所有连线。',schema:z.object({id:v.id}).strict(),readOnly:true,run:(db,args) => ({connections:db.listConnections(args.id)})},
  remove_inspiration_connection:{description:'移除一条连线，保留灵感、附件及节点位置；重复移除安全。',schema:z.object({connectionId:v.id,expectedUpdatedAt:v.date.optional()}).strict(),run:(db,args) => db.removeConnection(args.connectionId,args.expectedUpdatedAt)},
  read_inspiration_attachment:{description:'分段读取已校验的附件原件，每段最多 512 KiB。沿 nextOffset 读取到 complete=true，再核对总字节数与 sha256。没有 OCR 或全文理解承诺。',schema:z.object({attachmentId:v.id,offset:z.number().int().min(0).max(v.MAX_ATTACHMENT_BYTES).default(0),limit:z.number().int().min(1).max(512*1024).default(512*1024)}).strict(),readOnly:true,run:async(db,args) => {
    const {metadata,bytes}=await db.readAttachment(args.attachmentId);
    if(args.offset>=bytes.length)v.fail('invalid_input','附件读取偏移超过原件范围。');
    const end=Math.min(bytes.length,args.offset+args.limit),complete=end===bytes.length;
    // 只限制传输分段；每次仍验证完整原件，避免把损坏文件分段报告为成功。
    return {attachment:metadata,dataBase64:bytes.subarray(args.offset,end).toString('base64'),offset:args.offset,nextOffset:complete?null:end,complete};
  }},
  attach_inspiration_file:{description:'把完整 base64 原件保存到灵感。最多 20 MiB，必须提供实际 bytes、sha256 与稳定 idempotencyKey。不下载远程文件。video/mp4 会校验 MP4 ftyp 容器签名；视频不自动转写。',schema:v.attachmentInput.extend({dataBase64:z.string().min(4).max(Math.ceil(v.MAX_ATTACHMENT_BYTES/3)*4)}),run:async(db,args) => {
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
