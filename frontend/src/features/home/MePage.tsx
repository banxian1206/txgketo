import { Button, Card, Space, Typography } from 'antd'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../../contexts/AuthContext'

/** 我的：账号信息 + 回电脑版 + 退出登录 */
export default function MeM() {
  const nav = useNavigate()
  // 重构 1.3：用户信息/登出走 AuthContext（原散读 localStorage + 自己 fetchMe 刷缓存）
  const { user: profile, logout, refreshMe } = useAuth()

  useEffect(() => {
    void refreshMe()
  }, [refreshMe])

  // ★ 重整 P3 + R4-01（客户口径 A）+ F2（2026-10-04 走查核实）：手机端不放 PC-only 入口。
  //   修前这里有「采购工作台(/purchase)」「商机/项目(/projects)」「用户与权限(/admin/users)」三张链接，
  //   全是桌面壳 —— 手机点进去长出侧栏 + 宽表横滚，回不来（原报告 F2 实测 wh1 就是这样卡住的）。
  //   注释当年写着"隐藏"但链接没删，本轮全部下线；采购/商机/审批的移动页属后续迭代（03 卷）。
  //   静态护栏：e2e:static 的 R4-01-移动不链PC台 禁止本文件/移动首页出现 to:|nav('/purchase'|'/admin/users'|…) 反例。

  return (
    <>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Typography.Text strong>{profile?.name ?? '用户'}</Typography.Text>
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {profile?.username ?? ''} {profile?.profession ?? ''} {profile?.position ?? ''}
          </Typography.Text>
        </div>
      </Card>

      <Space direction="vertical" style={{ width: '100%' }}>
        <Button block onClick={() => nav('/projects')}>
          回到电脑版
        </Button>
        <Button
          block
          danger
          onClick={() => logout()}
        >
          退出登录
        </Button>
      </Space>
    </>
  )
}
