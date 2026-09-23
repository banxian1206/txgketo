# 前端 UI 视觉规范（主题 · 色彩 · 排版 · 图标）

> 2026-09-22 ｜ 配套 `前端重构方案` `前端交互设计规范` 使用（本文管**视觉层**，交互行为见上一份，不重复）
> 定位：工业级内网 B 端系统 —— **信息密度优先、状态即语言、克制不装饰**。30 人规模，不做暗色模式、不换组件库、不引 CSS 框架。

---

## 0. 现状诊断（重构要消掉的视觉债）

| # | 实测数据 | 病 |
|---|---|---|
| 1 | `main.tsx` 主题仅 2 行（`colorPrimary:#1f6feb`、`borderRadius:6`） | 无字号刻度/密度/组件级 token，样式各页自由发挥 |
| 2 | **40 个状态色 Map 散落 36 个文件**；`STATUS_COLOR` 同名重复 10+ 处且**同名异义**（评审/制造/任务各一套） | 同状态跨页异色、PC/移动双份必漂移 |
| 3 | 硬编码色 **25 种**：`#cf1322`×11 与 `#f5222d`×5 两套红；`#1f6feb` 品牌蓝与 `#1677ff` 默认蓝并存；灰 `#8c8c8c/#999/#666/#888/#bbb/#aaa` 六档混用 | 无灰阶体系，对比度失控 |
| 4 | **884 处 inline style**；**10 种字号**（`fontSize:12`×223，另有 11/13/15/16/17/18/20/22/24） | 无排版刻度 |
| 5 | emoji 当图标 12 处（移动 Tab 🏠📦🚚、树节点 📦🔩🧩、🔔），antd icons 仅 3 个文件在用 | 跨平台渲染不一致（Windows 差异大）；两套图标体系混用 |
| 6 | 无 favicon（测试 P-15）、侧栏无品牌 logo 区 | 品牌边界缺失 |

**保留的已有资产**（正确，固化为 token）：登录渐变 `#1f6feb → #0f2b52`、行 hover `#eaf3ff`、锚点胶囊条、`Tag` 表达状态（217 处）的做法。

---

## 1. 主题系统（单一来源 `theme/`）

```
src/theme/
  tokens.ts      # 颜色、字号、间距、圆角、阴影 —— 唯一合法取值来源
  status.ts      # ★ 全站唯一状态色总表（§2）
  icons.tsx      # 图标映射（§4）
  antd.ts        # ConfigProvider theme 配置（token + components 两级）
```

### 1.1 色彩 token

| token | 值 | 用途 |
|---|---|---|
| `colorPrimary` | `#1f6feb` | 品牌蓝（GitHub Blue，现状保留）：主按钮、链接、选中态、锚点 active |
| `colorPrimaryDeep` | `#0f2b52` | 深空蓝：登录渐变终点、侧栏底色基准 |
| `colorBgLayout` | `#f5f6f8` | 页面底（现状 styles.css 保留） |
| `colorBgContainer` | `#fff` | 卡片/表格 |
| 灰阶（**6 档封顶**） | `#000`(标题) / `#595959`(正文次) / `#8c8c8c`(辅助) / `#bfbfbf`(禁用字) / `#f0f0f0`(分割线) / `#fafafa`(斑马纹底) | **替代现有 25 种硬编码色**；正文默认 `rgba(0,0,0,.88)` 交给 antd |
| hover/active 底 | `#eaf3ff` / `#f0f7ff` | 行 hover、锚点 hover（现状沿用） |

**禁用色**：`#cf1322`、`#f5222d`、`#1677ff`、`#faad14` 等直接 hex **禁止再出现在业务代码**——一律走 §2 语义色或灰阶 token（antd 预设色字符串 `success/processing/error/gold/…` 也只准出现在 status.ts）。

### 1.2 排版刻度（替代 10 种字号）

| token | 值 | 用途 | 现状对应 |
|---|---|---|---|
| `fontSizeSM` | **12** | 表格辅助文字、Tag 说明、卡片 hint | 223 处 12 号 = 用对了，保留为最小号 |
| `fontSizeBase` | **13** | 次要正文、表单 label 补充 | 现状 13/14 混用 → 统一 13 |
| `fontSize` | **14** | 正文、表格主体、按钮 | antd 默认 |
| `fontSizeLG` | **16** | 卡片标题（Card title） | 现状 15/16/17 混 → 只留 16 |
| `fontSizeXL` | **20** | 页面标题（页级 h1） | 现状 17/18/20/22/24 混 → 只留 20 |
| **数字/编号** | `fontFamilyMono` | **图号、单据号、金额、数量、日期列** | 现状完全没做（见 §3） |

