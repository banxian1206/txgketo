// api/client.ts —— 按域拆分后的聚合出口（重构 1.1）：
// 业务代码继续 from '<../api/client'> 导入即可；新代码建议直接按域引用。
export * from './http'
export * from './auth'
export * from './user'
export * from './project'
export * from './numbering'
export * from './workbench'
export * from './notify'
export * from './library'
export * from './initiate'
export * from './task'
export * from './change'
export * from './design'
export * from './review'
export * from './purchase'
export * from './warehouse'
export * from './file'
export * from './manufacturing'
export * from './assembly'
export * from './shipping'
export * from './site'
export * from './acceptance'
export * from './service'

// 对象档案与全局检索（docs/13 §5）—— 保持在 client 的再导出里，页面从一处 import
export * from './dossier'

// 经营驾驶舱（00 卷 §2.1）
export * from './dashboard'
