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


// P-12：原生 prompt 全站禁止（交互规范反模式清单）
const prompts = grepAll(/window\.prompt/);
check('P-12', prompts.length === 0, prompts.length ? `残留: ${prompts.join(', ')}` : 'window.prompt = 0');

// P-16：antd 弃用属性（destroyOnClose → destroyOnHidden；addonAfter → Space.Compact/suffix）
const dlc = grepAll(/destroyOnClose/);
check('P-16a', dlc.length === 0, dlc.length ? `destroyOnClose 残留 ${dlc.length}: ${dlc.slice(0,3).join(', ')}` : 'destroyOnClose = 0');
const aa = grepAll(/addonAfter/);
check('P-16b', aa.length === 0, aa.length ? `addonAfter 残留 ${aa.length}: ${aa.slice(0,3).join(', ')}` : 'addonAfter = 0');

// P-19：发运清单抽屉有骨架屏
// P-19：发运清单骨架屏（路径无关 grepAll —— 静态断言禁止硬编码文件路径，P-20 教训）
const skel = grepAll(/Skeleton active/);
check('P-19', skel.length >= 1, skel.length ? `骨架屏在（${skel[0]}）` : '找不到 Skeleton active');

// P-20：生成领料单失败 → 卡片内常驻（genErr 为该功能专属 state，路径无关）
const p20 = grepAll(/genErr/);
check('P-20', p20.length >= 2, p20.length ? `genErr 常驻提示在（${p20.length} 处）` : '找不到 genErr 常驻实现');

// P-14：手工申请物料搜索旁有「去标准库新建」出口
const stdLink = grepAll(/去标准库新建/);
check('P-14', stdLink.length >= 1, stdLink.length ? '手工申请有标准库出口' : '找不到去标准库新建出口');

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

// 3.3 PWA SW：仅生产注册（dev/e2e 不注册=防缓存污染）+ API 绝不进缓存
{
  const sw = fs.readFileSync(path.join(SRC, '../public/sw.js'), 'utf8');
  const main = fs.readFileSync(path.join(SRC, 'main.tsx'), 'utf8');
  const prodGuard = /import\.meta\.env\.PROD[\s\S]{0,260}register\('/.test(main);
  const apiBypass = /startsWith\('\/api\/'\)/.test(sw) && /method !== 'GET'/.test(sw);
  check('PWA-SW守卫', prodGuard && apiBypass,
    (prodGuard ? '' : '注册缺 PROD 守卫; ') + (apiBypass ? 'API 旁路缓存 ✓' : 'API 未旁路缓存'));
}

// 观察-01：发货与收货一致（客户口径）—— 现场只清点「已发」项；0 项已发不能清点；发运要通知现场
{
  const ROOT = path.resolve(SRC, '../..');
  const shipSvc = fs.readFileSync(path.join(ROOT, 'backend/app/services/shipping.py'), 'utf8');
  const shipRoute = fs.readFileSync(path.join(ROOT, 'backend/app/api/routes/shipping.py'), 'utf8');
  const okReceipt = /shipped = \[i for i in items if i\.shipped\]/.test(shipSvc) && /本批一项都没勾/.test(shipSvc);
  const okRoute = /已勾「已发」\{shipped_count\} 项/.test(shipRoute);
  const okNotify = /notify_role\([\s\S]{0,140}"SITE"/.test(shipSvc);
  check('SHIP-发货收货一致', okReceipt && okRoute && okNotify,
    [okReceipt ? '' : '清点未按已发项', okRoute ? '' : '路由仍按全清单计数', okNotify ? '' : '发运未通知现场']
      .filter(Boolean).join('; ') || '清点只核已发 + 0项拦截 + 发运通知现场 ✓');
}

// P-03/R2-02：禁止「先 setFieldsValue 后开弹窗」的手写预填（destroyOnHidden 弹窗会丢值）
// 正确做法：AppModal + initialValues（挂载时读取）；或 forceRender 让 Form 提前挂载
{
  const bad = [];
  const walk = dir => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.tsx$/.test(f)) {
        const src = fs.readFileSync(p, 'utf8');
        if (!src.includes('setFieldsValue(')) continue;
        // ★ 销毁式弹窗有两种来源：自己写 destroyOnHidden，或用 AppModal（基座内部就带销毁）
        //   旧版只认前者 → 改用 AppModal 的文件反而漏扫（自证注入时发现的）
        const hasDestroy = /destroyOnHidden/.test(src) || /<AppModal\b/.test(src);
        if (!hasDestroy) continue;
        // 逐弹窗判定（整文件豁免也是盲区：一个 forceRender 弹窗放过全文件）
        const blocks = [...src.matchAll(/<(Modal|Drawer)\b([\s\S]{0,600}?)>/g)].map(m => m[2]);
        const plainModalCount = blocks.filter(b => !b.includes('forceRender')).length;
        if (!src.includes('destroyOnHidden') && !src.includes('<AppModal') ) continue;
        if (plainModalCount === 0 && !src.includes('<AppModal')) continue; // 只有 forceRender 弹窗 → 安全
        const lines = src.split('\n');
        lines.forEach((l, i) => {
          if (!l.includes('setFieldsValue(')) return;
          const win = lines.slice(i, i + 22).join('\n');
          if (/set\w*(?:Open|Target|Modal|Visible)\s*\((?!false)/.test(win)) { // 不挑参数：setTarget(r) 这种传变量的也曾漏判（现场清点「齐」预选丢）
            bad.push(`${p.replace(SRC, 'src')}:${i + 1}`);
          }
        });
      }
    }
  };
  walk(SRC);
  check('PREFILL-无先设后开', bad.length === 0,
    bad.length ? `手写预填残留（改 AppModal+initialValues）: ${bad.slice(0, 5).join(', ')}` : '无「先 setFieldsValue 后开弹窗」残留');
}