> 落地后 `fontSize:*` 出现的取值只能是 `{12,13,14,16,20,mono}`，验收脚本 grep 断言。

### 1.3 间距与圆角（8px 刻度）

- 允许值：`4 / 8 / 12 / 16 / 24 / 32`（现状 `marginBottom: 14`、`gap: 6` 这类杂值收敛）
- 圆角：容器 `6`（现状）、胶囊/头像 `999`、图钉类 `2`；`borderRadius: 6` 全局 token 已有 ✅
- 卡片间距统一 `16`（Card 之间 `marginBottom:16`），区块标题与内容 `12`

### 1.4 组件级 token（`components` 配置，只调必要的）

```ts
theme: {
  token: { colorPrimary:'#1f6feb', borderRadius:6, fontFamily: 系统中文字体栈(现状) },
  components: {
    Table:   { headerBg:'#fafafa', headerColor:'rgba(0,0,0,.88)', rowHoverBg:'#eaf3ff', cellPaddingBlock:8 },
    Card:    { headerFontSizeLG:16 },
    Modal:   { paddingContentHorizontal:24 },
    Button:  { primaryShadow:'none' },        // 去掉默认发光描边，更工业
    Statistic:{ contentFontSize:24 },          // 数字卡
  }
}
```

---

## 2. 状态色总表（本次 UI 设计的核心，`theme/status.ts`）

**规则**：
1. 全站**唯一**一张表；40 个散落 map 全部删除，36 个文件改为 `import { statusColor } from '@/theme/status'`
2. 同名异义的 `STATUS_COLOR` 必须带域前缀导出（`REVIEW_STATUS`、`PROD_STATUS`…），避免再撞名
3. 颜色**只表达状态**，不作装饰；一个状态词全站一个色（PC/移动同源）
4. 取值只用 antd 预设语义（`default/processing/success/error/warning`）+ 少量受控 `blue/cyan/purple/gold/orange`，集中本表

```ts
// theme/status.ts（按语义分四组 —— 全量，以实测状态词为准）
export const FLOW = {                    // 流程/审批态
  草稿:'default', 待开始:'default', 未提交:'default',
  审核中:'processing', 待经理审:'processing', 待总监审:'processing', 进行中:'processing',
  已通过:'success', 已发布:'success', 已冻结:'success', 已完成:'success',
  已退回:'error', 已关闭:'default', 已撤回:'default', 已归档:'default',
} as const

export const QUALITY = {                 // 质量态（验收/制造/调试通用）
  合格:'success', 齐:'success', 已入库:'success',
  不合格:'error', 缺件:'error', 破损:'error',
  返工:'warning', 有问题:'warning',
} as const

export const TIME = {                    // 交期/库龄态
  在途:'processing', 发货中:'processing', 装配中:'processing', 外协中:'processing',
  待入库:'gold', 待验收:'gold', 待备料:'gold', 回厂待检:'gold', 已到货:'blue',
  超期:'error', 临期:'warning',          // 超期红、临期橙 —— 数字卡同色呼应
} as const

export const STAGE = {                   // 项目阶段（全站唯一：列表/工作台/详情同源）
  线索:'blue', 成交待立项:'cyan', 执行中:'processing', 交付中:'purple',
  质保:'gold', 已关闭:'default',
} as const

// 合并导出 + 域前缀别名（迁移期使用，最终业务代码按域引）
export const REVIEW_STATUS = { ...FLOW }
export const PROD_STATUS   = { 草稿:'default', 已派工:'processing', 制造中:'processing',
                               完工待验收:'gold', 已转运:'success', 返工:'error' } as const
export const SHIP_STATUS   = { 已指令:'default', 发货中:'processing', 已装车:'cyan',
                               在途:'processing', 已到货:'blue', 已签收:'success' } as const
export const statusColor = (...keys) => 首个命中的值 ?? 'default'
```

> 注：表中状态词以 E2E 实测 + `models/` 状态枚举核对为准，迁移时**不允许新造状态词**（后端没这个词，前端不许有）。
> 同状态在不同表重复出现（如 `在途`）→ 允许，但**值必须一致**（本表内定义一次、多处引用）。

