import { homedir } from 'node:os';
import { join, isAbsolute, basename } from 'node:path';
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { projectRoot } from '../server/config.mjs';

const args = process.argv.slice(2);
try {
  if (args.length > 1) throw new Error('只接受一个目标技能目录。');
  const destination = args[0] || join(homedir(),'.agents','skills','lingbranch');
  if (!isAbsolute(destination)) throw new Error('目标技能目录必须是绝对路径。');
  if (basename(destination) !== 'lingbranch') throw new Error('目标末级目录必须为 lingbranch，与技能 name 一致。');
  const sources = {
    'SKILL.md':join(projectRoot,'skills/lingbranch/SKILL.md'),
    'references/cli.md':join(projectRoot,'skills/lingbranch/references/cli.md'),
    'scripts/lingbranch.mjs':join(projectRoot,'skills/lingbranch/scripts/lingbranch.mjs'),
    'LICENSE':join(projectRoot,'LICENSE'),
  };
  const contents = {};
  for (const [name,path] of Object.entries(sources)) {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('技能源文件必须是普通文件。');
    contents[name] = await readFile(path);
  }
  await mkdir(join(destination,'..'),{recursive:true});
  // mkdir is the exclusive reservation: even an existing empty directory or symlink is rejected.
  await mkdir(destination);
  for (const [name,content] of Object.entries(contents)) {
    const path = join(destination,name);
    await mkdir(join(path,'..'),{recursive:true});
    await writeFile(path,content,{flag:'wx',mode:0o644});
  }
  console.log(JSON.stringify({ok:true,outcome:'installed',destination,files:Object.keys(contents),
    configuration:{LINGBRANCH_PROJECT_DIR:'已安装依赖的 LingBranch 仓库绝对路径',LINGBRANCH_DATA_DIR:'与网页和 MCP 相同的绝对数据目录'},
    note:'安装普通文件，不修改 AI 客户端配置；技能助手仍需要本机已安装的 LingBranch 项目。'}));
} catch(error) {
  console.log(JSON.stringify({ok:false,code:error.code === 'EEXIST' ? 'already_exists' : 'installation_failed',
    message:error.code === 'EEXIST' ? '目标已经存在，未覆盖；先检查已有技能或选择新目录。' : error.message}));
  process.exitCode = 1;
}
