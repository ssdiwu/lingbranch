import { writeFile } from 'node:fs/promises';
import { Library } from './library.mjs';
import { dataDirectory } from './config.mjs';
import { exportBundle, restoreBundle, readBundleFile } from './bundle.mjs';

const [action,path,target] = process.argv.slice(2);
try {
  if (action === 'export' && path && !target) {
    const library = new Library(dataDirectory());
    try { await writeFile(path,await exportBundle(library),{flag:'wx',mode:0o600}); }
    finally { library.close(); }
    console.log('已导出完整资料包。');
  } else if (action === 'restore' && path && target) {
    console.log(JSON.stringify(await restoreBundle(await readBundleFile(path),target)));
  } else throw new Error('用法：npm run backup -- <资料包路径>；npm run restore -- <资料包路径> <新目录>');
} catch(error) { console.error(error.message); process.exitCode = 1; }