---

## 3. 排版与关键实体

### 3.1 图号/单据号必须等宽（本系统最重要的排版决定）

```
TX26001-01A-01-01-00-00     PO26005   GR26005   ¥1,680,000.00
└──────── 等宽字体，13px，letter-spacing: 0 ────────┘
```
- **落地**：`theme/tokens.ts` 导出 `mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }`；`<Code>` 组件（图号、编号、金额、数量列统一包裹）
- **理由**：图号=物料号是核心实体（AGENTS 铁律 2），表格里逐位对齐才可扫读；现状 0 处等宽
- 金额右对齐 + 千分位；数量列右对齐

### 3.2 层级（替代 884 处 inline style 的依据）

| 层 | 视觉 |
|---|---|
| 页标题 | 20/600，页面顶部（或 Modal 外的 Card title） |
| 卡片标题 | 16/600（Card default）+ 右上 `extra` 放动作 |
| 区块小标题 | 14/600（Card 内 Typography.Title level=5） |
| 正文/表格 | 14 |
| 辅助/hint | 12 + `#8c8c8c`；**关键提示**用 `Typography.Text type="secondary"` 而非裸 span |

- inline style 收敛原则：**布局（flex/grid/宽高）允许 inline；颜色/字号/圆角禁止 inline**（一律 token/类）——验收 grep 断言 `style` 内不出现 `#` 与 `fontSize`

### 3.3 状态的三种视觉形态（217 个 Tag 的用法约束）

| 形态 | 用在哪 | 例 |
|---|---|---|
| **Tag** | 状态词本身 | `已发布`(绿) `草稿`(灰) `超期`(红) |
| **数字 + 语义色** | 待办计数卡 | `待验收 2`（2 用 `colorPrimary`；**超期计数用红**） |
| **带色文字/左边条** | 行内强调（超期、缺料） | 行首 3px 色条：绿=正常 橙=临期 红=超期 |

**禁**：同屏一个状态出现两种颜色；用 Tag 当按钮；用彩色 Tag 做纯装饰。

---

## 4. 图标体系（emoji → antd icons）

- 唯一图标源：`@ant-design/icons`（**已在依赖，零新增**）
- `theme/icons.tsx` 集中映射，业务代码只引名字：

| 现 emoji | 位置 | 换成 |
|---|---|---|
| 🏠 📦 🧰 🏭 🔧 🚚 🏗️ 🛠️ 👤 | 移动底部 Tab ×9 | `HomeOutlined/InboxOutlined/ToolOutlined/CarOutlined/BuildOutlined/SettingOutlined/UserOutlined…` |
| 🔔 | 顶栏铃铛（已有 Badge ✅ 只换 icon） | `BellOutlined`（PC 已是，移动对齐） |
| 📦 🔩 🧩 | 设计图纸树（组件/零件/总装） | `AppstoreOutlined / PartlyCloudyOutlined(自定色) / FolderOpenOutlined`，或保留 1 个层级小方块图形 |
| 💡 🌟 | 页内提示文案 | `InfoCircleOutlined` / 去掉 |

**规则**：新代码出现 emoji 图标 = review 打回（emoji 只允许出现在聊天类文案，不进 UI chrome）。

---

## 5. 布局与密度

### 5.1 PC 骨架（现状良好，固化）

```
Sider 220px（深色 #001529 基准，品牌蓝仅用于选中态)  ×  Header 56px(面包屑/用户/铃铛)  ×  Content(灰底, 内边距 16, max-width 视页面)
```
- 数字待办卡：4 列（`Statistic`），卡片高一致，**计数字号 24**
- 表格：`size="small"` 已是主流 ✅；列多时用 `scroll.x` 而非缩小字号
- 详情用 Drawer 560~720px；表单 Modal 宽 560/720/900 三档（现状已在用，定死）

### 5.2 移动（灰底 + 白卡）

- 卡片圆角 6、外边距 12、卡间距 12；**触控目标 ≥44px**（按钮 `size="large"` 或自定 min-height）
- 首页数字卡：**2 列**（现状 ✅），数字 24/600，计数 0 时灰、>0 品牌蓝、**超期类>0 红**
- 动作页主按钮吸底（全宽、高 48），次按钮文字链
- 列表项左侧 4px 语义色条表达状态（替代 PC 的 Tag 密度）

