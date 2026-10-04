#!/usr/bin/env node
import { isAbsolute, join } from 'node:path';
import { stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const project = process.env.LINGBRANCH_PROJECT_DIR;
try {
  if (!project || !isAbsolute(project)) throw new Error('请设置 LINGBRANCH_PROJECT_DIR 为已安装依赖的 LingBranch 仓库绝对路径。');
  const entry = join(project,'cli/lingbranch.mjs');
  if (!(await stat(entry)).isFile()) throw new Error('指定项目缺少 cli/lingbranch.mjs，请核对 LingBranch 版本。');
  const child = spawn(process.execPath,[entry,...process.argv.slice(2)],{stdio:'inherit',env:process.env});
  const forward = signal => child.kill(signal);
  const onInt = () => forward('SIGINT'), onTerm = () => forward('SIGTERM');
  process.on('SIGINT',onInt); process.on('SIGTERM',onTerm);
  const code = await new Promise((resolve,reject) => {
    child.once('error',reject);
    child.once('exit',(code,signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : 143)));
  });
  process.off('SIGINT',onInt); process.off('SIGTERM',onTerm);
  process.exitCode = code;
} catch(error) {
  console.log(JSON.stringify({ok:false,code:'configuration_required',message:error.message}));
  process.exitCode = 1;
}