// R5-01（客户口径①+②）：装车与发运共用「0 项已发」门禁，且已装车档仍可补勾（否则死端复发）
{
  const f = path.resolve(SRC, '../../backend/app/services/shipping.py');
  const s = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  const body = (name) => {
    const i = s.indexOf(`def ${name}(`);
    return i < 0 ? '' : s.slice(i, s.indexOf('\ndef ', i + 1));
  };
  const ld = body('load'), dp = body('depart'), mk = body('mark_shipped');
  const gateLine = (b) => (b.split('\n').find(l => l.includes('status not in')) ?? '');
  const ok = /_shipped_count\(session, sh\)/.test(ld) && /_shipped_count\(session, sh\)/.test(dp)
    && /SHIP_LOADED/.test(gateLine(mk)) && !/SHIP_TRANSIT/.test(gateLine(mk));
  check('SHIP-装车发运双门禁', ok,
    `装车含0项门禁=${/_shipped_count/.test(ld)} 发运含=${/_shipped_count/.test(dp)} ` +
    `补勾允许已装车=${/SHIP_LOADED/.test(gateLine(mk))} 发运后锁死=${!/SHIP_TRANSIT/.test(gateLine(mk))}`);
}

// R4-01（客户口径 A）：移动端不得链到 PC-only 工作台路由（任务/评审/改版无移动页）
{
  const PC_ONLY = ['/my-tasks', '/reviews', '/changes', '/mine/tasks', '/mine/reviews', '/mine/changes'];
  const bad = [];
  for (const rel of ['features/home/MePage.tsx', 'features/home/MobilePage.tsx']) {
    const p = path.join(SRC, rel);
    if (!fs.existsSync(p)) continue;
    fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
      const t = l.trim();
      if (t.startsWith('//') || t.startsWith('*')) return;
      const m = l.match(/(?:to:|nav\()\s*['"`](\/[^'"`]+)['"`]/);
      if (m && PC_ONLY.includes(m[1])) bad.push(`src/${rel}:${i + 1} → ${m[1]}`);
    });
  }
  check('R4-01-移动不链PC台', bad.length === 0,
    bad.length ? `移动端又链到 PC-only 路由: ${bad.join(', ')}` : '移动首页/我的页已无 PC-only 入口（任务/评审/改版）');
}

// ══ 双端一致性护栏（本轮起：PC 与移动端不再各改各的）══════════════════
const FEATS = path.join(SRC, 'features');

// T-1 数据同源：同模块若 PC 用了共享看板 hook，移动端必须用同一个（防两端各拉各的数据）
{
  const bad = [];
  for (const f of fs.readdirSync(FEATS)) {
    const pc = path.join(FEATS, f, 'Page.tsx'), mo = path.join(FEATS, f, 'MobilePage.tsx');
    if (!fs.existsSync(pc) || !fs.existsSync(mo)) continue;
    const pick = p => (fs.readFileSync(p, 'utf8').match(/use\w+Board/g) ?? []);
    const a = [...new Set(pick(pc))], b = [...new Set(pick(mo))];
    if (a.length && !a.every(h => b.includes(h))) bad.push(`${f}: PC=${a.join('|')} 移动=${b.join('|') || '无'}`);
  }
  check('TERM-双端数据同源', bad.length === 0, bad.length ? `移动端未复用 PC 的看板 hook: ${bad.join('; ')}` : '双端模块均复用同一 use*Board（一份数据两个壳）');
}

// T-2 门禁文案双端齐备：同一业务门禁不能只写在一端（历史上 PC 有 0 项硬拦、移动没有）
{
  const GATES = [
    ['features/shipping', ['一项都没勾', '装车要拍照']],
    ['features/warehouse', ['验收', '入库']],
    ['features/site', ['拍照']],
  ];
  const bad = [];
  for (const [dir, keys] of GATES) {
    const pc = path.join(SRC, dir, 'Page.tsx'), mo = path.join(SRC, dir, 'MobilePage.tsx');
    if (!fs.existsSync(pc) || !fs.existsSync(mo)) continue;
    const a = fs.readFileSync(pc, 'utf8'), b = fs.readFileSync(mo, 'utf8');
    for (const k of keys) {
      const inA = a.includes(k), inB = b.includes(k);
      if (inA !== inB) bad.push(`${dir} 「${k}」 ${inA ? '只在PC' : '只在移动'}`);
    }
  }
  check('TERM-门禁双端齐备', bad.length === 0, bad.join('; ') || '关键门禁/动作文案两端都在（不再一端修一端漏）');
}

// T-3 D3 收紧后：发运入口只能挂在「已装车」，两端都不得再放行 发货中/已指令
{
  const bad = [];
  for (const rel of ['features/shipping/Page.tsx', 'features/shipping/MobilePage.tsx']) {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
    const line = src.split('\n').find(l => /doDepart\)?\(?/.test(l) && /发\s*运/.test(l) && /includes\(/.test(l)) ?? '';
    if (/发货中|已指令/.test(line)) bad.push(`${rel}: ${line.trim().slice(0, 60)}`);
  }
  check('TERM-发运入口仅已装车', bad.length === 0, bad.join(' | ') || '两端「发运」入口都只在「已装车」档出现（S7 顺序：勾已发→装车→发运）');
}

// T-4 redirect 只做兼容层：站内导航不得再引用旧路径（新路径为准）
{
  const dom = fs.readFileSync(path.join(SRC, 'configs/domain.tsx'), 'utf8');
  const fromList = [...new Set([...dom.matchAll(/\[\s*'(\/[^']+)',\s*'\/[^']+'\s*\]/g)].map(m => m[1]))].filter(x => x !== '/');
  const nav = /(?:nav|navigate|goTo)\(\s*['"`](\/[^'"`]+)['"`]|to=\{?['"`](\/[^'"`]+)['"`]|location\.href = ['"`](\/[^'"`]+)['"`]|to: ['"`](\/[^'"`]+)['"`]/g;
  const bad = [];
  const walk = d => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) { if (f !== 'configs') walk(p); continue; }
      if (!/\.tsx$/.test(f)) continue;
      const src = fs.readFileSync(p, 'utf8');
      src.split('\n').forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith('//') || t.startsWith('*')) return;
        let m;
        nav.lastIndex = 0;
        while ((m = nav.exec(l))) {
          const used = m.slice(1).find(Boolean);
          if (used && fromList.includes(used)) bad.push(`${p.replace(SRC, 'src')}:${i + 1} → ${used}`);
        }
      });
    }
  };
  walk(SRC);
  check('NAV-导航不用旧路径', bad.length === 0,
    bad.length ? `站内仍引用 redirect 旧路径（应换新路径，redirect 只留兼容）: ${bad.slice(0, 6).join(', ')}`
      : `站内导航引用零处命中 ROUTE_REDIRECTS 的 ${fromList.length} 条旧路径`);
}

/* ══════════ TAB-页签护栏（后台信息架构重整 docs/10 §4 · 防回潮）══════════
   这三条各自对着一个实测出来的结构性毛病，不是审美：
   G1 一屏叠多条页签条（旧实测 pm1 点「我的任务」叠了 4 条）
   G2 页签条是散写的静态数组 → 永远没有权限过滤（旧实测 17 条里 15 条零过滤）
   G3 可见性用「岗位」猜 / 写不存在的假权限码（旧实测 4 总监+gm 看得到「外部集成」、点了必 403） */
{
  const bad = []
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p2 = path.join(d, f)
      if (fs.statSync(p2).isDirectory()) { walk(p2); continue }
      if (!/\.tsx$/.test(f)) continue
      const n = (fs.readFileSync(p2, 'utf8').match(/<Tabs\b/g) || []).length
      if (n > 1) bad.push(`${p2.replace(SRC, 'src')} 有 ${n} 条页签条`)
    }
  }
  walk(FEATS)
  check('TAB-一屏一条页签条', bad.length === 0,
    bad.length ? `同一页面又叠了多条页签条（第二层改用 Segmented/筛选，跨页改用子路由）: ${bad.join('; ')}`
      : 'features/ 下每个页面最多 1 条 <Tabs>')
}
{
  // 例外必须写清为什么，且只允许这几条（新增一条就得在这儿交代）
  const EXEMPT = {
    'features/workbench/ShopShell.tsx': '台内「看板/制造/装配」是子路由导航（URL 即状态），不是页签状态',
    'features/manufacturing/MobilePage.tsx': '移动端动线页签，键与 PC 不同（os vs outsource），接入注册表见 docs/10 P2',
    'features/warehouse/MobilePage.tsx': '同上（移动端三队列）',
    'features/site/MobilePage.tsx': '同上（移动端含客户验收，PC 按拍板 D3 不做签认）',
  }
  const bad = []
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p2 = path.join(d, f)
      if (fs.statSync(p2).isDirectory()) { walk(p2); continue }
      if (!/\.tsx$/.test(f)) continue
      const rel = p2.replace(SRC + '/', '')
      const src = fs.readFileSync(p2, 'utf8')
      if (!/<Tabs\b/.test(src)) continue
      if (EXEMPT[rel]) continue
      const byRegistry = /configs\/tabs/.test(src)
      const filtered = /filterTabs\(|visKeys/.test(src)
      const urlDriven = /useTab\(/.test(src)
      if (!byRegistry || !filtered) bad.push(`${rel}（注册表=${byRegistry} 权限过滤=${filtered} URL驱动=${urlDriven}）`)
      else if (!urlDriven) bad.push(`${rel}（页签状态没进 URL）`)
    }
  }
  walk(FEATS)
  check('TAB-页签来自注册表', bad.length === 0,
    bad.length ? `页签条没走 configs/tabs 注册表或没按权限过滤: ${bad.join('; ')}`
      : 'PC 页签条一律由注册表驱动 + filterTabs 权限过滤 + useTab 进 URL')
}
{
  // ★ 这条只管一件事：入口/页签的**可见性**不许靠岗位猜（那必然漂移成「看得见、点了必 403」——
  //   实测过 4 位总监 + gm 看得到「外部集成」，点进去每个请求 403）。
  //   业务规则里的岗位判断（拆分派工限本专业经理、候选池按岗位筛人）是合法的，不在射程内：
  //   它们对应后端同一套岗位规则（tasks._can_act_on_task / split），不是“给不给你看门”。
  const guess = grepAll(/can(Manage|Admin|See|Access)\w*\s*=[^\n]*position\s*===/)
  check('TAB-可见性不猜岗位', guess.length === 0,
    guess.length ? `入口可见性由岗位猜（改用 hasPerm('admin:users') 这类后端能力位）: ${guess.join(', ')}`
      : '管理入口可见性一律来自后端能力位（0 处由 position 推导）')
  // 权限码必须是后端真存在的码（派生码 admin:users / admin:audit 由 deps.effective_permissions 下发）
  const KNOWN = new Set([
    'system:admin', 'project:view', 'project:edit', 'project:close', 'project:amount',
    'customer:view', 'customer:edit', 'contract:view', 'contract:edit', 'payment:edit',
    'design:view', 'design:edit', 'design:audit', 'std:view', 'std:edit',
    'purchase:view', 'purchase:edit', 'purchase:price', 'purchase:payment',
    'warehouse:view', 'warehouse:edit', 'mfg:view', 'mfg:edit',
    'ship:edit', 'site:edit', 'acceptance:edit', 'service:edit', 'cost:view',
    'admin:users', 'admin:audit', // ★ 派生码（管理员=全部 / 总监=本部门）
  ])
  const used = new Set()
  for (const m of (fs.readFileSync(path.join(SRC, 'configs', 'tabs.ts'), 'utf8')
    + fs.readFileSync(path.join(SRC, 'configs', 'domain.tsx'), 'utf8')
    + fs.readFileSync(path.join(SRC, 'App.tsx'), 'utf8')).matchAll(/anyOf:\s*\[([^\]]*)\]/g)) {
    for (const c of m[1].matchAll(/'([^']+)'/g)) used.add(c[1])
  }
  const fake = [...used].filter((c) => !KNOWN.has(c))
  check('TAB-权限码非假码', fake.length === 0,
    fake.length ? `页签/路由用了后端不存在的权限码（旧例：侧栏 perm:'mfg' 谁都不认识）: ${fake.join(', ')}`
      : `${used.size} 个 anyOf 权限码全部在后端权限表/派生码之内`)
}

{
  // ★ docs/11：台/业务域里点进项目必须带来源（go() → ?from=），否则侧栏被抢、台条消失、返回口骗人。
  //   静态盯，不看数据 —— 加新链接时忘了带 from，当场红。
  const DOMAINS = ['features/workbench', 'features/purchase', 'features/warehouse', 'features/task',
    'features/site', 'features/assembly', 'features/manufacturing', 'features/service',
    'features/shipping', 'features/acceptance', 'features/review', 'features/change', 'features/design']
  const bad = []
  for (const d of DOMAINS) {
    const abs = path.join(SRC, d)
    if (!fs.existsSync(abs)) continue
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir)) {
        const p2 = path.join(dir, f)
        if (fs.statSync(p2).isDirectory()) { walk(p2); continue }
        if (!/\.tsx$/.test(f)) continue
        p2 && fs.readFileSync(p2, 'utf8').split('\n').forEach((l, i) => {
          if (/nav\([`'"]\/projects/.test(l) && !/\bgo\(/.test(l)) bad.push(`${p2.replace(SRC, 'src')}:${i + 1}`)
        })
      }
    }
    walk(abs)
  }
  check('NAV-跨域跳转带来源', bad.length === 0,
    bad.length ? `台/业务域里出现裸 nav('/projects…')（应改用 useGoFrom 的 go() 带 ?from=）: ${bad.slice(0, 6).join(', ')}`
      : '台/业务域 → 项目的跳转全部走 go()（来源随链路透传）')
}