### 5.3 明确不做（克制清单）

暗色模式 · 主题切换 · 自定义字体包（系统字体栈即可） · 动效库（仅 antd 自带过渡） · CSS 框架（Tailwind 等） · 图表库（本期无图表需求，驾驶舱三期再说） · 地图/大数据屏

---

## 6. 品牌与资产（依据公司 logo 实测，2026-09-22 补充）

### 6.1 品牌资产现状（程序化分析三张源文件）

| 文件 | 内容 bbox | 形态 | 色彩构成 | 定位 |
|---|---|---|---|---|
| **logo1.png**（最常用） | 432×65，仅占画布 5% | **横版字标**（扁长条） | 近黑 `#202020` 86% + 橙 `#e08000` 8% | **主标**：侧栏/登录页/页眉页脚 |
| logo2.png | 368×139，橙 16% | 图形+文字组合标 | 同上 | **小尺寸标**：favicon/PWA/apple-touch 源 |
| logo3.png | 323×97，橙 19% | 图文组合变体 | 同上 | 备选，暂不主动用 |

> 三张均为 500×500 透明画布、内容居中 —— **直接使用会被大片透明留白拖累**，须先裁切（见 6.3）。
> ⚠️ 源文件近黑字 → 深色底不可用，必须派生反白版。

### 6.2 蓝橙分工（品牌色 vs 界面功能色，本规范最重要的品牌决定）

```
品牌橙  #e08000（取自 logo，登记为 colorBrand）
  只出现在品牌位置：logo 本体 · 登录页点缀 · favicon 底 · 选中态强调点

界面蓝  #1f6feb（colorPrimary，维持现状）
  所有功能：主按钮 · 链接 · 选中 · 焦点 · 待办数字
```

**主色不改橙的三条理由**（若未来有人提议"主色跟 logo 走"，用这三条挡回去）：
1. antd `warning`/超期/临期语义色就是橙系 —— 主色若为橙，警示色全站失去区分度，§2 状态色体系崩塌
2. 橙底白字主按钮对比度弱、带"警示"暗示，不适合高频工业操作
3. 工业 B 端惯例：界面蓝灰 + logo 暖色 —— **logo 的橙负责被记住，界面的蓝负责好用**

### 6.3 使用位置表

