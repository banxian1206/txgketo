// theme/tokens.ts —— 视觉 token 唯一来源（重构 1.5b · 视觉规范 §1.1）
// 业务代码禁止裸 hex（e2e static「VIS-hex」断言盯着）；styles.css 属主题层另行治理。
// 灰阶 6 档封顶：标题/正文次/辅助/禁用字/分割线/浅底 —— 旧值 #999 #888 已归并到 #8c8c8c、
// #bbb #aaa → #bfbfbf、#666 → #595959、两套红 #cf1322/#f5222d → error 统一。
export const T = {
  /** 品牌蓝（logo 橙只做品牌点缀，界面功能色一律用它 —— 视觉规范 §6.2 蓝橙分工）
   *  ★ 2026-10-04 方案 A「纸面」：由 #1f6feb（GitHub 蓝）收敛为 #1f5fd0（更深、更稳，
   *  与 A 的冷灰底 #f6f7f9 对比更干净；旧值在浅底上偏「亮蓝」，长看疲劳） */
  brand: '#1f5fd0',
  brandHover: '#134aa8',
  brandDeep: '#0f2b52',
  /** 中性 */
  bg: '#ffffff',
  bgPage: '#f5f5f5',
  bgSubtle: '#fafafa',
  bgSunken: '#f6f8fa',
  border: '#f0f0f0',
  textStrong: '#595959',
  textSecondary: '#8c8c8c',
  textDisabled: '#bfbfbf',
  /** 语义色（antd 预设对应） */
  error: '#f5222d',
  success: '#52c41a',
  warning: '#faad14',
  orange: '#fa8c16',
  goldText: '#d48806',
  purple: '#722ed1',
  cyan: '#13c2c2',
} as const

/**
 * ★ 排版刻度（视觉规范 §1.2）—— 页面里只准出现这 6 档字号。
 *   之前只有颜色是单源，字号/间距各页自由发挥（实测 5 档含 10px，低于可读下限），
 *   这就是「没有观感」的直接技术原因。e2e:static「VIS-字号在刻度内」盯着回潮。
 */
export const FS = {
  /** 极小注释（原 10/11px 一律升到这里） */
  xs: 12,
  /** 表格正文、密集列表 */
  sm: 13,
  /** 正文默认 */
  md: 14,
  /** 区块标题 */
  lg: 16,
  /** 页面标题 / 结论条项目号 */
  xl: 20,
  /** 关键数字（Statistic 用） */
  num: 24,
  /**
   * ★ 结论条的**主角**数字（方向 2 · 2026-10-05）
   * 为什么加这一档：工作台结论条一直是 5 个 24px **等大等权**的数 —— 扫一眼分不出
   * “今天最该动的那件事是几”。方向 2 的核心就是「1 主 4 次」：最该动手的那格给 32px + 主色，
   * 其余降到 20px（仍是刻度内的 xl）。**只在 `.ds-metric.is-lead` 上用**，别处不许拿它当正文。
   * 护栏 `VIS-字号在刻度内` 同步加了这一档（有意放宽，不是棘轮）。
   */
  hero: 32,
} as const

/** 间距刻度（8px 基准，视觉规范 §1.3） */
export const SP = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32 } as const

/**
 * ★ 等宽数字/编号（视觉规范 §3.1：本系统最重要的排版决定，此前落地率 0%）。
 *   图号、单据号、物料号、日期、数量全靠它对齐 —— 一线是扫读，不是逐字读。
 */
export const MONO =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'

/**
 * ★ 方案 A「纸面 Paper」的中性色板（2026-10-04 客户选定）。
 *
 * 为什么要单列：旧 token 只有语义色 + 极简灰阶（bg/border/3 档文字色），
 * 页面要「分层」只能各写各的 hex —— 这正是 docs/12 §1.2 说「8 层灰阶缺失」的那条。
 * 现在把 A 的 9 档中性色定死在这里（业务 tsx 不许再出现裸 hex，`VIS-hex` 盯着）。
 * 层级原则：**靠「描边 + 背景分层」拉开，不靠阴影堆叠**（A 的核心视觉决策）。
 */
export const PAPER = {
  /** 页面底 */
  bg: '#f6f7f9',
  /** 面板底 */
  surface: '#ffffff',
  /** 面板内浅底（表头 / 分组头 / 行 hover） */
  surface2: '#fbfcfd',
  /** 再深一档（禁用底 / 分隔块） */
  surface3: '#f2f4f7',
  /** 发丝线：1px 主分隔 */
  line: '#e7e9ee',
  /** 控件描边（比发丝线重一档） */
  line2: '#d8dce3',
  /** 正文 / 标题 */
  ink: '#14161a',
  /** 次要正文 */
  ink2: '#59616e',
  /** 辅助说明 */
  ink3: '#8b93a1',
  /** 占位 / 弱标 */
  ink4: '#b8bfc9',
  /** 主色浅底（选中态、当前阶段） */
  accentSoft: '#eef4ff',
  /** 主色浅边 */
  accentLine: '#c9dcf8',
  /** 语义浅底（状态条 / 徽标） */
  okSoft: '#e8f7f0',
  warnSoft: '#fdf3e6',
  errSoft: '#fdecec',
  /** 语义描边（浅底配套） */
  okLine: '#bfe3d1',
  warnLine: '#f0dcb8',
  errLine: '#f3c9c9',
  /**
   * 语义文字色（★ A 的对比度决策）—— antd 默认的 #faad14/#f5222d 在浅底上偏刺眼：
   * 「警告」用深一些的金棕，长看不累，且与红色仍能区分。
   */
  ok: '#0f9d63',
  warn: '#c4761a',
  err: '#d23b3b',
  /** 中性状态（未开始 / 无状态） */
  idle: '#98a1ae',
} as const

/**
 * ★ 圆角三档封顶（视觉规范 §1.3 原本允许 6/999/2 三种「混着用」）。
 * A 的规矩：**容器 12 / 控件 8 / 小元素 6 / 胶囊 999** —— 一个页面里只准出现这 4 个值。
 */
export const R = { lg: 12, md: 8, sm: 6, pill: 999 } as const

/** 阴影只此一档（A 不做多层阴影；卡片靠发丝线，不靠浮起来） */
export const SHADOW = '0 1px 2px rgba(16, 24, 40, 0.05)'
