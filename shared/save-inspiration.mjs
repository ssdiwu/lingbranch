import { imageNodes, replaceImageSources } from './markdown.mjs';

// 仅为一个打开的草稿保留阶段请求；正式事实仍由 Library 保存和读回。
export function createSaveSession(id = null, version = '', position = {x:120,y:120}) {
  return {id, version, position, wasNew:!id, creation:null, uploads:new Map(), indexing:new Map(), final:null};
}
export function acknowledgeVersion(session, version) {
  session.version = version;
  session.final = null;
}

export async function saveInspiration(session, snapshot, io, onStage = () => {}) {
  let phase = 'preparing';
  const progress = (next,message) => { phase = next; onStage(message); };
  try {
    const rich = snapshot.bodyFormat === 'markdown';
    const usedUrls = new Set(rich ? imageNodes(snapshot.body).map(image => image.url) : []);
    const drafts = snapshot.drafts.filter(draft => usedUrls.has(draft.url));
    for (const file of [...snapshot.files,...drafts.map(draft => draft.file)]) {
      if (!file.size || file.size > 20*1024*1024) throw new Error('原件需要为 1 字节至 20 MiB。');
    }
    for (const url of usedUrls) {
      if (url.startsWith('blob:') && !drafts.some(draft => draft.url === url)) {
        throw Object.assign(new Error('正文草稿图片已经失效；请重新插入该图片后保存。'),{code:'invalid_input'});
      }
    }
    if (!session.id) {
      progress('creating','正在建立灵感记录…');
      if (!session.creation) session.creation = {request:{
        title:snapshot.title, body:'', bodyFormat:snapshot.bodyFormat,
        sourceLabel:snapshot.sourceLabel, sourceUrl:snapshot.sourceUrl, sourceAt:snapshot.sourceAt,
        tags:snapshot.tags, ...session.position, idempotencyKey:io.key(),
      }};
      // 响应丢失时继续使用同一份空记录请求，不能再建一条。
      const item = await io.create(session.creation.request);
      session.id = item.id; session.version = item.updatedAt;
    }
    const upload = async (file, isBodyImage) => {
      progress('uploading',`正在保存${isBodyImage ? '正文图片' : '附件'}原件：${file.name}`);
      const sha256 = await io.hash(file);
      let extracted = '';
      if (!isBodyImage) {
        // 自动文本索引失败不妨碍原件保存；在完成回执中单独说明。
        const indexKey = JSON.stringify({name:file.name,type:file.type,sha256,indexNote:snapshot.indexNote});
        if (!session.indexing.has(indexKey)) {
          try { session.indexing.set(indexKey,{text:await io.index(file),failed:false}); }
          catch { session.indexing.set(indexKey,{text:'',failed:true}); }
        }
        const indexed = session.indexing.get(indexKey);
        extracted = indexed.text;
        if (indexed.failed) snapshot.unindexed = (snapshot.unindexed ?? 0)+1;
      }
      const indexedText = [snapshot.indexNote,extracted].filter(Boolean).join('\n\n').slice(0,100000);
      const signature = JSON.stringify({id:session.id,name:file.name,type:file.type,sha256,indexedText});
      let attempt = session.uploads.get(signature);
      if (!attempt) {
        attempt = {request:{id:session.id,file,sha256,indexedText,idempotencyKey:io.key()},result:null};
        session.uploads.set(signature,attempt);
      }
      if (!attempt.result) attempt.result = await io.upload(attempt.request);
      return attempt.result.attachment;
    };
    const replacements = new Map();
    for (const draft of drafts) replacements.set(draft.url,`attachment:${(await upload(draft.file,true)).id}`);
    for (const file of snapshot.files) await upload(file,false);
    const body = rich ? replaceImageSources(snapshot.body,replacements) : snapshot.body;
    const patch = {title:snapshot.title,body,bodyFormat:snapshot.bodyFormat,
      sourceLabel:snapshot.sourceLabel,sourceUrl:snapshot.sourceUrl,sourceAt:snapshot.sourceAt,tags:snapshot.tags};
    const signature = JSON.stringify({id:session.id,patch});
    if (session.final?.signature !== signature) session.final = {
      signature, request:{id:session.id,expectedUpdatedAt:session.version,idempotencyKey:io.key(),patch},result:null,
    };
    progress('writing','原件已保存，正在写入完整正文…');
    if (!session.final.result) session.final.result = await io.update(session.final.request);
    const saved = session.final.result;
    session.version = saved.updatedAt;
    progress('verifying','正文已提交，正在读回核对…');
    const current = await io.read(session.id);
    const fields = ['body','bodyFormat','title','sourceLabel','sourceUrl','sourceAt','tags','updatedAt'];
    if (fields.some(field => JSON.stringify(current[field]) !== JSON.stringify(saved[field]))) {
      throw Object.assign(new Error('读回内容与本次保存结果不同，可能已被另一端修改。草稿已保留，请核对最新内容。'),{code:'conflict'});
    }
    for (const attempt of session.uploads.values()) {
      if (!attempt.result) continue;
      const original = attempt.result.attachment;
      if (!current.attachments.some(file => file.id === original.id && file.sha256 === original.sha256)) {
        throw new Error('读回未确认已上传原件；草稿和原件标识已保留，请重试核对。');
      }
    }
    return {item:current,wasNew:session.wasNew,unindexed:snapshot.unindexed ?? 0};
  } catch (reason) {
    const error = reason instanceof Error ? reason : new Error('保存失败。');
    error.phase = phase;
    error.recordId = session.id;
    error.uploadedCount = new Set([...session.uploads.values()].filter(attempt => attempt.result).map(attempt => attempt.result.attachment.id)).size;
    throw error;
  }
}