/* ══════════ VIS-视觉底座棘轮（docs/12 §6 · P0）══════════
   「观感」这种东西一旦没人盯就会漂回去，所以做成棘轮：只许降、不许升。
   基线数取本次改造前实测值，每做完一期就把数字往下改一格。 */
{
  const SCALE = new Set([12, 13, 14, 16, 20, 24])
  const files = []
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const p2 = path.join(d, f); if (fs.statSync(p2).isDirectory()) walk(p2); else if (/\.tsx?$/.test(f)) files.push(p2) } }
  walk(SRC)
  let inline = 0, offScale = [], docRef = [], monoCols = 0
  for (const f of files) {
    let src = fs.readFileSync(f, 'utf8')
    // 设计系统实现层自己当然要用 style 组装 —— 它不算「页面各写各的」
    if (!/components\/ui\//.test(f)) inline += (src.match(/style=\{\{/g) || []).length
    src.replace(/fontSize:\s*(\d+)/g, (_, n) => { if (!SCALE.has(+n)) offScale.push(`${f.replace(SRC, 'src')}:${n}`); return _ })
    // 剥掉注释后再找「把内部文档口径写给用户看」的地方
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    code.split('\n').forEach((l, i) => {
      const isJsxText = />[^<>]*卷\s*§/.test(l)
      const isLabel = /(?:label|title|placeholder|description|message)\s*[:=][^\n]*卷\s*§/.test(l)
      if (isJsxText || isLabel) docRef.push(`${f.replace(SRC, 'src')}:${i + 1}`)
    })
    if (/from '[^']*ui\/Primitives'/.test(src) && /CodeNo|NumCell/.test(src)) monoCols++
  }
  // ★ 棘轮基线（2026-09-29 实测）：改完一期就下调一次，绝不许往上抬
  const BASE_INLINE = 857
  const BASE_DOCREF = 0
  check('VIS-inline棘轮', inline <= BASE_INLINE, `inline style ${inline} 处（基线 ${BASE_INLINE}，只许降）`)
  check('VIS-字号在刻度内', offScale.length === 0, offScale.length ? `不在 FS 刻度(12/13/14/16/20/24)里的字号: ${offScale.slice(0, 5).join(', ')}` : '全部字号来自 FS 刻度')
  check('VIS-用户文案不引内部文档', docRef.length <= BASE_DOCREF,
    docRef.length ? `JSX 文案里出现「卷 §」（内部口径该进 Tooltip/帮助，不该上屏）: ${docRef.slice(0, 5).join(', ')}` : '用户可见文案零处引用内部文档章节号')
  check('VIS-等宽编号已启用', monoCols >= 1, `使用 CodeNo/NumCell 的文件数 = ${monoCols}`)
}

