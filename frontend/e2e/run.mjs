/**
 * E2E 护栏总入口：静态 → API → UI，任一红则 exit 1
 *   npm run e2e           全量
 *   npm run e2e:static    只跑静态（秒级，适合每次 commit 前）
 *   npm run e2e:api       只跑 API
 *   npm run e2e:ui        只跑浏览器
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv[2]; // static | api | ui
const stages = only ? [only] : ['static', 'api', 'ui'];

const failed = [];
for (const s of stages) {
  console.log(`\n════════ ${s.toUpperCase()} ════════`);
  const r = spawnSync('node', [path.join(dir, s + '.mjs')], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(s);
}

console.log('\n════════ E2E 护栏 ════════');
console.log(failed.length ? `❌ 失败阶段: ${failed.join(', ')}` : `✅ 全部通过（${stages.join(' → ')}）`);
process.exit(failed.length ? 1 : 0);