| 位置 | 用哪张 | 规格 |
|---|---|---|
| PC 侧栏顶部品牌区（深色） | logo1 **反白版** | 高 28px + 保留副名“项目管理系统”；**字标自带“同兴高科”文字 → 图片替代主名，不叠文字**（2.5 实装 ✅，BRAND 断言 naturalWidth 验真） |
| 登录卡（白底） | logo1 **正色版** | 高 36px 替代原标题文字，英文副标保留（2.5 实装 ✅） |
| favicon / PWA / apple-touch | logo2 派生 | 16/32/48 ico + 192/512 png + maskable + 180 touch（P-15 已修） |
| 移动顶栏（蓝底） | logo1 **反白版** + “移动端”小字 | 高 22px，端型标识保留（2.5 实装 ✅） |
| 页面/打印单据页眉 | logo1 正色版（白底） | 高 24px，左上 |
| 登录页布局（2026-09-23 间距校准） | 双栏（左深空品牌 × 右纯白表单） | **两侧页脚绝对定底 40px 同线（高差=0）**；间距全 8 系（rule 24/16 · sub mb24 · remember -4/24，去负 hack 大值）；slogan 字距 1px；动线链条 5+5 两行；右 pane 纯白不飘；≤560px 高时页脚回流防重叠；≤880px 单栏 |
| 侧栏深色底(#001529) | **禁用正色版**（黑字不可见） | 只用反白版 |

### 6.4 品牌资产（已就位 2026-09-22 ✅）

> 来源：三张 logo 源文件与 `txeto` 项目 **MD5 完全一致**（同一套公司 logo），直接复用其派生素材；txeto 没有 apple-touch/PWA，由本项目从源素材派生补齐。

```
frontend/public/brand/
  favicon.ico          ← 派生 16/32/48（PIL），彻底断掉 /favicon.ico 404（修 P-15）
  favicon.png          ← txeto 复用，96×96 橙图形标（logo2 图形部分）
  apple-touch-icon.png ← 派生 180×180，白底 + logo 正色版宽140 居中
  icon-192.png         ← 派生，白底 + logo2 图文内容 66% 宽居中（maskable 安全区）
  icon-512.png         ← 同上
  logo.png             ← txeto 复用，451×83 正色横版字标（logo1 裁切版 bbox+8px）
  logo-white.png       ← txeto 复用，反白版（白字 + 橙形保留），深色底专用
  src/                 ← 源三张（logo1/2/3.png）原样留档
```

**接线（已完成）**：`index.html` icon/apple-touch link + `manifest.webmanifest` icons 字段；7 个资源 dev server 实测 200、`tsc + build` 全绿。

- 状态：favicon/manifest/反白版 **全部生效**；侧栏/登录页换 logo 属 UI 改动，排到重构阶段一（§7 步骤 6）一并做
- 反白版已是官方质量（txeto 产出），无需再找设计要

### 6.4.1 素材统一存放约定（四类归属，新素材先找对自己的类）

| 类别 | 唯一存放点 | 说明 |
|---|---|---|
| **品牌素材**（logo/favicon/PWA/反白） | `frontend/public/brand/`（源文件 `brand/src/`） | **根目录、src/、docs/ 不得放 logo**；改品牌只改这一处 |
| PWA 清单 | `frontend/public/manifest.webmanifest` | 位置是规范惯例，icons 指向 `brand/`，不迁 |
| 文档附件 | `docs/raw/` | 如编号规则 PDF，与 UI 素材无关 |
| 运行时业务上传 | `data/uploads/` | 照片/图纸/程序，归后端管，**不算素材，不迁不删** |

> 已执行：根目录三张 logo（与 `brand/src/` MD5 逐对一致的冗余副本、全仓库零引用）已删除。
> ⚠️ **git 待办**：`brand/` 目前未跟踪，需 `git add frontend/public/brand docs/` 一并提交——否则他人 clone 后 favicon/PWA 又会 404。

### 6.5 保留的现状品牌元素

1. 登录渐变 `135deg #1f6feb → #0f2b52` + 卡片阴影（✅ 固化为 token）
2. 顶栏：PC 浅底深字 / 移动蓝底白字 —— 两套保持（移动蓝底是 03 卷"移动优先"识别符）
3. 侧栏文字层级（`同兴高科` 主名 + `项目管理系统` 副名）保留，仅在上方加 logo 位

---

## 7. 迁移步骤（并入重构阶段一执行，机械替换可脚本化）

| 步 | 动作 | 验收（grep 断言） |
|---|---|---|
| 1 | 建 `theme/{tokens,status,icons,antd}.ts`，`main.tsx` 换 `theme/antd.ts` | 只有一个 ConfigProvider |
| 2 | **状态色总表落地**：以 `models/` 枚举核对状态词 → 36 文件删 40 个 map 改 import | `grep -r "_COLOR: Record" src` = 0；同名异义消失 |
| 3 | 灰阶/品牌 hex 收敛：业务代码禁 hex | `grep -rE "#[0-9a-f]{6}" pages components \| wc -l` → 0 |
| 4 | 字号收敛到 5 档 + `<Code>` 等宽包裹图号列 | `grep -rho "fontSize: [0-9]*" \| sort -u` ⊆ {12,13,14,16,20} |
| 5 | emoji → icons（`icons.tsx` 映射一次替换） | emoji grep = 0（UI chrome 内） |
| 6 | favicon + 品牌区 | 无 404、侧栏品牌区可见 |
| 7 | 全量 E2E 双视口跑一遍 + 逐页截图对比 | tsc/build/e2e 全绿；**除颜色统一外视觉无结构变化** |

> 步骤 2~5 是纯机械替换，建议单独 commit 系列（`style(theme): 状态色收敛` 等），出问题单步回滚。

---

## 8. 验收数字（重构完成时必须达到）

| 指标 | 现状 | 目标 |
|---|---|---|
| 状态色 Map | 40 个 / 36 文件 | **1 个**（`theme/status.ts`） |
| 业务代码硬编码 hex | 25 种 / 80+ 处 | **0** |
| 字号取值 | 10 种 | **5 档 + mono** |
| inline style 含颜色/字号 | 884 处中大量 | **0**（布局类保留） |
| emoji 图标 | 12 处 | **0** |
| `STATUS_COLOR` 同名异义 | 10+ 处 | 0（域前缀） |
| console antd 警告 | 16 页全中 | 0（配合交互规范 P-16） |