/* ══════════ 台类页统一壳（docs/12 §2-B · P2）══════════
   实测过的病：台条「仓库工作台⑦」→ 卡标题「仓库」→ 3 张数字卡(4/2/1) → 页签「待办(7)」
   —— 同一批事被数了两遍、标题重复三层，还互相矛盾（卡说库存 4 种、页签说库存 5）。 */
{
  // V4 单壳单标题：有页签的页面最多一个外层卡片标题
  const bad = []
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p2 = path.join(d, f)
      if (fs.statSync(p2).isDirectory()) { walk(p2); continue }
      if (!/Page\.tsx$/.test(f)) continue
      const src = fs.readFileSync(p2, 'utf8')
      if (!/<Tabs\b/.test(src)) continue
      const outer = (src.match(/^\s{0,6}<Card title=/gm) || []).length + (src.match(/^\s{0,6}title=\{$/gm) || []).length
      if (outer > 1) bad.push(`${p2.replace(SRC, 'src')} 外层标题 ${outer} 个`)
    }
  }
  walk(path.join(SRC, 'features'))
  check('SHELL-单壳单标题', bad.length === 0, bad.length ? bad.join('; ') : '带页签的页面都只有一个外层标题（不再台条+卡标题+小标题三层）')

  // V5 计数单源：这些台已改为「页签带计数」，数字卡再回来就是双份计数
  const CLEAN = ['features/purchase/Page.tsx', 'features/warehouse/Page.tsx', 'features/manufacturing/Page.tsx', 'features/site/Page.tsx']
  const dup = CLEAN.filter((rel) => {
    const f = path.join(SRC, rel)
    return fs.existsSync(f) && /<Statistic\b/.test(fs.readFileSync(f, 'utf8'))
  })
  check('SHELL-计数单源', dup.length === 0,
    dup.length ? `这些台又加了数字卡，与页签计数重复：${dup.join(', ')}` : '采购/仓库/制造/现场台计数只在页签上（独有指标已上标题徽标）')
}

