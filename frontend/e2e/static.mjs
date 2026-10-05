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


// SHELL-台骨架四件套（docs/15 · 2026-10-05）：**九个台必须长同一个样**
//   为什么要有它：这轮返工的根因就是"9 个工作台是 9 个不同时候手写的页面" ——
//   结论指标条 0~6 个不等（5 个台完全没有）、流程条 4 种形态、体内 3 种语言。
//   所以把「台骨架」钉成结构契约：① 每个台页必须用 <WorkbenchPage>（台头→结论条→流程条→体）
//   ② 用 <WorkbenchPage> 的页**不许**再直接用旧的 <WorkbenchTabs>（两套框架并行 = 又开始漂）
//   ③ 注册表必须给每个台声明 defaultTab（默认页签是行为契约，不是实现细节）
//   ④ 声明 kind:'queue' 的页签，页面里必须真的有队列行（否则声明与实现脱节）
{
  const PAGES = {
    sales: 'features/workbench/SalesWorkbench.tsx',
    pm: 'features/workbench/PmWorkbench.tsx',
    eng: 'features/workbench/EngWorkbench.tsx',
    purchase: 'features/purchase/Page.tsx',
    warehouse: 'features/warehouse/Page.tsx',
    shop: 'features/manufacturing/Page.tsx',
    shipping: 'features/shipping/Page.tsx',
    site: 'features/site/Page.tsx',
    service: 'features/service/Page.tsx',
  }
  const boards = fs.readFileSync(path.join(SRC, 'configs/boards.ts'), 'utf8')
  const bad = []
  for (const [key, rel] of Object.entries(PAGES)) {
    const f = path.join(SRC, rel)
    if (!fs.existsSync(f)) { bad.push(`${rel} 不存在`); continue }
    const src = fs.readFileSync(f, 'utf8')
    if (!/<WorkbenchPage/.test(src)) bad.push(`${rel} 没用 <WorkbenchPage>（台骨架未统一）`)
    if (/<WorkbenchTabs/.test(src)) bad.push(`${rel} 还在用旧的 <WorkbenchTabs>（两套框架并行）`)
    if (/locale=\{\{\s*emptyText:\s*<Empty description/.test(src)) {
      bad.push(`${rel} 还有 antd 默认空态（应换成 ds <Empty text=… action=…>，说人话 + 下一步）`)
    }
    // 声明 queue 的页签 → 页面里必须有队列行
    const re = new RegExp(`key: '${key}'[\\s\\S]{0,4000}?defaultTab|defaultTab`)
    if (!re.test(boards)) bad.push(`BOARDS.${key} 没声明 defaultTab`)
    const seg = boards.split(`key: '${key}'`)[1]?.split('export const')[0] ?? ''
    // ⚠ 注意：有的台是映射式声明（`kind: (...) ? 'queue' : 'ledger'`），所以不能只匹配 `kind: 'queue'`
    //    —— 只匹配字面量会把 8 个台整个漏掉（注入反例①发现，已修）
    if (/'queue'/.test(seg) && !/<QueueBoard|<QueueRow/.test(src)) {
      bad.push(`${rel} 有 kind:'queue' 的页签，但页面里没有队列行`)
    }
  }
  // 注册表内部一致性：defaultTab 必须是自己的页签之一；每个页签必须声明 kind
  const defs = [...boards.matchAll(/export const (\w+)_BOARD: BoardDef = \{([\s\S]*?)\n\}/g)]
  for (const [, name, body] of defs) {
    const dt = body.match(/defaultTab:\s*'([^']+)'/)
    const keys = [...body.matchAll(/\{\s*key:\s*'([^']+)'/g)].map((m) => m[1])
    if (!dt) bad.push(`${name}_BOARD 没声明 defaultTab`)
    else if (keys.length && !keys.includes(dt[1]) && !/tabs: [A-Z_]+_TABS/.test(body)) {
      bad.push(`${name}_BOARD.defaultTab='${dt[1]}' 不在自己的页签里`)
    }
  }
  check('SHELL-台骨架四件套', bad.length === 0,
    bad.length ? bad.slice(0, 4).join(' | ') : '9 个台：台头→结论条→流程条→体，同一条壳；队列页签真有队列行')
}

// SHELL-台页签分组≤4（R3-B · 2026-10-04）：分组是给"先扫一遍"的人减负，
// 组数超过 4 就又变回一排横着摆的老问题；同时组的 keys 必须**恰好覆盖**该台注册表的键
// （漏一个 = 那个页签在 UI 上消失；多一个 = 拼错 key，点了空白）。
{
  const src = fs.readFileSync(path.join(SRC, 'configs/tabs.ts'), 'utf8')
  const tabDefs = [...src.matchAll(/export const (\w+)_TABS: TabDef\[\] = \[([\s\S]*?)\n\]/g)]
    .map((m) => ({ name: m[1], keys: [...m[2].matchAll(/\bkey:\s*'([^']+)'/g)].map((x) => x[1]) }))
  const groups = new Map(
    [...src.matchAll(/export const (\w+)_GROUPS: TabGroup\[\] = \[([\s\S]*?)\n\]/g)]
      .map((m) => [m[1], { keys: [...m[2].matchAll(/keys:\s*\[([^\]]*)\]/g)].map((x) => [...x[1].matchAll(/'([^']+)'/g)].map((y) => y[1])), groupsN: (m[2].match(/\bkey:\s*'/g) || []).length }])
  )
  const bad = []
  for (const t of tabDefs) {
    const g = groups.get(t.name)
    if (!g) { bad.push(`${t.name} 没有配 *_GROUPS`); continue }
    if (g.groupsN > 4) bad.push(`${t.name} 分组 ${g.groupsN} 个 > 4`)
    const flat = g.keys.flat()
    const miss = t.keys.filter((k) => !flat.includes(k))
    const extra = flat.filter((k) => !t.keys.includes(k))
    if (miss.length) bad.push(`${t.name} 分组漏了键: ${miss.join(',')}`)
    if (extra.length) bad.push(`${t.name} 分组有注册表里没有的键: ${extra.join(',')}`)
  }
  check('SHELL-台页签分组≤4', bad.length === 0 && tabDefs.length >= 10,
    bad.length ? bad.join(' | ') : `${tabDefs.length} 个台：分组 ≤4 且键集合与注册表一一对应`)
}

// CMDK-命令栏必须真能搜（R2 收尾 · 2026-10-04）：
//   「粘任意编号 → 直达」是本项目最该有的一处入口（铁律 1+2：编号即入口），
//   所以它**不许是装饰**：必须走真接口、必须有热键、落点必须带来源（否则返回口会骗人）。
{
  const bad = []
  const file = path.join(SRC, 'components/CommandPalette.tsx')
  const layoutPath = path.join(SRC, 'layouts/AppLayout.tsx')
  const layout = fs.existsSync(layoutPath) ? fs.readFileSync(layoutPath, 'utf8') : ''
  if (!fs.existsSync(file)) bad.push('没有 CommandPalette.tsx')
  else {
    const src = fs.readFileSync(file, 'utf8')
    // ★ 热键绑在 AppLayout（全局键盘监听），搜索行为在组件里 —— 两处合起来看，
    //   否则护栏会因"条件写窄了"而误报（第一版就是这样）
    const both = src + '\n' + layout
    if (!/globalSearch\(/.test(src)) bad.push('没调用 /search（globalSearch）')
    if (!/metaKey|ctrlKey/.test(both)) bad.push('没有 ⌘K / Ctrl+K 热键')
    if (!/'k'/.test(both)) bad.push('热键没绑到 k')
    if (!/useGoFrom/.test(src)) bad.push('落点没带来源（返回口会骗人）')
    if (!/ArrowDown|ArrowUp/.test(src)) bad.push('没有键盘选择（↑↓）')
    if (!/没有找到/.test(src)) bad.push('查不到时没说人话（不许静默）')
  }
  if (!/CommandPalette/.test(layout)) bad.push('AppLayout 没挂命令栏')
  if (!/app-search/.test(layout)) bad.push('顶栏没有搜索触发框')
  check('CMDK-命令栏真能搜', bad.length === 0,
    bad.length ? bad.join(' | ') : '走真接口 + ⌘K 热键 + ↑↓/Enter + 带来源 + 查不到说人话')
}

// OBJ-入口：图号/物料号出现的地方必须能点进件档案（2026-10-05 用户实测"没有入口"）
//   教训（AGENTS §8.5）："字段写进了模型和接口但忘了放前端入口 → 做完了但找不到"。
//   所以把"哪些页面必须给入口"写死成清单 —— 少一处即红。
{
  const MUST = [
    ['src/features/purchase/Page.tsx', '/items/', '采购池/采购单的物料码 → 件档案'],
    ['src/features/warehouse/Page.tsx', '/items/', '待验收/待入库/库存的物料码 → 件档案'],
    ['src/features/manufacturing/Page.tsx', '/items/', '排产单的图号 → 件档案'],
    ['src/components/project/EquipmentsCard.tsx', '/equipment/', '项目详情的设备行 → 设备档案'],
    ['src/components/project/DesignProgressCard.tsx', '/equipment/', '设计进度行 → 设备档案'],
    ['src/components/design/DrawingsCard.tsx', '/items/', '设计面图纸树的图号 → 件档案'],
    ['src/components/design/DesignHeaderCard.tsx', '/equipment/', '设计面头部 → 设备档案'],
    ['src/components/CommandPalette.tsx', '/search\|globalSearch', '命令栏能搜到对象'],
    ['src/App.tsx', '/dashboard', '驾驶舱路由'],
  ]
  const bad = MUST.filter(([rel, needle]) => {
    const f = path.join(SRC, rel.replace(/^src\//, ''))
    if (!fs.existsSync(f)) return true
    return !new RegExp(needle).test(fs.readFileSync(f, 'utf8'))
  }).map(([rel, , why]) => `${rel}（缺：${why}）`)
  // 驾驶舱必须挂在"台清单"（WORKBENCHES 是台清单唯一事实源 → 侧栏/工作台/台条自动出现）
  {
    // SRC = frontend/src → 后端在 ../../backend/app/…
    const wb = fs.readFileSync(path.resolve(SRC, '../../backend/app/api/routes/workbench.py'), 'utf8')
    check('GM-驾驶舱登记为台', /经营驾驶舱/.test(wb) && /"gm"/.test(wb),
      /经营驾驶舱/.test(wb) ? 'WORKBENCHES 里有「经营驾驶舱」（入口随角色可见）' : '台清单里没有驾驶舱 —— 用户找不到入口')
  }
  check('OBJ-对象入口齐备', bad.length === 0,
    bad.length ? bad.slice(0, 3).join(' | ') : `${MUST.length} 个必给入口的地方都在（图号/物料号/设备行可点）`)
}

// OBJ-分区来自注册表 + 进 URL（docs/14 · 2026-10-05）
//   为什么要有：页面的"分区"如果各页自由发挥，就会退回「卡片一个个往下摆」；
//   所以 ① 分区 key 必须在 configs/sections.ts 登记过、且**逐字对应**（漏一个=某块没地方放，
//   多一个=拼错 key 点了空白）；② 分区状态必须进 ?tab=（刷新/收藏/通知深链都在）。
{
  const secSrc = fs.readFileSync(path.join(SRC, 'configs/sections.ts'), 'utf8')
  const registry = new Map()
  for (const m of secSrc.matchAll(/export const (\w+_SECTIONS):[^=]*= \[([\s\S]*?)\n\]/g)) {
    registry.set(m[1], [...m[2].matchAll(/key:\s*'([^']+)'/g)].map((x) => x[1]))
  }
  const bad = []
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p2 = path.join(d, f)
      if (fs.statSync(p2).isDirectory()) { walk(p2); continue }
      if (!/\.tsx$/.test(f)) continue
      const src = fs.readFileSync(p2, 'utf8')
      if (!/<SectionNav\b/.test(src)) continue
      const rel = p2.replace(SRC, 'src')
      if (!/useTab\(/.test(src)) bad.push(`${rel} 分区状态没进 URL（缺 useTab）`)
      const imp = src.match(/import \{([^}]*)\} from '[^']*configs\/sections'/)
      const constName = imp && [...imp[1].matchAll(/(\w+_SECTIONS)/g)].map((x) => x[1])[0]
      if (!constName || !registry.has(constName)) { bad.push(`${rel} 没从注册表取分区（找不到 *_SECTIONS 导入）`); continue }
      // ★ 只取 `sections={[ ... ]}` 块里的 key —— 第一版把整文件所有 key:'x' 都算进来，
      //   于是生命周期轨道的 { key:'design' } 被误判成"注册表里没有的分区"（假红）。
      // ★ 直接用注册表常量（`sections={CREATE_SECTIONS.map(...)}`）比手抄 key 更强 —— 豁免
      const direct = new RegExp(`sections=\\{${constName}\\b`).test(src)
      if (direct) continue
      const at = src.indexOf('sections={[')
      let use = []
      if (at >= 0) {
        const from = at + 'sections={['.length
        let depth = 1, i = from
        while (i < src.length && depth > 0) {
          if (src[i] === '[') depth++
          if (src[i] === ']') depth--
          i++
        }
        const block = src.slice(from, i)
        use = [...block.matchAll(/key:\s*'([^']+)'/g)].map((x) => x[1])
      }
      const want = registry.get(constName)
      const miss = want.filter((k) => !use.includes(k))
      const extra = use.filter((k) => !want.includes(k))
      if (miss.length) bad.push(`${rel} 页面漏了注册表里的分区: ${miss.join(',')}`)
      if (extra.length) bad.push(`${rel} 页面用了注册表里没有的 key: ${extra.join(',')}`)
    }
  }
  walk(path.join(SRC, 'features'))
  check('OBJ-分区来自注册表且进URL', bad.length === 0,
    bad.length ? bad.slice(0, 3).join(' | ') : '分区 key 与 configs/sections.ts 逐字对应，且状态进 ?tab=')
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

// F3（2026-10-04 走查核实）：`validateFields().then(...)` 必须接 `.catch` ——
// 校验失败的 reject 值不是 Error，不接住就是未处理拒绝（console 报错）。
// 正确写法（try { await form.validateFields() } catch { return }）天然不命中这条。
{
  const bad = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p2 = path.join(dir, f);
      const st = fs.statSync(p2);
      if (st.isDirectory()) { walk(p2); continue; }
      if (!/\.tsx?$/.test(f)) continue;
      const src = fs.readFileSync(p2, 'utf8');
      const re = /validateFields\(\)\.then\(/g;
      let m;
      while ((m = re.exec(src))) {
        // 从匹配点往后数花括号，找到该 .then( 回调的闭合，判窗口内有没有 .catch(
        let depth = 1, j = m.index + m[0].length;
        while (j < src.length && depth > 0) {
          if (src[j] === '{') depth++;
          else if (src[j] === '}') depth--;
          j++;
        }
        const stmt = src.slice(m.index, j + 12);
        if (!stmt.includes('.catch(')) bad.push(`${p2.replace(SRC, 'src')}:${src.slice(0, m.index).split('\n').length}`);
      }
    }
  };
  walk(path.join(SRC, 'features'));
  walk(path.join(SRC, 'components'));
  check('F3-validateFields必接catch', bad.length === 0,
    bad.length ? `裸 validateFields().then 未接 catch: ${bad.slice(0, 4).join(', ')}` : 'promise 风校验全部接了 .catch');
}

// F14（2026-10-04）：destroyOnHidden 弹窗未挂载时调 resetFields → console 警告“useForm not connected”；
// destroyOnHidden + preserve={false} 的新实例本就干净，「开弹窗前 reset」一律是多余写法。
{
  const bad = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p2 = path.join(dir, f);
      const st = fs.statSync(p2);
      if (st.isDirectory()) { walk(p2); continue; }
      if (!/\.tsx$/.test(f)) continue;
      fs.readFileSync(p2, 'utf8').split('\n').forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
        if (/resetFields\(\)/.test(t) && /set[A-Z]\w*(Open|Target|For)/.test(t)) bad.push(`src/${path.relative(SRC, p2)}:${i + 1}`);
      });
    }
  };
  walk(path.join(SRC, 'features'));
  walk(path.join(SRC, 'components'));
  check('F14-不开弹窗前reset', bad.length === 0,
    bad.length ? `同一行“先 reset 再开弹窗”（destroyOnHidden 下报 useForm 未连接警告）: ${bad.slice(0, 4).join(', ')}` : '没有“开弹窗前 resetFields”的写法');
}

// R4-01（客户口径 A）+ F2（2026-10-04 走查核实）：移动端不得链到 PC-only 工作台路由。
// 修前 MePage 就挂着「采购工作台(/purchase)」「用户与权限(/admin/users)」——手机点进去长出侧栏。
// ★ 豁免：/projects 在 MePage 是「回到电脑版」逃生口（有意为之），不在禁列。
{
  const PC_ONLY = ['/my-tasks', '/reviews', '/changes', '/mine/tasks', '/mine/reviews', '/mine/changes', '/purchase', '/admin/users'];
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

// ★ F5（2026-10-04 走查核实）：图标-only 按钮（自闭合、无文字子项）必须带可访问名 ——
//   手机端没有 hover，Tooltip 永远读不到；读屏/截图反馈都靠 aria-label/title。
{
  const bad = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      if (st.isDirectory()) { walk(p); continue; }
      if (!/\.tsx$/.test(f)) continue;
      fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith('//') || t.startsWith('*')) return;
        // 只拦同一行写完整且**无文字子项**的（以 /> 自闭合结尾 = 结构上不可能有子项）
        if (t.includes('<Button') && /icon=\{<[A-Za-z]+ ?\/>/.test(t) && t.endsWith('/>') && !/aria-label|title=/.test(t)) {
          bad.push(`${p.replace(SRC, 'src')}:${i + 1} ${t.slice(0, 60)}`);
        }
      });
    }
  };
  walk(path.join(SRC, 'features'));
  walk(path.join(SRC, 'components'));
  walk(path.join(SRC, 'layouts'));
  check('F5-图标按钮有可访问名', bad.length === 0,
    bad.length ? `图标-only 按钮缺 aria-label/title: ${bad.slice(0, 3).join(' | ')}` : '图标-only 按钮全部带可访问名');
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
      // ★ 2026-10-04：R3-B 之后台页签改走 <WorkbenchTabs（组页签 + Segmented）——
      //   护栏必须一起认它，否则这些页面直接「不在扫描范围」= 护栏睡死（比没护栏更危险）。
      // ★ 2026-10-05（docs/14）：又多了 <SectionNav（页内分区条）—— 同样必须认。
      //   规矩：一屏最多 **1 条台页签 + 1 条分区条**；同类两条即红（退回 docs/12 批过的「三层标题」）。
      const src1 = fs.readFileSync(p2, 'utf8')
      const nTabs = (src1.match(/<Tabs\b|<WorkbenchTabs\b/g) || []).length
      const nSec = (src1.match(/<SectionNav\b/g) || []).length
      if (nTabs > 1) bad.push(`${p2.replace(SRC, 'src')} 有 ${nTabs} 条页签条（同类最多 1）`)
      if (nSec > 1) bad.push(`${p2.replace(SRC, 'src')} 有 ${nSec} 条分区条（同类最多 1）`)
      if (nTabs + nSec > 2) bad.push(`${p2.replace(SRC, 'src')} 横条合计 ${nTabs + nSec} 条（最多 1 页签 + 1 分区）`)
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
      // ★ 同上：台页签已改成 <WorkbenchTabs，也必须继续受注册表/权限/URL 三条约束
      if (!/<Tabs\b|<WorkbenchTabs\b/.test(src)) continue
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
  // ★ 走查 2026-10-04：目录扩到 features/project 与 components/（原来漏了 → CreatePage 的裸 nav('/projects') 没人拦），
  //   同时盯 `nav('/workbench…')` 与裸 `navigate(`；目标行出现 `go(` 即算合规。
  const DOMAINS = ['features/workbench', 'features/purchase', 'features/warehouse', 'features/task',
    'features/site', 'features/assembly', 'features/manufacturing', 'features/service',
    'features/shipping', 'features/acceptance', 'features/review', 'features/change', 'features/design',
    'features/project', 'components']
  // 例外必须写清为什么
  const EXEMPT = {
    'src/features/home/MePage.tsx': '手机端「回到电脑版」是主动切到 PC，非跨域下钻（R4-01 另有护栏）',
    'src/features/workbench/Page.tsx': '工作台内「系统管理(/admin/users)」入口是域内链接，无来源可言',
  }
  const bad = []
  for (const d of DOMAINS) {
    const abs = path.join(SRC, d)
    if (!fs.existsSync(abs)) continue
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir)) {
        const p2 = path.join(dir, f)
        if (fs.statSync(p2).isDirectory()) { walk(p2); continue }
        if (!/\.tsx$/.test(f)) continue
        const rel = p2.replace(SRC, 'src')
        if (rel in EXEMPT) continue
        fs.readFileSync(p2, 'utf8').split('\n').forEach((l, i) => {
          const code = l.trim()
          if (code.startsWith('//') || code.startsWith('*')) return // 注释不算
          if (/(?:^|[^.\w])(nav|navigate)\([`'"]\/(projects|workbench|purchase|warehouse|library|admin|delivery)/.test(l) && !/\bgo\(/.test(l)) {
            bad.push(`${rel}:${i + 1}`)
          }
        })
      }
    }
    walk(abs)
  }
  check('NAV-跨域跳转带来源', bad.length === 0,
    bad.length ? `台/业务域/组件里出现裸 nav('/…')（应改用 useGoFrom 的 go() 带 ?from=）: ${bad.slice(0, 6).join(', ')}`
      : '台/业务域/组件 → 跨域跳转全部走 go()（来源随链路透传）')
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
    // ★ 2026-10-04 修假绿：旧正则 `/>[^<>]*卷\s*§/` 要求「卷 §」与前面的 `>` **同行**，
    //   而 JSX 多行子节点（文本独占一行）根本不会命中 —— 实测两处真违规（`workbench/Page.tsx`
    //   的「（06 卷 §11）」、`purchase/Page.tsx` 的「（00 卷 §3.1②）」）在屏幕上看得见，
    //   护栏却报「零处引用」。现在改成：剥注释后**逐行直扫**（不管它是不是 JSX 文本）。
    code.split('\n').forEach((l, i) => {
      // 去掉行尾 `// 注释`（要求 // 前有空白，避免误伤 https://）
      const line = l.replace(/\s\/\/.*$/, '')
      if (/卷\s*§/.test(line)) docRef.push(`${f.replace(SRC, 'src')}:${i + 1}`)
    })
    // 等宽编号有**两代**实现：旧的 ui/Primitives {CodeNo,NumCell}、新的 ds {Code,Num}
    // ★ 2026-10-04：只认旧的那一代 → 换成 ds 之后这里会静默掉到 0，护栏就该自己换代
    const oldMono = /from '[^']*ui\/Primitives'/.test(src) && /CodeNo|NumCell/.test(src)
    const newMono = /from '[^']*components\/ds'/.test(src) && /\bCode\b|\bNum\b/.test(src)
    if (oldMono || newMono) monoCols++
  }
  // ★ 棘轮基线（2026-09-29 实测）：改完一期就下调一次，绝不许往上抬
  const BASE_INLINE = 850  // 2026-09-30：+付款变更卡（紧凑行改 .form-dense / .w-full 两个类，而非逐元素 inline）
  const BASE_DOCREF = 0
  check('VIS-inline棘轮', inline <= BASE_INLINE, `inline style ${inline} 处（基线 ${BASE_INLINE}，只许降）`)
  check('VIS-字号在刻度内', offScale.length === 0, offScale.length ? `不在 FS 刻度(12/13/14/16/20/24)里的字号: ${offScale.slice(0, 5).join(', ')}` : '全部字号来自 FS 刻度')
  check('VIS-用户文案不引内部文档', docRef.length <= BASE_DOCREF,
    docRef.length ? `JSX 文案里出现「卷 §」（内部口径该进 Tooltip/帮助，不该上屏）: ${docRef.slice(0, 5).join(', ')}` : '用户可见文案零处引用内部文档章节号')
  check('VIS-等宽编号已启用', monoCols >= 3, `使用等宽编号组件（ds.Code/Num 或 CodeNo/NumCell）的文件数 = ${monoCols}`)
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
      // ★ 同上：台页签已改成 <WorkbenchTabs，也必须继续受注册表/权限/URL 三条约束
      if (!/<Tabs\b|<WorkbenchTabs\b/.test(src)) continue
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


/** 把 `[a, b, {..}, c]` 按顶层逗号切开（忽略字符串/嵌套括号里的逗号） */
function topItems(block) {
  const out = []
  let depth = 0, cur = '', q = null
  for (const ch of block) {
    if (q) { cur += ch; if (ch === q) q = null; continue }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; cur += ch; continue }
    if ('[({'.includes(ch)) depth++
    if (']})'.includes(ch)) depth--
    if (ch === ',' && depth <= 1) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

/* ══════════ P3 列表与详情（docs/12 §2-A / §5）══════════ */
{
  // 详情视图必须用抽屉（规范 §5.1：详情 Drawer 560~720；Modal 只留给动作）
  const detailFiles = []
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p2 = path.join(d, f)
      if (fs.statSync(p2).isDirectory()) { walk(p2); continue }
      // 详情视图：*Detail(Modal).tsx 以及「对账单」这类名字不带 Detail 但实质是只读详情的组件
      if (/Detail(Modal)?\.tsx$/.test(f) || /Statement/.test(f)) detailFiles.push(p2)
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

/* ══════════ P4 移动对齐（docs/12 §2-E · 规范 §4/§5.2）══════════ */
{
  // 移动端不许再拿 emoji 当图标（跨平台渲染不一致，Windows 上尤其难看）
  const MOBILE = ['features/acceptance/MobilePage.tsx', 'features/assembly/MobilePage.tsx', 'features/home/MobilePage.tsx',
    'features/manufacturing/MobilePage.tsx', 'features/service/MobilePage.tsx', 'features/shipping/MobilePage.tsx',
    'features/site/MobilePage.tsx', 'features/warehouse/MobilePage.tsx', 'features/warehouse/IssuesPage.tsx', 'features/home/MePage.tsx']
  const EM = new RegExp('[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]', 'gu')
  const bad = []
  for (const rel of MOBILE) {
    const f = path.join(SRC, rel)
    if (!fs.existsSync(f)) { bad.push(`${rel} 文件不见了`); continue }
    f && fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      const s = l.trim()
      if (s.startsWith('//') || s.startsWith('*') || s.startsWith('/*') || s.startsWith('{/*')) return
      if (EM.test(s)) bad.push(`${rel}:${i + 1} ${s.slice(0, 28)}`)
      EM.lastIndex = 0
    })
  }
  check('MOBILE-不用emoji图标', bad.length === 0,
    bad.length ? `移动端又出现 emoji 当图标（改用 @ant-design/icons）: ${bad.slice(0, 5).join(' | ')}`
      : `${MOBILE.length} 个移动页零 emoji 图标`)
}

{
  // ★ P5：页面作用域（看哪个项目 / 哪组筛选）必须在 URL 里；动作弹窗里的表单字段不算
  const SCOPE = ['features/assembly/Page.tsx', 'features/shipping/Page.tsx', 'features/site/hooks.ts', 'features/admin/Page.tsx']
  const bad = SCOPE.filter((rel) => {
    const f = path.join(SRC, rel)
    if (!fs.existsSync(f)) return true
    const s = fs.readFileSync(f, 'utf8')
    return !/useUrlState\(/.test(s)
  })
  check('SCOPE-页面作用域进URL', bad.length === 0,
    bad.length ? `这些页面的作用域选择器/筛选还锁在组件 state（刷新即丢、不可分享）: ${bad.join(', ')}`
      : '装配/发运/现场(双端共用 hook)/后台用户筛选 的作用域都在 URL 里')
}

{
  // ★ 每张表的列数上限（docs/12 §2-A：A 型页列 ≤7）。静态解析 columns={[...]}，不依赖数据、不会休眠。
  //   退换记录原来是 11 列 —— 靠"主+副叠行"合并到 7 列，信息一条不少。
  const MAX_COLS = {
    'features/purchase/Page.tsx': 7,
    'features/warehouse/Page.tsx': 7,
    'features/project/Page.tsx': 7,
    'features/admin/LibraryPage.tsx': 6,
  }
  const bad = []
  for (const [rel, max] of Object.entries(MAX_COLS)) {
    const f = path.join(SRC, rel)
    if (!fs.existsSync(f)) { bad.push(`${rel} 不见了`); continue }
    const s = fs.readFileSync(f, 'utf8')
    // 两种写法都要盖到：内联 columns={[...]} 与 const columns: ColumnsType<T> = [...]
    // （第一版只盖了前者，注入第 8 列没变红 —— 护栏不咬人的护栏比没护栏更危险）
    const starts = []
    for (const m of s.matchAll(/columns=\{\[/g)) starts.push(m.index + m[0].length - 1)
    for (const m of s.matchAll(/ColumnsType<[^>]*>\s*=\s*\[/g)) starts.push(m.index + m[0].length - 1)
    for (const st of starts) {
      let depth = 0, k = st
      for (; k < s.length; k++) {
        if (s[k] === '[' || s[k] === '{' || s[k] === '(') depth++
        else if (s[k] === ']' || s[k] === '}' || s[k] === ')') {
          depth--
          if (depth === 0) break
        }
      }
      const block = s.slice(st, k + 1)
      const inner = (block.match(/columns=\{\[/g) || []).length + (block.match(/ColumnsType</g) || []).length
      if (inner > 0) continue // 带展开行子表的，由子表自己的 start 去数
      // 只数数组**顶层元素**里的 title —— 否则 Popconfirm/Modal 的 title 会被当成列（第一版就误报过）
      const colItems = topItems(block).filter((x) => /\btitle:/.test(x))
      if (colItems.length > max) {
        const names = colItems.map((x) => (x.match(/title:\s*'([^']*)'/) ?? [, '?'])[1]).join(' / ')
        bad.push(`${rel}:${s.slice(0, st).split('\n').length} 某表 ${colItems.length} 列 > 上限 ${max}【${names}】`)
      }
    }
  }
  check('TABLE-每表列数≤上限', bad.length === 0, bad.join('; ') || '采购/仓库/项目/标准库 的每张表列数都在上限内')
}

// 移动端消息深链：手机里点消息不能把人踹进 PC 壳（R4-01 / 走查 2026-10-04）
{
  const s = fs.readFileSync(path.join(SRC, 'components', 'NotificationsDrawer.tsx'), 'utf8')
  const need = ['/m/warehouse', '/m/shipping', '/m/service', '/m/site', '/m/production']
  const miss = need.filter((x) => !s.includes(x))
  check('MOBILE-消息深链不落PC', miss.length === 0 && /电脑端处理/.test(s),
    miss.length ? `移动映射缺: ${miss.join(', ')}` : '有移动映射 + PC-only 兜底（不会在手机里长出桌面壳）')
}

const fails = summary('静态回归');
exitWith(fails);
