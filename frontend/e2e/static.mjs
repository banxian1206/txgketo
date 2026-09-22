/**
 * 静态回归：代码级断言（不启动浏览器，毫秒级）
 * 覆盖：P-12 prompt / P-16 弃用属性 / P-19 骨架 / P-20 常驻Alert / P-14 标准库入口
 * 目的：防止"重构又把反模式写回来"——grep 断言是结构性护栏
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, summary, exitWith, results } from './lib.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

function grepAll(pattern) {
  const hits = [];
  const walk = dir => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f)) {
        const lines = fs.readFileSync(p, 'utf8').split('\n');
        lines.forEach((l, i) => {
          const code = l.trim();
          if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return; // 注释不算反模式
          if (pattern.test(l)) hits.push(`${p.replace(SRC, 'src')}:${i + 1}`);
        });
      }
    }
  };
  walk(SRC);
  return hits;
}

const has = (file, re) => re.test(fs.readFileSync(path.join(SRC, file), 'utf8'));

// P-12：原生 prompt 全站禁止（交互规范反模式清单）
const prompts = grepAll(/window\.prompt/);
check('P-12', prompts.length === 0, prompts.length ? `残留: ${prompts.join(', ')}` : 'window.prompt = 0');

// P-16：antd 弃用属性（destroyOnClose → destroyOnHidden；addonAfter → Space.Compact/suffix）
const dlc = grepAll(/destroyOnClose/);
check('P-16a', dlc.length === 0, dlc.length ? `destroyOnClose 残留 ${dlc.length}: ${dlc.slice(0,3).join(', ')}` : 'destroyOnClose = 0');
const aa = grepAll(/addonAfter/);
check('P-16b', aa.length === 0, aa.length ? `addonAfter 残留 ${aa.length}: ${aa.slice(0,3).join(', ')}` : 'addonAfter = 0');

// P-19：发运清单抽屉有骨架屏
check('P-19', has('pages/Shipping.tsx', /Skeleton/), 'Shipping 含 Skeleton');

// P-20：生成领料单失败 → 卡片内常驻（genErr 为该功能专属 state，路径无关）
const p20 = grepAll(/genErr/);
check('P-20', p20.length >= 2, p20.length ? `genErr 常驻提示在（${p20.length} 处）` : '找不到 genErr 常驻实现');

// P-14：手工申请物料搜索旁有「去标准库新建」出口
check('P-14', has('components/ManualPurchaseModal.tsx', /去标准库新建/), '手工申请有标准库出口');

// 视觉规范 §8 结构性指标：当前基线防倒退（Phase 1.5 收敛后把基线改成目标值 1）
const colorMaps = grepAll(/_COLOR\s*:\s*Record/);
// 1.5 已收敛：43 张散落 Map → theme/status.ts（24 张域表），业务文件禁止再定义
check('VIS-状态色Map', colorMaps.length === 0,
  colorMaps.length ? `业务文件又冒出自定义状态色 Map: ${colorMaps.slice(0, 4).join(', ')}` : '0（全部收敛在 theme/status.ts）');

// 图标：emoji 不进 UI chrome（视觉规范 §4 · 1.5b 已换 antd icons，业务代码 = 0）
const emoji = grepAll(/icon:\s*'[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
const emojiTree = grepAll(/[📦🔩🧩]/u); // 图纸树层级方块（u flag：按码点匹配，否则代理码元误伤 💡📄 等内容符号）
check('VIS-emoji图标', emoji.length + emojiTree.length === 0,
  emoji.length + emojiTree.length ? `残留: ${[...emoji, ...emojiTree].slice(0, 4).join(', ')}` : 'icon emoji = 0（含图纸树层级）');

// 1.5b：业务代码禁止裸 hex（唯一合法来源 theme/tokens.ts；styles.css 属主题层不在扫描内）
const hexes = grepAll(/#[0-9a-fA-F]{3,8}\b/).filter((h) => !h.includes('theme/'));
check('VIS-hex', hexes.length === 0,
  hexes.length ? `业务文件裸 hex: ${hexes.slice(0, 4).join(', ')}` : '0（全部走 T token）');

// 1.5b：字号 5 档 {12,13,14,16,20}（白名单反向：命中非法档 = 失败）
const badSize = grepAll(/fontSize: ?(11|15|17|18|19|21|22|23|24|25|26|28|30|32)\b/);
check('VIS-fontSize', badSize.length === 0,
  badSize.length ? `越档字号: ${badSize.slice(0, 4).join(', ')}` : '5 档 {12,13,14,16,20} 内');

// 1.3 Auth 收口：登录态 localStorage 只允许 contexts/session.ts 碰（grepAll 已跳过注释行）
const strayStorage = grepAll(/localStorage\.(getItem|setItem|removeItem)\(['"]txgk_/)
  .filter((h) => !h.includes('contexts/session.ts'));
check('AUTH-单一存储', strayStorage.length === 0,
  strayStorage.length ? `散点残留: ${strayStorage.slice(0, 4).join(', ')}` : '登录态读写只在 session.ts');
const strayParse = grepAll(/JSON\.parse\(localStorage/)
  .filter((h) => !h.includes('contexts/session.ts'));
check('AUTH-无散读', strayParse.length === 0,
  strayParse.length ? `JSON.parse(localStorage 散读: ${strayParse.slice(0, 4).join(', ')}` : '无散读（仅迁移器合法）');

// 2.2：表单提交 reject 不许逃逸（P-09 类 pageerror 根治）——新代码禁写裸 validateFields
const bareValidate = grepAll(/const \w+ = await \w+\.validateFields\(\)/);
check('SUBMIT-无裸validate', bareValidate.length === 0,
  bareValidate.length ? `裸 await validateFields 又出现: ${bareValidate.slice(0, 4).join(', ')}` : '0（一律 let+try/catch 或 useSubmit）');

const fails = summary('静态回归');
exitWith(fails);