/* ══════════ P3 列表与详情（docs/12 §2-A / §5）══════════ */
{
  // 详情视图必须用抽屉（规范 §5.1：详情 Drawer 560~720；Modal 只留给动作）
  const detailFiles = []
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p2 = path.join(d, f)
      if (fs.statSync(p2).isDirectory()) { walk(p2); continue }
      if (/Detail(Modal)?\.tsx$/.test(f)) detailFiles.push(p2)
    }
  }
  walk(path.join(SRC, 'components'))
  const bad = detailFiles.filter((f) => {
    const s = fs.readFileSync(f, 'utf8')
    return !/<Drawer\b/.test(s)
  })
  check('DRAWER-详情用抽屉', detailFiles.length > 0 && bad.length === 0,
    bad.length ? `这些详情视图还在用 Modal 当外壳（内容多、要滚动，抽屉才装得下）: ${bad.map((x) => x.replace(SRC, 'src')).join(', ')}`
      : `${detailFiles.length} 个详情视图都是抽屉（内层动作弹窗允许保留）`)

  // A 型页：筛选条件必须在 URL 里（刷新不丢、可分享），列表列数有上限
  const LIST = { 'features/project/Page.tsx': 8, 'features/admin/LibraryPage.tsx': 10 }   // 基线棘轮：只许降
  const bad2 = []
  for (const [rel, maxCols] of Object.entries(LIST)) {
    const f = path.join(SRC, rel)
    if (!fs.existsSync(f)) { bad2.push(`${rel} 文件不见了`); continue }
    const s = fs.readFileSync(f, 'utf8')
    if (!/useUrlState\(/.test(s)) bad2.push(`${rel} 的筛选没进 URL（刷新就丢、链接发不出去）`)
    const cols = (s.match(/title: '/g) || []).length
    if (cols > maxCols) bad2.push(`${rel} 列数 ${cols} > 上限 ${maxCols}`)
  }
  check('LIST-筛选进URL且列数受控', bad2.length === 0, bad2.join('; ') || '项目列表：筛选在 URL、列数 7（≤8 基线）')
}

const fails = summary('静态回归');
exitWith(fails);
