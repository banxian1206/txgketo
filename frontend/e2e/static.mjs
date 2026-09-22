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

// P-20：生成领料单失败 = 卡片内常驻 Alert（不是一闪 toast）
const wh = fs.readFileSync(path.join(SRC, 'pages/Warehouse.tsx'), 'utf8');
check('P-20', /P-20/.test(wh) && /<Alert/.test(wh), 'Warehouse 有 P-20 常驻 Alert');

// P-14：手工申请物料搜索旁有「去标准库新建」出口
check('P-14', has('components/ManualPurchaseModal.tsx', /去标准库新建/), '手工申请有标准库出口');

// 视觉规范 §8 结构性指标：当前基线防倒退（Phase 1.5 收敛后把基线改成目标值 1）
const colorMaps = grepAll(/_COLOR\s*:\s*Record/);
const COLOR_BASELINE = 43; // 2026-09-22 实测；Phase1.5 目标 =1，届时收紧
check('VIS-状态色Map', colorMaps.length <= COLOR_BASELINE,
  `${colorMaps.length} 个（基线 ${COLOR_BASELINE}；Phase1.5 目标 =1，届时收紧此断言）`);

// 图标：emoji 不进 UI chrome（视觉规范 §4）—— 基线 9（全在 MobileLayout，Phase1.5 换 antd icons 后收紧为 0）
const emoji = grepAll(/icon:\s*'[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
const EMOJI_BASELINE = 9;
check('VIS-emoji图标', emoji.length <= EMOJI_BASELINE,
  emoji.length ? `残留 ${emoji.length}（基线 ${EMOJI_BASELINE}，均在 MobileLayout，Phase1.5 处理）` : 'icon 无 emoji = 0');

const fails = summary('静态回归');
exitWith(fails);
