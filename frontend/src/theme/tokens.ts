// theme/tokens.ts —— 视觉 token 唯一来源（重构 1.5b · 视觉规范 §1.1）
// 业务代码禁止裸 hex（e2e static「VIS-hex」断言盯着）；styles.css 属主题层另行治理。
// 灰阶 6 档封顶：标题/正文次/辅助/禁用字/分割线/浅底 —— 旧值 #999 #888 已归并到 #8c8c8c、
// #bbb #aaa → #bfbfbf、#666 → #595959、两套红 #cf1322/#f5222d → error 统一。
export const T = {
  /** 品牌蓝（logo 橙只做品牌点缀，界面功能色一律用它 —— 视觉规范 §6.2 蓝橙分工） */
  brand: '#1f6feb',
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
} as const

/** 间距刻度（8px 基准，视觉规范 §1.3） */
export const SP = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32 } as const

/**
 * ★ 等宽数字/编号（视觉规范 §3.1：本系统最重要的排版决定，此前落地率 0%）。
 *   图号、单据号、物料号、日期、数量全靠它对齐 —— 一线是扫读，不是逐字读。
 */
export const MONO =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
