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
const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backend/app');

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
    // ⚠ 两条正则都要（2026-10-05 走查补的盲区）：
    //   ① 只查 `locale={{ emptyText: <Empty description` → 漏掉**直接写** `<Empty description="…"/>` 的；
    //   ② 只查台页面本身 → 漏掉台页面**内嵌的子页面**（PM 台内嵌验收页、车间台内嵌装配页），
    //      而那些子页的空态一样会出现在台屏上（实测：PM 台「验收与质保」分区露出 antd 灰插图）。
    if (/locale=\{\{\s*emptyText:\s*<Empty description/.test(src) || /<Empty\s+description=/.test(src)) {
      bad.push(`${rel} 还有 antd 默认空态（应换成 ds <Empty text=… action=…>，说人话 + 下一步）`)
    }
    // 台页面 import 的业务子页（相对路径 import）也纳入扫描 —— 台屏上看得到的空态得一视同仁
    for (const m of src.matchAll(/from\s+'(\.\.[^']+)'\s*$/gm)) {
      const sub = path.resolve(path.dirname(f), m[1])
      for (const cand of [`${sub}.tsx`, path.join(sub, 'Page.tsx')]) {
        if (!fs.existsSync(cand) || !/features\//.test(cand)) continue
        const s2 = fs.readFileSync(cand, 'utf8')
        if (/<Empty\s+description=/.test(s2) || /locale=\{\{\s*emptyText:\s*<Empty description/.test(s2)) {
          bad.push(`${cand.replace(SRC, 'src')}（${rel} 内嵌的子页）还有 antd 默认空态`)
        }
        break
      }
    }
    // 每张 <Table 都要说自己空的时候说什么（漏写 = 空的时候露出 antd 灰插图 + 「暂无数据」）
    const tCount = (src.match(/<Table[\s>]/g) || []).length
    const eCount = (src.match(/emptyText/g) || []).length
    if (tCount > eCount) bad.push(`${rel} 有 ${tCount} 张 <Table 但只写了 ${eCount} 处 emptyText（漏写的空态会露 antd 灰插图）`)
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
  // ★ 经营驾驶舱也要守骨架前两件（它是“有台头+结论条、但没有流程条”的那一类：同屏四块）
  //   ⚠ 2026-10-05：原来这里还列着「我的工作台」—— 那个入口**已取消**（客户拍板：与部门台内容重叠
  //   且不按岗位分层），所以它不该再被当“一个台”来断言骨架（否则会一直报红，提醒人去改一个
  //   已经不存在的页面）。改为断言它**确实不再是聚合页**（`features/workbench/Page.tsx` 现在
  //   只是三个落地页的宿主）。
  for (const [rel, why] of [['features/dashboard/Page.tsx', '经营驾驶舱']]) {
    const f = path.join(SRC, rel)
    if (!fs.existsSync(f)) { bad.push(`${rel} 不存在`); continue }
    const src = fs.readFileSync(f, 'utf8')
    if (!/<PageHead/.test(src)) bad.push(`${why} 少了台头（PageHead）`)
    if (!/<Metrics/.test(src)) bad.push(`${why} 少了结论条（Metrics）—— 结论条一律 5 个数字（0 也占位）`)
    if (/locale=\{\{\s*emptyText:\s*<Empty description/.test(src)) bad.push(`${why} 还有 antd 默认空态`)
  }
  // 「我的工作台」已取消：它现在只能是三个落地页的宿主，不得再长出聚合页
  {
    const f = path.join(SRC, 'features/workbench/Page.tsx')
    const src = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
    if (/<Metrics|<QueueBoard|const todos: TodoRow/.test(src)) {
      bad.push('features/workbench/Page.tsx 又长出了「我的工作台」聚合页（客户 2026-10-05 已取消该入口）')
    }
    // 台清单里也不能再有 mine
    if (/key:\s*['"]mine['"]/.test(fs.readFileSync(path.join(SRC, 'configs/boards.ts'), 'utf8'))) {
      bad.push('configs/boards.ts 里还有 mine 台（已取消）')
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

// ★ A11Y-不禁用缩放（WCAG 1.4.4）—— 现场/仓库在户外强光下看手机，不给捏合放大是真问题。
{
  const html = fs.readFileSync(path.resolve(SRC, '../index.html'), 'utf8');
  const vp = html.match(/<meta name="viewport"[^>]*>/)?.[0] || '';
  const ok = vp.length > 0 && !/maximum-scale|user-scalable\s*=\s*["']?no/i.test(vp);
  check('A11Y-不禁用缩放', ok, ok ? 'viewport 允许缩放（无 maximum-scale / user-scalable=no）' : `viewport 禁止缩放: ${vp}`);
}

// ★ A11Y-链接跟随品牌色 —— antd 的 colorLink 派生自 `seed.colorLink || seed.colorInfo`（genColorMapToken.js），
//   只设 colorPrimary 时全站 <a> 会落到 antd 默认蓝 #1677ff：同屏两种蓝 + 对比度 4.1:1 不达 AA。
//   与「旧主色 #1f6feb 躲在 styles.css」同一类盲区 —— 躲在第三方默认值里。
{
  const main = fs.readFileSync(path.join(SRC, 'main.tsx'), 'utf8');
  const ok = /colorLink\s*:/.test(main);
  check('A11Y-链接跟随品牌色', ok, ok ? 'main.tsx 已显式声明 colorLink（不再落回 antd 默认蓝）' : 'main.tsx 缺 colorLink —— 链接会落回 antd 默认蓝 #1677ff');
}

// ★ VIS-外壳色跟随品牌（2026-10-06 a11y 体检顺手发现）——
//   index.html 的 theme-color 还是旧主色 #1f6feb。旧主色这是**第三次**躲过扫描：
//   ① styles.css（VIS-hex 只扫 tsx）② antd 默认 colorInfo（colorLink 的兜底）③ 应用外壳 index.html。
//   所以这里不再只盯某个文件，而是直接拿 tokens.ts 的 brand 当唯一事实源对账。
{
  const tk = fs.readFileSync(path.join(SRC, 'theme/tokens.ts'), 'utf8');
  const brand = tk.match(/brand:\s*'(#[0-9a-fA-F]{6})'/)?.[1];
  const html = fs.readFileSync(path.resolve(SRC, '../index.html'), 'utf8');
  const themeColor = html.match(/<meta\s+name="theme-color"\s+content="([^"]*)"/)?.[1];
  const bad = [];
  if (!brand) bad.push('tokens.ts 读不到 T.brand');
  if (!themeColor) bad.push('index.html 缺 theme-color');
  else if (brand && themeColor.toLowerCase() !== brand.toLowerCase()) bad.push(`theme-color=${themeColor} ≠ 品牌色 ${brand}`);
  if (/#1f6feb/i.test(html)) bad.push('index.html 还用着旧主色 #1f6feb');
  check('VIS-外壳色跟随品牌', bad.length === 0,
    bad.length ? bad.join(' | ') : `theme-color=${themeColor} 跟随 T.brand=${brand}`);
}

// ── 公用：JSX 开标签边界 / tsx 遍历（下面两条 A11Y 护栏共用）──
//   '>' 必须跳过 {} 与引号里的 —— 否则 `format={(p) => ...}` 里的 `=>` 会被当成标签结束。
const jsxTagEnd = (src, from) => {
  let depth = 0, q = null;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth === 0) return i;
  }
  return -1;
};
const eachTsx = (dir, fn) => {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { eachTsx(p, fn); continue; }
    if (/\.tsx$/.test(f)) fn(fs.readFileSync(p, 'utf8'), p);
  }
};

// ★ A11Y-Select有可访问名（axe 体检 2026-10-06，critical×12）——
//   页面级筛选 <Select> 内部是 role="combobox" 的 <input>，不写 aria-label 读取器只会念「组合框」。
//   带 aria-label 即可：rc-select 的 SingleSelector 用 pickAttrs(props,true) 把 aria-* 转到那个 input
//   （node_modules/rc-select/es/Selector/SingleSelector.js，已核）；Form.Item 包裹的不用写 —— antd 会给 label+htmlFor。
{
  const bad = [];
  const scan = (src, p) => {
    const lines = src.split('\n');
    const re = /<(Select|TreeSelect|SelectProject|SelectEquipment)\b/g;
    let m;
    while ((m = re.exec(src))) {
      const end = jsxTagEnd(src, m.index + m[0].length);
      if (end < 0) continue;
      const tag = src.slice(m.index, end + 1);
      if (!/placeholder=/.test(tag)) continue;   // 只顾带占位符的；其余都在 Form.Item 内
      if (/aria-label=/.test(tag)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      const up = lines.slice(Math.max(0, line - 7), line - 1).join('\n');
      if (/<Form\.Item/.test(up)) continue;      // antd label + htmlFor 已经给了名字
      bad.push(`${p.replace(SRC, 'src')}:${line}`);
    }
  };
  eachTsx(path.join(SRC, 'features'), scan);
  eachTsx(path.join(SRC, 'components'), scan);
  check('A11Y-Select有可访问名', bad.length === 0,
    bad.length ? `页面级 Select 缺 aria-label: ${bad.slice(0, 5).join(' | ')}` : '页面级筛选 Select 全部带 aria-label（Form.Item 内的由 antd label 兜底）');
}

// ★ A11Y-Progress有可访问名（axe 体检 2026-10-06，serious）——
//   antd <Progress> 渲染 role="progressbar"，无名字读取器只念「进度条 0%」。antd 会把 restProps
//   转发到那个 div（antd/es/progress/progress.js 的 omit(...) 不含 aria-*），所以传 aria-label 即生效。
{
  const bad = [];
  const scan = (src, p) => {
    const re = /<Progress\b/g;
    let m;
    while ((m = re.exec(src))) {
      const end = jsxTagEnd(src, m.index + m[0].length);
      if (end < 0) continue;
      if (/aria-label=/.test(src.slice(m.index, end + 1))) continue;
      bad.push(`${p.replace(SRC, 'src')}:${src.slice(0, m.index).split('\n').length}`);
    }
  };
  eachTsx(path.join(SRC, 'features'), scan);
  eachTsx(path.join(SRC, 'components'), scan);
  check('A11Y-Progress有可访问名', bad.length === 0,
    bad.length ? `Progress 缺 aria-label: ${bad.slice(0, 5).join(' | ')}` : '全部 Progress 带 aria-label');
}

// ★ LIFE-时间线接线与状态口径（2026-10-07 全生命周期时间线）——
//   两件容易悄悄坏掉的事：
//     ① 接线断了（组件换了但没人用 / 详情页忘了取数）→ 页面上那条线直接消失，不报错；
//     ② **状态口径漂了**：前端自己拿计划日期算「延期」，就和后端 `deadline.milestone_state`
//        各算一套（AGENTS §8.5 那条教训）。所以这里钉住：必须用接口下发的 state，
//        且前端的状态映射要覆盖后端 4 个取值（后端加一个值 → 这里报红）。
{
  const bad = []
  const comp = fs.readFileSync(path.join(SRC, 'components/project/LifecycleTimeline.tsx'), 'utf8')
  if (!/\.state\b/.test(comp)) bad.push('LifecycleTimeline 没读接口下发的 state（可能在自己算状态）')
  for (const v of ['已完成', '延期', '未开始', '进行中']) {
    if (!comp.includes(`${v}:`)) bad.push(`状态映射漏了后端取值「${v}」`)
  }
  const bar = fs.readFileSync(path.join(SRC, 'components/project/ProjectSummaryBar.tsx'), 'utf8')
  if (!/<LifecycleTimeline\b/.test(bar)) bad.push('ProjectSummaryBar 没有用 LifecycleTimeline（那条线不会出现）')
  if (!/<LifecycleTimeline data=\{lifecycle\}/.test(bar)) bad.push('ProjectSummaryBar 没把 lifecycle 传给时间线')
  const dp = fs.readFileSync(path.join(SRC, 'features/project/DetailPage.tsx'), 'utf8')
  if (!/getProjectLifecycle\(/.test(dp)) bad.push('DetailPage 没取 lifecycle 数据')
  if (!/lifecycle=\{lifecycle\}/.test(dp)) bad.push('DetailPage 没把 lifecycle 传给结论条')
  check('LIFE-时间线接线与状态口径', bad.length === 0,
    bad.length ? bad.join(' | ') : '接线正确 · 状态用后端单一口径（前端只做映射）')
}

// ★ PRICE-价格库搬家（2026-10-07 客户口径：入口从采购台搬到基础数据）——
//   三个容易悄悄坏掉的点：
//     ① 基础数据域必须有「价格库」这一项，且按 purchase:price 过滤（金额分档铁律 N23）
//     ② **导入卡不许再出现在采购台**（职责错位：查价是干活，导入是管数据）
//     ③ 采购台要留着「去价格库」的入口（下单时查价是高频动作，不该把人赶出去）
{
  const bad = []
  const dom = fs.readFileSync(path.join(SRC, 'configs/domain.tsx'), 'utf8')
  if (!/path: '\/library\/prices'/.test(dom)) bad.push('基础数据域没有「价格库」这一项')
  const priceTab = dom.match(/path: '\/library\/prices'[^\n]*/)?.[0] ?? ''
  if (!/purchase:price/.test(priceTab)) bad.push('价格库页签没按 purchase:price 过滤')

  const panel = fs.readFileSync(path.join(SRC, 'components/PriceReferencePanel.tsx'), 'utf8')
  if (/importPurchaseHistory|历史采购导入/.test(panel)) bad.push('采购台的「价格参考」里还有导入卡（该搬去基础数据）')
  if (!/library\/prices/.test(panel)) bad.push('采购台没有「去价格库」的入口')

  const page = fs.readFileSync(path.join(SRC, 'features/admin/PriceLibraryPage.tsx'), 'utf8')
  if (!/importPurchaseHistory/.test(page)) bad.push('价格库页没有导入入口')
  if (!/priceLibraryStats/.test(page)) bad.push('价格库页没有健康度（首屏那排数）')
  check('PRICE-价格库搬进基础数据', bad.length === 0,
    bad.length ? bad.join(' | ') : '入口在基础数据 · 导入已搬走 · 采购台留去路 · 比价阈值读接口')
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

// TAB2-台内只有一行可点页签条（2026-10-05 客户实测 bug）
//   现象：采购经理点「待办」组**没有任何反应**，而「待我审批」明明有 3 单。
//   根因：台内当时是**两排可点的 Segmented**（组 + 组内页签）。点组 = “跳到组内第一个”，
//        而人已经在那一组时 **URL 与内容都不变** = 死路 → 用户以为“没展示”。
//        客户要求：“待办这里应该就是我的三条待审批的采购单”——
//        即“待办”与“待我审批”本是一件事，不该让人选两遍；且“所有标签都是统一的”。
//   现在：组不再当可点胶囊、也不再画小标题，**所有队列平铺成唯一一行**（带待办数）。
//   这条护栏钉住：① 台内只有一条 `.ds-subtabs.is-flow` ② 不许再出现“组”那一排 ③ 数字只拼一次。
{
  const bad = []
  const nav = fs.readFileSync(path.join(SRC, 'components/ds/SectionNav.tsx'), 'utf8')
  if (/ds-subtabs ds-grp/.test(nav)) bad.push('SectionNav 又画了“组”那一排（点它=跳组内第一个，人在该组时点了没反应=死路）')
  const grouped = nav.match(/if \(grouped\) \{[\s\S]*?\n  \}/)
  if (grouped && /sections\.filter\(\(s\) => g\.keys\.includes/.test(grouped[0])) {
    bad.push('SectionNav 的分组分支还在按“当前组”过滤页签（应全部平铺）')
  }
  if (grouped && /badgeText\(s\.badge\)/.test(grouped[0])) {
    bad.push('SectionNav 又在拼一次待办数（label 已由 tabLabel(t, counts) 拼好，会出现“(3) (3)”）')
  }
  check('TAB2-台内只有一行可点页签条', bad.length === 0,
    bad.length ? bad.slice(0, 3).join(' | ') : '组不“可点”（无死路）· 队列平铺一行 · 数字只拼一次')
}
{
  // 例外必须写清为什么，且只允许这几条（新增一条就得在这儿交代）
  const EXEMPT = {
    'components/domain/ShopViews.tsx': '车间三视图是**子路由导航**（URL 即状态）→ 用 Segmented 不是 Tabs；docs/15 §6-⑤ 把它的位置从页面之上挪到了台头之后',
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

// NOTIF-消息类型不许裸露英文（2026-10-05 逐页走查）
//   实测：我的工作台消息区直接渲染 `n.type` → 首屏出现 service / acceptance / site 三个英文标签；
//        顶栏抽屉虽有中文表，却漏了 site（库里最高频 65 条）与 ship，`?? n.type` 兜底照样露英文。
//   两件事一起钉：① 前端中文表**覆盖**后端 NOTIF_TYPES 全集（两边对账）
//              ② 任何地方都不许直接把通知的 type 裸值渲染出来（必须过 notifTypeLabel()）
{
  const statusTs = fs.readFileSync(path.join(SRC, 'theme', 'status.ts'), 'utf8')
  const notifyPy = path.join(BACKEND, 'models', 'notify.py')
  const bad = []

  // ① 前后端词表对账
  const be = fs.existsSync(notifyPy) ? fs.readFileSync(notifyPy, 'utf8') : ''
  const beTypes = [...(be.match(/NOTIF_TYPES[^=]*=\s*\(([\s\S]*?)\)/) || [, ''])[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1])
  const feTypes = [...(statusTs.match(/NOTIF_TYPE_LABEL[^=]*=\s*\{([\s\S]*?)\n\}/) || [, ''])[1].matchAll(/([a-z_]+)\s*:/g)].map((m) => m[1])
  if (!beTypes.length) bad.push('后端 NOTIF_TYPES 没读到（models/notify.py 结构变了？）')
  if (!feTypes.length) bad.push('前端 NOTIF_TYPE_LABEL 没读到（theme/status.ts 结构变了？）')
  for (const t of beTypes) if (!feTypes.includes(t)) bad.push(`后端发的 "${t}" 没有中文名`)
  for (const t of feTypes) if (!beTypes.includes(t)) bad.push(`前端有 "${t}" 但后端不发（词表漂了）`)

  // ② 不许裸渲染通知类型
  const walk = dir => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f)
      if (fs.statSync(p).isDirectory()) { walk(p); continue }
      if (!/\.(ts|tsx)$/.test(f)) continue
      const code = fs.readFileSync(p, 'utf8')
      code.split('\n').forEach((l, i) => {
        const t = l.trim()
        if (t.startsWith('//') || t.startsWith('*')) return
        // 渲染通知的 type 裸值：<X>{n.type}</X> / {n.type} 直接出现在 JSX 里
        if (/>\{[^}]*\.(type)\}<\//.test(t) || /\{(n|msg|it|row|notif)\.type\}/.test(t)) {
          if (!/notifTypeLabel/.test(t)) bad.push(`${p.replace(SRC, 'src')}:${i + 1} 裸渲染通知类型（要过 notifTypeLabel()）`)
        }
      })
    }
  }
  walk(SRC)
  check('NOTIF-消息类型不许裸露英文', bad.length === 0,
    bad.length ? bad.slice(0, 4).join(' | ') : `前后端 ${beTypes.length} 个通知类型全部有中文名，且无裸渲染`)
}

// SHELL2-方向2「结论优先」（2026-10-05 客户选定 · docs/99-逐页走查报告 + design-lab/workbench）
//   起因：客户实测“工作台看上去不好看”。体检发现不是审美问题而是四个可测的病：
//     糙（内距 14 种/圆角 6 种）· 平（5 个数等大等权）· 闷（队列行无色、全站唯一色彩是选中态）
//     · 散（空台 465px 留白 / 台账页 1907px）。
//   方向 2 只动三件**零页高代价**的事（明确不做“队列行卡片化”——每行 +14px，5 行就 +70px，
//   而页高已经是客户骂过的点）：① 台头给结论 ② 1 主 4 次 ③ 队列行状态色条。
//   三条都要钉住，否则一周就漂回去（“平”和“闷”都是**看不到的回归”）。
{
  const bad = []

  // ② 结论条必须有主角（且最多一个）：11 个台里 10 个指认了（驾驶舱故意不指认——“看全局”不是“动手”）
  const BOARDS2 = {
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
  for (const [key, rel] of Object.entries(BOARDS2)) {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8')
    const block = (src.match(/metrics=\{\[[\s\S]*?\n\s*\]\}/) || [''])[0]
    if (!block) { bad.push(`${rel} 读不到 metrics`); continue }
    // ⚠ 计数前先剥掉注释行：注释里写「下面每处 `lead: true`」会把计数变成 2（第一版假阳性·已修）
    const codeOnly = block.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    const leads = (codeOnly.match(/\blead: true\b/g) || []).length
    if (leads === 0) bad.push(`${rel} 结论条没指认主角（5 个数等大等权 = 看不出该动哪个）`)
    if (leads > 1) bad.push(`${rel} 结论条指了 ${leads} 个主角（最多一个）`)
  }
  // 台头不再摆长流程说明（方向 2 ①）：**只看 sub，不看 help**（help 本来就是放流程的地方）。
  // ⚠ 两次踩坑后的结论：**静态量不准**。
  //   ① 搜整页“→” → 把 help 也报红（假阳性）；
  //   ② 量字面量长度 → 匹配到的是条件分支里的短句（87/106/89 全是假阳性），而真正该抓的
  //      “台头长句”往往是模板拼出来的，字面量并不长。
  //   判据换成**可判定的结构信号**：sub 里不许再出现**流程动词**（勾/拍照/装车/清点到缺损…）——
  //   那是“怎么做”（属 help）。
  //   ⚠ 第三次修正：第一版把“验收/入库/领料”也当流程动词 → 仓库台假阳性。但那些是**业务名词**
  //     （“今天有 4 项待办（收货/入库/领料）”是**现状**，合法）。所以只留真正的**动作词**。
  const FLOW_WORDS = /(逐项勾|勾「已发」|拍照后|装车拍照|清点到|按同一份清单|冻结|自动触发采购|不能私下改图)/
  for (const [key, rel] of Object.entries(BOARDS2)) {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8')
    const m = src.match(/\n\s*sub=(\{[\s\S]{0,600}?\n\s{4,}\}|"[^"]*")/)
    if (!m) continue
    // ⚠ 块里含注释行（“验收 / 入库 / 领料”写在注释里也会命中·已修）——先剥注释再看
    const bag = m[1].split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    // 只看**中文字面量**（反引号/引号里的中文片段）
    const lits = [...bag.matchAll(/[`']([^`']*[\u4e00-\u9fa5][^`']*)[`']/g)]
      .map((x) => x[1])
      .join(' ')
    if (FLOW_WORDS.test(lits)) bad.push(`${rel} 台头 sub 出现流程动词（“怎么做”属 help 气泡，不是台头该说的话）`)
  }

  // ③ 队列行语义色条：壳必须支持（否则页面传了也白传）；且至少两个台真的在用（不然就是没落地）
  const dsIdx = fs.readFileSync(path.join(SRC, 'components/ds/index.tsx'), 'utf8')
  if (!/is-\$\{tone\}/.test(dsIdx)) bad.push('QueueRow 不支持 tone（左侧状态色条）')
  if (!/\.ds-row\.is-err/.test(fs.readFileSync(path.join(SRC, 'theme/paper.css'), 'utf8'))) {
    bad.push('paper.css 没有 .ds-row 语义色条样式')
  }
  // 只认“传给 <QueueBoard> 的那一段”（split 之前的是别处的 tone，别混进来）
  const toneUsers = Object.entries(BOARDS2).filter(([, rel]) => {
    const s = fs.readFileSync(path.join(SRC, rel), 'utf8')
    const i = s.indexOf('<QueueBoard')
    return i > 0 && /tone:\s*(?:[^,\n]*\?|')/.test(s.slice(i, i + 4000))
  })
  if (toneUsers.length < 2) bad.push(`只有 ${toneUsers.length} 个台在给队列行上色（方向 2 ③ 没落地）`)

  // ② 字号：主角那档 32 必须进 FS 刻度（护栏 VIS-字号在刻度内 同步加了它）
  const tk = fs.readFileSync(path.join(SRC, 'theme/tokens.ts'), 'utf8')
  if (!/hero:\s*32/.test(tk)) bad.push('FS 刻度里没有 hero: 32（结论条主角那档）')

  check('SHELL2-方向2结论优先', bad.length === 0,
    bad.length ? bad.slice(0, 4).join(' | ') : '①台头给结论 ②1主4次 ③队列行状态色条（零页高代价）')
}

// VIS3-精调层不许出刻度（2026-10-05「很多地方都有精调的必要」）
//   起因：客户第二次实测反馈“太粗糙”。精细度体检（10 页逐元素 computed style，
//   报“哪种值 + 出自哪个选择器 + 几次”）把粗糙点定位到 4 类，且**大部分是版面层自己造的**：
//     行高 18 种（12px 同时有 18.86 和 13.2 两个行高！——最隐蔽的“毛”）
//     控件高度 4 种（徽标 22 / 按钮 24 / 「?」16 / 输入 32）
//     表格单元格 9px（78 次）、`.ds-seg` 9px、`.ds-q-group` 10px 不在刻度
//     字号 13.5px（我自己写的卡标题）、13.33px（antd 展开图标）、`<b>` 700
//   精调全部在 paper.css 一处落地（改完：行高 3 档、字距 2 档、控件 2–3 种、字号/字重全合规）。
//   这条护栏扫**版面层与 token**（逃逸值只可能出在“唯一来源”里；业务文件另有 VIS-hex / VIS-字号在刻度内）。
{
  const bad = []
  const css = fs.readFileSync(path.join(SRC, 'theme/paper.css'), 'utf8')
  // 精调层**之后**的代码才生效，所以只看精调层区块（它会覆盖前面的旧值）
  const fine = css.slice(css.indexOf('★ 精调层'))
  const code = fine.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n')

  // ① 字号：只准 FS 七档（0.5 分数是 antd 用 1/3 画展开箭头留下的）
  for (const m of code.matchAll(/font-size:\s*([\d.]+)px/g)) {
    if (!['12', '13', '14', '16', '20', '24', '32'].includes(m[1])) bad.push(`精调层 font-size ${m[1]}px 不在 FS 刻度`)
  }
  // ② 内距：只准刻度（含 10 —— 精确 > 好看，硬塞 8/12 会让表格行高跳一大截）
  //    ⚠ 正则要能吃**多值简写**（`padding: 0 9px`）——第一版只匹配单个数字，漏掉了简写里的 9px
  const SP = new Set(['0', '2', '4', '6', '8', '10', '12', '16', '20', '24', '32'])
  for (const m of code.matchAll(/padding(?:-top|-left|-right|-bottom)?:\s*([^;]+);/g)) {
    for (const v of m[1].matchAll(/([\d.]+)px/g)) {
      if (!SP.has(v[1])) bad.push(`精调层 内距 ${v[1]}px 不在 8px 刻度（${m[0].slice(0, 30)}）`)
    }
  }
  // ④ 控件高度：同类同高 —— 允许 {22,24,32}（22=控件内文字居中，24=徽标/按钮/图标钮，32=输入）
  //    ⚠ 但 `height` 也可能是**文字行高**（移动端 `.m-st`/`.m-row-t` 写 `height` 是不存在的）——
  //    实际抓到的是 18/20px 这种**行高值**。所以只对**明确是控件**的选择器查高度。
  const CTRL_SEL = /(\.m-check|\.m-chip|\.ds-ch|\.ant-btn|\.ds-help|input|select)/i
  for (const m of code.matchAll(/height:\s*(\d+)px/g)) {
    if (!CTRL_SEL.test(m[0])) continue          // 不是控件选择器 → 放过（多半是行高）
    // 控件高度允许 {22,24,32} + **30**（Select 单选：32px 容器里上下各 1px 边框，字在 30px 行内居中）
    if (!['22', '24', '30', '32'].includes(m[1])) bad.push(`精调层 控件 height ${m[1]}px 不在控件档 {22,24,30,32}（${m[0].slice(0, 40)}）`)
  }
  // 行高另有固定档：18/20/22/24/26/32 + 28/30（Segmented 胶囊、Select 单选居中）
  for (const m of code.matchAll(/line-height:\s*([\d.]+)(px|)\s*;/g)) {
    if (!['18', '20', '22', '24', '26', '28', '30', '32'].includes(m[1])) bad.push(`精调层 行高 ${m[1]}${m[2]} 不在固定档 {18,20,22,24,26,28,30,32}`)
  }
  // ⑤ 台头 actions 里不许再摆“纯计数 Chip”（它和结论条里同一个数重复出现两次）
  //    ⚠ 正则要跨行：源码是 `actions={` 换行 + `<>` + 内容（第一版只吃到 `{` 就停，act 为空）
  const files = ['features/workbench/SalesWorkbench.tsx', 'features/workbench/PmWorkbench.tsx',
    'features/purchase/Page.tsx', 'features/warehouse/Page.tsx', 'features/service/Page.tsx']
  for (const [key, rel] of Object.entries(Object.fromEntries(files.map((f) => [f.split('/').pop(), f])))) {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8')
    const i = src.indexOf('actions={')
    const act = i < 0 ? '' : src.slice(i, i + 400)
    if (/<Chip[^>]*>\s*\{?\s*[\w?.]*\s*(逾期|超期|缺货|风险|低库存)/.test(act)) {
      bad.push(`${rel} 台头 actions 又摆了一个纯计数 Chip（结论条已有同一个数且可点）`)
    }
  }
  // ⑥ **相邻文字元素不许粘连**：`</Status>{...}` 屏上读作“超期2026-09-29”（实测精调后才发现）
  //    扫**全部 tsx**（第一版只扫 5 个台页面 → 注入到 site 页的反例没被抓到·已修）
  //    例外：可点 / 带 style 的那一处（它靠 marginLeft 隔开，是有意为之）
  const walkTsx = (d, acc = []) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f)
      if (fs.statSync(p).isDirectory()) walkTsx(p, acc)
      else if (/\.tsx$/.test(f)) acc.push(p)
    }
    return acc
  }
  for (const p of walkTsx(SRC)) {
    fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
      const t = l.trim()
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('{/*')) return
      if (/<\/Status>\{/.test(t) && !/className=|style=/.test(t)) {
        bad.push(`${p.replace(SRC, 'src')}:${i + 1} 状态与后面文字粘连（加空格或包一层）`)
      }
    })
  }
  check('VIS3-精调层不许出刻度', bad.length === 0,
    bad.length ? [...new Set(bad)].slice(0, 4).join(' | ') : '字号/内距/行高/控件高度全在刻度 · 台头不摆重复计数 · 无粘连文字')
}

// VIS4-全站同一套标准（2026-10-05「都统一标准」）
//   前身：§11 的精调只对**台页面**生效（它们套 `.ds-page`），而“我的任务/评审/改版/新建商机/
//   用户与权限/标准库/编号规则/件档案”直接挂在 `ant-layout-content` 下 → **一行精调都没吃到**
//   （实测：antd 的 1.5714 把它们算成 18.8571/20.4286/25.1429 三种行高，`<code>` 还是 11.9px）。
//   这一条盯的是**“全站口径不许分叉”**，不是某页面的具体值。
{
  const bad = []
  const css = fs.readFileSync(path.join(SRC, 'theme/paper.css'), 'utf8')
  const styles = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8')

  // ① 全站兜底段必须存在且**不带** `.ant-layout-content` 前缀
  //    （Modal/Drawer/Select 下拉由 antd 挂在 body 下，绑在布局区上会整块漏掉 —— 实测过）
  const uni = css.slice(css.indexOf('★ 全站统一'))
  if (!uni) bad.push('paper.css 缺「全站统一」段')
  else {
    if (/\.ant-layout-content\s+(code|small|td|th|p,)/.test(uni)) bad.push('全站统一段的选择器还绑在 .ant-layout-content 上（Modal/Drawer 挂在 body 下，会漏）')
    for (const need of ['--ds-lh-12', '--ds-lh-13', '--ds-lh-14', '--ds-lh-16', '--ds-lh-20', '--ds-lh-32']) {
      if (!uni.includes(need)) bad.push(`全站统一段缺行高档 ${need}`)
    }
  }
  // ② 旧样式文件里不许再出现**已废弃的旧主色** #1f6feb（方案 A 已换成 #1f5fd0）
  //    —— `VIS-hex` 只扫 tsx，扫不到 css，所以曾经“同一界面两种蓝”很久没人发现
  //    ⚠ 要先剥掉注释（注释里可以**提到**旧值，那是在解释历史）。
  //       ⚠ 剥注释要连**行尾注释**一起剥（`/* … */` 写在代码行尾），第一版只剥了整行注释，
  //          于是我自己在 §11 写的那段解释文字被判成了“还在用旧主色”（假阳性·已修）。
  const stylesCode = styles
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释（含行尾的）
    .replace(/^\s*\/\/.*$/gm, '')      // 行注释
  if (/#1f6feb/i.test(stylesCode)) bad.push('styles.css 还用着已废弃的旧主色 #1f6feb（现 #1f5fd0）')

  // ③ 分页统一：pageSize 只准 10（**列表/台账页**）；
  //    弹窗与卡片内的**迷你表**允许更小（例：项目详情的联系人卡封顶 5 行 + hideOnSinglePage，
  //    是为了不让一个 26 行的客户把泳道撑到 2180px —— 有注释写明理由，属有意例外）
  const walkTsx2 = (d, acc = []) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f)
      if (fs.statSync(p).isDirectory()) walkTsx2(p, acc)
      else if (/\.tsx$/.test(f)) acc.push(p)
    }
    return acc
  }
  for (const p of walkTsx2(SRC)) {
    const code = fs.readFileSync(p, 'utf8')
    for (const m of code.matchAll(/pagination=\{\{([^}]*)\}\}/g)) {
      const ps = m[1].match(/pageSize:\s*(\d+)/)
      if (!ps || ps[1] === '10') continue
      // 迷你表例外：同一个 pagination 对象里带 hideOnSinglePage（弹窗/卡片内的局部列表）
      // + 上方 400 字内有写明理由的注释（第一版去 m[0] **前面**找 hideOnSinglePage，
      //   而它写在 pageSize **后面** → 例外没被认出来·已修）
      const isMini = /hideOnSinglePage/.test(m[1])
      const before = code.slice(Math.max(0, m.index - 400), m.index)
      const hasWhy = /封顶|不超|有意|例外|上限|不许.*平铺|撑到/.test(before)
      if (!(isMini && hasWhy)) {
        bad.push(`${p.replace(SRC, 'src')} 分页 ${ps[1]} ≠ 10（要更小必须带 hideOnSinglePage + 理由注释）`)
      }
    }
  }
  const qb = fs.readFileSync(path.join(SRC, 'components/ds/QueueBoard.tsx'), 'utf8')
  if (!/pageSize = 10/.test(qb)) bad.push('QueueBoard 默认分页不是 10（全站统一）')

  check('VIS4-全站同一套标准', bad.length === 0,
    bad.length ? [...new Set(bad)].slice(0, 4).join(' | ') : '23 个路由同一套行高/圆角/分页/色板（含 Modal 与旧 css）')
}

// SHELL3-台按岗位分层（2026-10-05 客户拍板第一、二条）
//   起因：工程部台注释写着“组员/经理/总监三视角”，实测**三种岗位看到的一模一样、都落「我的」**——
//   总监第一眼是组员那一层，还给他看「我提交的评审单」（他根本不提交）。客户原话：「我总监进来
//   之后应该到顶层了呀」。根因：`defaultTab` 写死在注册表里，壳不看 `position`。
//   两条规矩钉死：① 壳**必须**按岗位取默认落点与页签顺序（单一出口 `defaultTabFor`/`orderTabsFor`）
//   ② 页签**始终三个、不按岗位增减**（客户第二条：增减会让用户“我今天怎么少一个页签”）
{
  const bad = []
  const shell = fs.readFileSync(path.join(SRC, 'components/domain/WorkbenchPage.tsx'), 'utf8')
  if (!/defaultTabFor\(board,\s*position\)/.test(shell)) bad.push('WorkbenchPage 没用 defaultTabFor（默认落点不再按岗位）')
  if (!/orderTabsFor\(board,\s*position\)/.test(shell)) bad.push('WorkbenchPage 没用 orderTabsFor（页签顺序不再按岗位）')
  // ⚠ 匹配**代码**而不是注释（注释里为了解释历史会提到 `board.defaultTab`）
  const shellCode = shell.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('{/*')).join('\n')
  if (/\bboard\.defaultTab\b/.test(shellCode)) bad.push('WorkbenchPage 还在直接用 board.defaultTab（绕过了岗位分层）')
  if (!/readSession\(\)/.test(shell)) bad.push('WorkbenchPage 没读 session（拿不到 position 就分不了层）')

  const boardsSrc = fs.readFileSync(path.join(SRC, 'configs/boards.ts'), 'utf8')
  // 声明了分层的台：三档必须齐、且每档的 tab 必须是自己的页签
  for (const m of boardsSrc.matchAll(/byPosition:\s*\{([\s\S]*?)\n\s*\},/g)) {
    const body = m[1]
    for (const tier of ['member', 'lead', 'director']) {
      if (!new RegExp(`${tier}:\\s*\\{`).test(body)) bad.push(`byPosition 缺 ${tier} 档（三档必须齐，否则某岗位落回第一个页签）`)
    }
    // 页签 key 定义在 tabs.ts（boards.ts 只是引用 ENG_TABS 等），所以要在两个文件里找
    const tabsSrc = fs.readFileSync(path.join(SRC, 'configs/tabs.ts'), 'utf8')
    const allKeys = boardsSrc + tabsSrc
    for (const t of [...body.matchAll(/tab:\s*'([^']+)'/g)].map((x) => x[1])) {
      if (!new RegExp(`key:\\s*'${t}'`).test(allKeys)) bad.push(`byPosition 指向不存在的页签 '${t}'`)
    }
  }
  if (!/byPosition/.test(boardsSrc)) bad.push('没有任何台声明 byPosition（岗位分层形同虚设）')
  // ★ 覆盖率：客户实测 bug “采购经理看到「待我审批 3 单」却落在一张空采购池上” ——
  //   根因：只有工程部台声明了分层，其余台落 `defaultTab`（写死成台账）。
  //   所以现在**每个台都必须声明三档**（内容可以三档相同，但不能不声明 —— 不声明就会退回旧坑）。
  const BOARDS = ['SALES', 'PM', 'ENG', 'PURCHASE', 'WAREHOUSE', 'SHOP', 'SHIPPING', 'SITE', 'SERVICE']
  for (const b of BOARDS) {
    const seg2 = boardsSrc.split(`export const ${b}_BOARD`)[1]?.split('\n}')[0] ?? ''
    if (!/byPosition/.test(seg2)) bad.push(`${b}_BOARD 没声明 byPosition（会落回写死的 defaultTab，正是“经理落进空台账”的坑）`)
  }
  // ⚠ 不做“护栏读自己注释”的自检：ESM 里 `__filename` 不可用，且那种断言改个注释就假红（本轮踩过）
  // 岗位档位定义要与后端一致
  const sess = fs.readFileSync(path.join(SRC, 'contexts/session.ts'), 'utf8')
  for (const w of ['组员', '经理', '总监']) {
    if (!sess.includes(`'${w}'`)) bad.push(`session.ts 的岗位档位缺「${w}」（与后端 POSITION_* 不一致）`)
  }
  check('SHELL3-台按岗位分层', bad.length === 0,
    bad.length ? bad.slice(0, 4).join(' | ') : '九个台都声明三档：组员/经理/总监各落“轮到我处理”的那一项（页签不增减）')
}

// UIUX 首轮：连续导航与保存保留已挂载的编辑器。
{
  const detail = fs.readFileSync(path.join(SRC, 'features/project/DetailPage.tsx'), 'utf8')
  const init = fs.readFileSync(path.join(SRC, 'features/project/InitiatePage.tsx'), 'utf8')
  check('UX-下一步保留来源', /const goNext = \(to: string\) => go\(to\)/.test(detail), '项目下一步使用来源导航')
  check('UX-立项刷新保留编辑器', /if \(loading && !detail\)/.test(init) && !/if \(loading\)/.test(init), '仅首次加载替换页面')
}

{
  const eng = fs.readFileSync(path.join(SRC, 'features/workbench/EngWorkbench.tsx'), 'utf8')
  check('ROLE-个人审核不冒用部门量', /key: 'review', label: '待我审核', value: todoTickets\.length/.test(eng)
    && !/待我审 \/ 待终审/.test(eng)
    && /label: '部门待裁决改版'.*to: '\?tab=board'/.test(eng), '个人审核与实际队列同源，部门改版进入部门分区')
}

// 新建商机重排后，隐藏区校验必须与真实字段位置一致。
{
  const fields = fs.readFileSync(path.join(SRC, 'components/OpportunityCreateFields.tsx'), 'utf8')
  const mapBlock = fields.match(/OPPORTUNITY_FIELD_SECTION[^=]*=\s*({[^}]+})/)[1]
  const map = Object.fromEntries([...mapBlock.matchAll(/'([^']+)': '([^']+)'/g)].map(x => [x[1], x[2]]))
  const actual = {}
  for (const section of fields.matchAll(/<section data-section="([^"]+)"[\s\S]*?<\/section>/g)) {
    for (const field of section[0].matchAll(/name="([^"]+)"/g)) actual[field[1]] = section[1]
  }
  const bad = [...new Set([...Object.keys(map), ...Object.keys(actual)])].filter(k => map[k] !== actual[k])
  check('UX-S0错误分区跟随真实字段', bad.length === 0, bad.length ? bad.join(',') : '全部字段含联系人列表与分区映射一致')
  check('UX-S0选填折叠保留字段', /forceRender: true/.test(fields), '选填折叠始终挂载，跨区不会卸载字段')
}

const fails = summary('静态回归');
exitWith(fails);
