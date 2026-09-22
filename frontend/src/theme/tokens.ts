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
