import test from 'node:test';
import assert from 'node:assert/strict';
import { Ctx, Container, Clock } from '@milkdown/kit/ctx';
import { nodesCtx, schemaCtx, remarkCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { docSchema, paragraphSchema, hardbreakSchema, htmlSchema, textSchema } from '@milkdown/kit/preset/commonmark';
import { Schema } from '@milkdown/kit/prose/model';
import { ParserState, SerializerState } from '@milkdown/kit/transformer';
import { exactTextHandler, plainToMarkdown, markdownText, imageNodes } from '../shared/markdown.mjs';

test('实际 Milkdown CommonMark 载入/序列化/再载入保留旧符号、裸URL、已有反斜杠与硬换行',async()=>{
  const ctx=new Ctx(new Container(),new Clock());
  ctx.inject(nodesCtx,[]).inject(remarkStringifyOptionsCtx).inject(remarkCtx);
  ctx.update(remarkStringifyOptionsCtx,options=>({...options,handlers:{...options.handlers,text:exactTextHandler}}));
  for(const plugin of [docSchema,paragraphSchema,hardbreakSchema,htmlSchema,textSchema].flat()){
    if(plugin===hardbreakSchema.node)ctx.update(hardbreakSchema.key,previous=>schemaContext=>({...previous(schemaContext),
      toMarkdown:{match:node=>node.type.name==='hardbreak',runner:state=>state.addNode('text',undefined,'\n')},
    }));
    await plugin(ctx)();
  }
  const schema=new Schema({nodes:Object.fromEntries(ctx.get(nodesCtx))});ctx.inject(schemaCtx,schema);
  // 使用已装 Milkdown 的正式节点、解析器、序列化器和默认 remark 配置。
  const processor=ctx.get(remarkCtx).data('settings',ctx.get(remarkStringifyOptionsCtx));
  const parse=ParserState.create(schema,processor),serialize=SerializerState.create(schema,processor);
  const samples=[
    '这是自编旧格式正文，所有符号按字面保留。\n*强调示例*\n# 标题示例\n![外部示意](https://example.com/image.png)\n<script>自编文字示例</script>',
    '原有反斜杠：C:\\photos\\today.png\\\n\\*这是字面符号\\*\n![图](https://example.com/picture.png)\n<script>只是文字</script>',
    '字面代码：`a\\b`\n# 标题并不生效\n* 列表并不生效\n结尾反斜杠\\',
    '末尾换行\n', '\n', '末尾连续换行\n\n\n',
    '已有反斜杠\\\n', '字面 &#10; 与 &#32; 不解码为换行\n',
    '  ', '\t', ' \n\t\n', '前有空格   \n最后空格 ',
  ];
  for(const raw of samples){
    let markdown=plainToMarkdown(raw);
    assert.equal(markdownText(markdown),raw,'转换本身保留全部字符');
    for(let round=0;round<3;round++){
      const doc=parse(markdown);markdown=serialize(doc);
      assert.equal(markdownText(markdown),raw,`第${round+1}次真实编辑器往返保持原文`);
      assert.equal(imageNodes(markdown).length,0,'字面图片语法不成为真实图片');
      let htmlNodes=0;doc.descendants(node=>{if(node.type.name==='html')htmlNodes++;});
      assert.equal(htmlNodes,0,'旧 HTML 符号保持文字');
    }
  }
  let manualBreak='行前\\\n行后';
  for(let round=0;round<3;round++)manualBreak=serialize(parse(manualBreak));
  assert.equal(markdownText(manualBreak),'行前\n行后','编辑器硬换行使用同一文字编码');
});
