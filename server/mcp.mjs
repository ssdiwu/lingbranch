import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Library } from './library.mjs';
import { dataDirectory } from './config.mjs';
import { executeTool, toolDefinitions } from './tools.mjs';
import { LibraryError } from './validation.mjs';

const library = new Library(dataDirectory());
const server = new Server({name:'lingbranch',version:'0.1.0'}, {capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async() => ({tools:Object.entries(toolDefinitions).map(([name,tool]) => ({
  name, description:tool.description, inputSchema:zodToJsonSchema(tool.schema,{$refStrategy:'none'}),
  annotations:{readOnlyHint:!!tool.readOnly,destructiveHint:name.startsWith('remove_'),idempotentHint:true,openWorldHint:false},
}))}));
server.setRequestHandler(CallToolRequestSchema,async request => {
  try {
    const result = await executeTool(library,request.params.name,request.params.arguments || {});
    return {content:[{type:'text',text:JSON.stringify(result)}]};
  } catch(error) {
    if (!(error instanceof LibraryError)) console.error('LingBranch tool failed:',error.message);
    return {isError:true,content:[{type:'text',text:JSON.stringify({ok:false,code:error instanceof LibraryError ? error.code : 'unavailable',message:error instanceof LibraryError ? error.message : '存储暂不可用；写入重试须沿用相同参数和标识。'})}]};
  }
});
server.onclose = () => library.close();
// Protocol messages alone go to stdout; diagnostics and SQLite warnings stay on stderr.
// 20 MiB 原件转 Base64 后超过 SDK 默认 10 MiB，按已声明文件上限留足协议开销。
await server.connect(new StdioServerTransport(process.stdin,process.stdout,{maxBufferSize:32*1024*1024}));
