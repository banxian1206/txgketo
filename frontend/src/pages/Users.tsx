import {
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tree,
  TreeSelect,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  IMPERSONATE_KEY,
  IMPERSONATE_NAME_KEY,
  POSITIONS,
  PROFESSIONS,
  createOrg,
  createUser,
  errMsg,
  generateDemoUsers,
  getMyScope,
  listOrgs,
  listRoles,
  listUsers,
  handoverUser,
  listAuditLogs,
  setDemoUsersActive,
  updateOrg,
  updateUser,
  type DemoUserRow,
  type AuditLog,
  type MyScope,
  type OrgRow,
  type RoleRow,
  type UserRow,
} from '../api/client'

/** 角色 → 可见工作台（06 卷 §5） */
const ROLE_WORKBENCH: Record<string, string> = {
  ADMIN: '全部 + 用户与权限',
  GM: '经营驾驶舱（全部）',
  SALES: '商务部工作台',
  SCHEME: '商务部工作台',
  PM: '项目经理台 / 总经办',
  DESIGN: '工程部工作台',
  DESIGN_AUDIT: '工程部工作台',
  CRAFT: '工程部工作台',
  PURCHASE: '采购工作台',
  PURCHASE_LEAD: '采购工作台',
  WAREHOUSE: '仓库工作台',
  MFG: '车间工作台（S5）',
  ASSY: '车间工作台（S5）',
  QC: '车间工作台（S5）',
  DELIVERY: '交付工作台（后续）',
  SITE: '现场工作台（后续）',
  SERVICE: '售后工作台（后续）',
  FIN: '经营驾驶舱（后续）',
}

const ROLE_MONEY: Record<string, string> = {
  PURCHASE: '采购价格',
  PURCHASE_LEAD: '采购价格',
  SALES: '立项金额',
  PM: '立项金额',
  FIN: '采购价格 + 立项金额',
  GM: '采购价格 + 立项金额',
  ADMIN: '全部',
}

interface OrgNode {
  key: number
  title: string
  children: OrgNode[]
  org: OrgRow
}

function buildOrgTree(rows: OrgRow[]): OrgNode[] {
  const map = new Map<number, OrgNode>()
  rows.forEach((r) =>
    map.set(r.id, {
      key: r.id,
      title: `${r.name}${r.user_count ? `（${r.user_count}人）` : ''}`,
      children: [],
      org: r,
    }),
  )
  const roots: OrgNode[] = []
  rows.forEach((r) => {
    const node = map.get(r.id)
    if (!node) return
    if (r.parent_id && map.has(r.parent_id)) map.get(r.parent_id)!.children.push(node)
    else roots.push(node)
  })
  return roots
}

function subtreeIds(rows: OrgRow[], rootId: number): Set<number> {
  const out = new Set<number>([rootId])
  let grew = true
  while (grew) {
    grew = false
    rows.forEach((r) => {
      if (r.parent_id && out.has(r.parent_id) && !out.has(r.id)) {
        out.add(r.id)
        grew = true
      }
    })
  }
  return out
}

/** 用户与权限（06 卷）：组织维护 + 用户管理（管理员 / 总监管本部门）+ 角色说明 */
export default function Users() {
  const { message } = App.useApp()
  const [scope, setScope] = useState<MyScope | null>(null)
  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('users')

  // 用户筛选
  const [fOrg, setFOrg] = useState<number | undefined>()
  const [fRole, setFRole] = useState<string | undefined>()
  const [fActive, setFActive] = useState<boolean | undefined>()
  const [fQ, setFQ] = useState('')

  // 用户编辑
  const [editUser, setEditUser] = useState<UserRow | null>(null)
  const [userOpen, setUserOpen] = useState(false)
  const [userForm] = Form.useForm()
  const [saving, setSaving] = useState(false)

  // 组织编辑
  const [selectedOrg, setSelectedOrg] = useState<number | undefined>()
  const [orgOpen, setOrgOpen] = useState(false)
  const [orgEditing, setOrgEditing] = useState<OrgRow | null>(null)
  const [orgForm] = Form.useForm()
  // 演示账号
  const [demoOpen, setDemoOpen] = useState(false)
  const [demoUsers, setDemoUsers] = useState<DemoUserRow[]>([])
  const [demoPassword, setDemoPassword] = useState('')
  // 操作日志
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  // 转交
  const [handoverTarget, setHandoverTarget] = useState<UserRow | null>(null)
  const [handoverTo, setHandoverTo] = useState<number | undefined>()
  const [handoverDeactivate, setHandoverDeactivate] = useState(true)
  const [handoverSaving, setHandoverSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, o, r] = await Promise.all([getMyScope(), listOrgs(), listRoles()])
      setScope(s)
      setOrgs(o)
      setRoles(r)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [message])

  const loadUsers = useCallback(async () => {
    try {
      setUsers(
        await listUsers({
          org_id: fOrg,
          role_code: fRole,
          is_active: fActive,
          q: fQ || undefined,
        }),
      )
    } catch (e) {
      message.error(errMsg(e))
    }
  }, [fOrg, fRole, fActive, fQ, message])

  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    void loadUsers()
  }, [loadUsers])
  useEffect(() => {
    if (tab !== 'logs') return
    setLogsLoading(true)
    listAuditLogs({})
      .then(setLogs)
      .catch((e) => message.error(errMsg(e)))
      .finally(() => setLogsLoading(false))
  }, [tab, message])

  // 总监只看自己部门这棵树
  const visibleOrgs = useMemo(() => {
    if (!scope || scope.is_admin || !scope.department) return orgs
    const ids = subtreeIds(orgs, scope.department.id)
    return orgs.filter((o) => ids.has(o.id))
  }, [orgs, scope])

  const treeData = useMemo(() => buildOrgTree(visibleOrgs), [visibleOrgs])
  const orgOptions = useMemo(
    () =>
      visibleOrgs.map((o) => ({
        value: o.id,
        title: `${o.name}（${o.code}）`,
        label: `${o.name}（${o.code}）`,
      })),
    [visibleOrgs],
  )

  const assignableRoles = useMemo(
    () =>
      roles.filter(
        (r) => !scope || scope.assignable_role_codes === null || scope.assignable_role_codes.includes(r.code),
      ),
    [roles, scope],
  )
  const assignablePositions = useMemo(
    () => (scope?.is_admin ? POSITIONS : POSITIONS.filter((p) => p !== '总监')),
    [scope],
  )

  // 总监：用户列表里只展示本部门的人（后端也会拦越权操作）
  const shownUsers = useMemo(() => {
    if (!scope || scope.is_admin || !scope.department) return users
    const ids = subtreeIds(orgs, scope.department.id)
    return users.filter((u) => u.org_id != null && ids.has(u.org_id))
  }, [users, orgs, scope])

  const openCreateUser = () => {
    setEditUser(null)
    userForm.resetFields()
    userForm.setFieldsValue({
      org_id: scope?.department?.id,
      position: '组员',
      role_codes: [],
    })
    setUserOpen(true)
  }

  const openEditUser = (row: UserRow) => {
    setEditUser(row)
    userForm.setFieldsValue({
      username: row.username,
      name: row.name,
      phone: row.phone,
      org_id: row.org_id,
      position: row.position,
      title: row.title,
      profession: row.profession,
      role_codes: row.roles ?? [],
      is_active: row.is_active,
      password: undefined,
    })
    setUserOpen(true)
  }

  const saveUser = async () => {
    const v = await userForm.validateFields()
    setSaving(true)
    try {
      if (editUser) {
        await updateUser(editUser.id, {
          name: v.name,
          phone: v.phone ?? null,
          org_id: v.org_id ?? null,
          position: v.position ?? null,
          title: v.title ?? null,
          profession: v.profession ?? null,
          role_codes: v.role_codes ?? [],
          is_active: v.is_active,
          ...(v.password ? { password: v.password } : {}),
        })
        message.success('用户已更新')
      } else {
        await createUser({
          username: v.username,
          password: v.password,
          name: v.name,
          phone: v.phone ?? null,
          org_id: v.org_id ?? null,
          position: v.position ?? null,
          title: v.title ?? null,
          profession: v.profession ?? null,
          role_codes: v.role_codes ?? [],
        })
        message.success('用户已创建')
      }
      setUserOpen(false)
      await Promise.all([load(), loadUsers()])
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const openCreateOrg = (admin: boolean) => {
    setOrgEditing(null)
    orgForm.resetFields()
    orgForm.setFieldsValue({ parent_id: admin ? undefined : (scope?.department?.id ?? undefined) })
    setOrgOpen(true)
  }

  const openEditOrg = () => {
    const org = visibleOrgs.find((o) => o.id === selectedOrg)
    if (!org) {
      message.warning('先在左边选一个部门/组')
      return
    }
    setOrgEditing(org)
    orgForm.setFieldsValue({ name: org.name, parent_id: org.parent_id, kind: org.kind })
    setOrgOpen(true)
  }

  const saveOrg = async () => {
    const v = await orgForm.validateFields()
    setSaving(true)
    try {
      if (orgEditing) {
        await updateOrg(orgEditing.id, { name: v.name, parent_id: v.parent_id ?? null, kind: v.kind ?? null })
        message.success('组织已更新')
      } else {
        await createOrg({ name: v.name, parent_id: v.parent_id ?? null, kind: v.kind ?? null })
        message.success('组织已新增')
      }
      setOrgOpen(false)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const toggleOrg = async (org: OrgRow) => {
    try {
      await updateOrg(org.id, { is_active: !org.is_active })
      message.success(org.is_active ? '已停用（保留历史）' : '已启用')
      await Promise.all([load(), loadUsers()])
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const orgName = (id?: number | null) => orgs.find((o) => o.id === id)?.name ?? '—'

  const doGenerateDemo = async () => {
    try {
      const r = await generateDemoUsers()
      setDemoUsers(r.users)
      setDemoPassword(r.password)
      setDemoOpen(true)
      message.success(`演示账号已就绪（${r.users.length} 个，密码 ${r.password}）`)
      await Promise.all([load(), loadUsers()])
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const doDisableDemo = async () => {
    try {
      const r = await setDemoUsersActive('disable')
      message.success(`已停用 ${r.count} 个演示账号`)
      await Promise.all([load(), loadUsers()])
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const impersonate = (r: UserRow) => {
    localStorage.setItem(IMPERSONATE_KEY, String(r.id))
    localStorage.setItem(IMPERSONATE_NAME_KEY, r.name)
    window.location.href = '/workbench'
  }

  const doHandover = async () => {
    if (!handoverTarget || !handoverTo) return
    setHandoverSaving(true)
    try {
      const r = await handoverUser(handoverTarget.id, {
        to_user_id: handoverTo,
        deactivate: handoverDeactivate,
      })
      const moved = Object.entries(r.moved)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k} ${v}`)
        .join('；')
      message.success(`已转交${r.deactivated ? '并停用' : ''}：${moved || '没有待转交内容'}`)
      setHandoverTarget(null)
      await Promise.all([load(), loadUsers()])
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setHandoverSaving(false)
    }
  }

  const columns: ColumnsType<UserRow> = [
    { title: '账号', dataIndex: 'username', width: 110 },
    {
      title: '姓名 / 称谓',
      key: 'name',
      width: 150,
      render: (_: unknown, r) => (
        <>
          <div>{r.name}</div>
          {r.title && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {r.title}
            </Typography.Text>
          )}
        </>
      ),
    },
    { title: '部门/组', dataIndex: 'org_id', width: 120, render: (v: number | null) => orgName(v) },
    {
      title: '岗位',
      dataIndex: 'position',
      width: 100,
      render: (v: string | null) =>
        v ? (
          <Tag color={v === '总监' ? 'red' : v === '经理' ? 'blue' : 'default'}>{v}</Tag>
        ) : (
          '—'
        ),
    },
    {
      title: '角色',
      dataIndex: 'roles',
      render: (codes: string[] | undefined) =>
        codes?.length
          ? codes.map((c) => <Tag key={c}>{roles.find((r) => r.code === c)?.name ?? c}</Tag>)
          : '—',
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      width: 80,
      render: (v: boolean) => (v ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>),
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_: unknown, r: UserRow) => (
        <Space size="small">
          <a onClick={() => openEditUser(r)}>编辑</a>
          {scope?.can_manage_users && (
            <a
              onClick={() => {
                setHandoverTarget(r)
                setHandoverTo(undefined)
                setHandoverDeactivate(true)
              }}
              title="离职/停用：把任务、待审、项目角色转给别人"
            >
              转交
            </a>
          )}
          {scope?.is_admin && (
            <a onClick={() => impersonate(r)} title="以他的身份查看（只读）">
              以此人查看
            </a>
          )}
        </Space>
      ),
    },
  ]

  const orgColumns: ColumnsType<OrgRow> = [
    { title: '名称', dataIndex: 'name' },
    { title: '代码', dataIndex: 'code', width: 100 },
    { title: '类型', dataIndex: 'kind', width: 90, render: (v: string | null) => v ?? '—' },
    {
      title: '人数',
      dataIndex: 'user_count',
      width: 70,
      render: (v: number | undefined) => v ?? 0,
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      width: 80,
      render: (v: boolean | undefined) => (v ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>),
    },
  ]

  return (
    <Card title="用户与权限" loading={loading}>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'users',
            label: '用户',
            children: (
              <>
                <Space wrap style={{ marginBottom: 12 }}>
                  <TreeSelect
                    allowClear
                    style={{ width: 200 }}
                    placeholder="部门/组"
                    value={fOrg}
                    onChange={setFOrg}
                    treeData={buildOrgTree(visibleOrgs).map(function conv(n): {
                      value: number
                      title: string
                      children: ReturnType<typeof conv>[]
                    } {
                      return { value: n.key, title: n.org.name, children: n.children.map(conv) }
                    })}
                  />
                  <Select
                    allowClear
                    style={{ width: 170 }}
                    placeholder="角色"
                    value={fRole}
                    onChange={setFRole}
                    options={roles.map((r) => ({ value: r.code, label: r.name }))}
                  />
                  <Select
                    allowClear
                    style={{ width: 110 }}
                    placeholder="状态"
                    value={fActive}
                    onChange={setFActive}
                    options={[
                      { value: true, label: '启用' },
                      { value: false, label: '停用' },
                    ]}
                  />
                  <Input.Search
                    allowClear
                    style={{ width: 180 }}
                    placeholder="账号 / 姓名"
                    onSearch={setFQ}
                  />
                  {scope?.can_manage_users && (
                    <Button type="primary" onClick={openCreateUser}>
                      新建用户
                    </Button>
                  )}
                  {scope?.is_admin && (
                    <>
                      <Button onClick={() => void doGenerateDemo()}>生成演示账号</Button>
                      <Popconfirm title="停用所有演示账号？（不删，可再启用）" onConfirm={() => void doDisableDemo()}>
                        <Button>停用演示账号</Button>
                      </Popconfirm>
                    </>
                  )}
                </Space>
                <Table<UserRow>
                  rowKey="id"
                  size="middle"
                  dataSource={shownUsers}
                  columns={columns}
                  pagination={{ pageSize: 20, showSizeChanger: false }}
                />
                {!scope?.is_admin && scope?.department && (
                  <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
                    你是「{scope.department.name}」的总监：只能维护本部门的人，且只能勾本部门角色。
                  </Typography.Paragraph>
                )}
              </>
            ),
          },
          ...(scope?.can_manage_org
            ? [
                {
                  key: 'org',
                  label: '组织架构',
                  children: (
                    <>
                      <Space style={{ marginBottom: 12 }}>
                        {scope.is_admin && (
                          <Button type="primary" onClick={() => openCreateOrg(true)}>
                            新增部门
                          </Button>
                        )}
                        <Button onClick={() => openCreateOrg(false)}>在所选下新增组</Button>
                        <Button onClick={openEditOrg}>改名 / 调整上级</Button>
                      </Space>
                      <Tree
                        treeData={treeData.map(function conv(n): {
                          key: number
                          title: string
                          children: ReturnType<typeof conv>[]
                        } {
                          return { key: n.key, title: n.title, children: n.children.map(conv) }
                        })}
                        defaultExpandAll
                        selectedKeys={selectedOrg ? [selectedOrg] : []}
                        onSelect={(keys) => setSelectedOrg(keys[0] as number | undefined)}
                      />
                      {selectedOrg && (
                        <Space style={{ marginTop: 12 }}>
                          {(() => {
                            const org = visibleOrgs.find((o) => o.id === selectedOrg)
                            if (!org) return null
                            return (
                              <>
                                <Tag>{org.code}</Tag>
                                <Popconfirm
                                  title={org.is_active ? '停用这个组织？（保留历史）' : '重新启用？'}
                                  onConfirm={() => void toggleOrg(org)}
                                >
                                  <a>{org.is_active ? '停用' : '启用'}</a>
                                </Popconfirm>
                              </>
                            )
                          })()}
                        </Space>
                      )}
                      <div style={{ marginTop: 16 }}>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          部门/组的改名、新增、停用都在这里；停用不删，历史单据不受影响。
                        </Typography.Text>
                      </div>
                      <Table<OrgRow>
                        style={{ marginTop: 12 }}
                        rowKey="id"
                        size="small"
                        dataSource={visibleOrgs}
                        columns={orgColumns}
                        pagination={false}
                      />
                    </>
                  ),
                },
              ]
            : []),
          {
            key: 'roles',
            label: '角色说明',
            children: (
              <>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                  角色固定：只给用户勾角色，不给个人单独配权限（06 卷 §4）。
                </Typography.Paragraph>
                <Table<RoleRow>
                  rowKey="code"
                  size="small"
                  dataSource={roles}
                  pagination={false}
                  columns={[
                    { title: '角色', dataIndex: 'name', width: 140 },
                    { title: '代码', dataIndex: 'code', width: 140 },
                    {
                      title: '可见工作台',
                      key: 'workbench',
                      render: (_: unknown, r) => ROLE_WORKBENCH[r.code] ?? '—',
                    },
                    {
                      title: '金额可见',
                      key: 'money',
                      width: 170,
                      render: (_: unknown, r) => ROLE_MONEY[r.code] ?? '—',
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: 'logs',
            label: '操作日志',
            children: (
              <>
                <Space style={{ marginBottom: 12 }}>
                  <Button
                    size="small"
                    loading={logsLoading}
                    onClick={() => {
                      setLogsLoading(true)
                      listAuditLogs({})
                        .then(setLogs)
                        .catch((e) => message.error(errMsg(e)))
                        .finally(() => setLogsLoading(false))
                    }}
                  >
                    刷新
                  </Button>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    最近 100 条写操作（谁、何时、干了什么）—— 所有写操作都留痕。
                  </Typography.Text>
                </Space>
                <Table<AuditLog>
                  rowKey="id"
                  size="small"
                  loading={logsLoading}
                  dataSource={logs}
                  pagination={{ pageSize: 20, showSizeChanger: false }}
                  columns={[
                    {
                      title: '时间',
                      dataIndex: 'created_at',
                      width: 150,
                      render: (v: string | null) => (v ? v.slice(5, 16).replace('T', ' ') : '—'),
                    },
                    { title: '操作人', dataIndex: 'username', width: 110, render: (v: string | null) => v ?? '系统' },
                    { title: '动作', dataIndex: 'action', width: 110 },
                    { title: '对象', key: 'obj', width: 180, render: (_: unknown, r: AuditLog) => `${r.object_type ?? ''} ${r.object_ref ?? ''}` },
                    { title: '摘要', dataIndex: 'summary' },
                  ]}
                />
              </>
            ),
          },
        ]}
      />

      {/* 用户编辑 */}
      <Modal
        open={userOpen}
        title={editUser ? `编辑用户：${editUser.name}` : '新建用户'}
        onCancel={() => setUserOpen(false)}
        onOk={() => void saveUser()}
        confirmLoading={saving}
        okText="保存"
        destroyOnHidden
      >
        <Form form={userForm} layout="vertical" preserve={false}>
          <Form.Item
            name="username"
            label="账号"
            rules={editUser ? [] : [{ required: true, message: '请输入账号' }]}
          >
            <Input disabled={!!editUser} autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="password"
            label={editUser ? '重置密码（留空不改）' : '初始密码'}
            rules={editUser ? [] : [{ required: true, message: '请输入初始密码' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="手机">
            <Input />
          </Form.Item>
          <Form.Item name="org_id" label="部门 / 组" rules={[{ required: true, message: '选部门/组' }]}>
            <TreeSelect
              treeData={buildOrgTree(visibleOrgs).map(function conv(n): {
                value: number
                title: string
                children: ReturnType<typeof conv>[]
              } {
                return { value: n.key, title: n.org.name, children: n.children.map(conv) }
              })}
            />
          </Form.Item>
          <Space size="middle" style={{ display: 'flex' }}>
            <Form.Item name="position" label="岗位" style={{ flex: 1 }}>
              <Select options={assignablePositions.map((p) => ({ value: p, label: p }))} />
            </Form.Item>
            <Form.Item name="title" label="称谓（可选）" style={{ flex: 1 }}>
              <Input placeholder="如：设计师 / 采购员" />
            </Form.Item>
          </Space>
          <Form.Item name="profession" label="专业（工程部用）">
            <Select allowClear options={PROFESSIONS.map((p) => ({ value: p, label: p }))} />
          </Form.Item>
          <Form.Item name="role_codes" label="角色">
            <Select mode="multiple" options={assignableRoles.map((r) => ({ value: r.code, label: r.name }))} />
          </Form.Item>
          {editUser && (
            <Form.Item name="is_active" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* 转交 */}
      <Modal
        title={`转交：${handoverTarget?.name ?? ''}`}
        open={!!handoverTarget}
        onCancel={() => setHandoverTarget(null)}
        onOk={() => void doHandover()}
        confirmLoading={handoverSaving}
        okButtonProps={{ disabled: !handoverTo }}
        okText="转交"
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          把 TA 手上<strong>未完成的任务、待审的评审单、项目角色、图纸/程序/BOM 归属</strong>
          转给另一个人，便于离职交接。
        </Typography.Paragraph>
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Select
            style={{ width: '100%' }}
            placeholder="转交给谁"
            value={handoverTo}
            onChange={setHandoverTo}
            showSearch
            optionFilterProp="label"
            options={users
              .filter((u) => u.id !== handoverTarget?.id && u.is_active)
              .map((u) => ({ value: u.id, label: `${u.name}（${orgName(u.org_id)}）` }))}
          />
          <Space>
            <Switch checked={handoverDeactivate} onChange={setHandoverDeactivate} />
            <span style={{ fontSize: 13 }}>转交后停用原账号（推荐）</span>
          </Space>
        </Space>
      </Modal>

      {/* 演示账号清单 */}
      <Modal
        open={demoOpen}
        title={`演示账号（密码统一 ${demoPassword}）`}
        width={760}
        footer={<Button onClick={() => setDemoOpen(false)}>关闭</Button>}
        onCancel={() => setDemoOpen(false)}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          用不同账号登录即可验证「工作台 / 菜单可见 / 两级审核 / 通知」。
          两级审核示例：<b>mech1</b> 提交 → <b>mech_manager</b> → <b>eng_director</b>。
          上线前请「停用演示账号」或改密。
        </Typography.Paragraph>
        <Table<DemoUserRow>
          rowKey="username"
          size="small"
          dataSource={demoUsers}
          pagination={false}
          columns={[
            { title: '账号', dataIndex: 'username', width: 130 },
            { title: '姓名', dataIndex: 'name', width: 110 },
            { title: '部门', dataIndex: 'org', width: 100, render: (v: string | null) => v ?? '—' },
            { title: '岗位', dataIndex: 'position', width: 70 },
            {
              title: '角色',
              dataIndex: 'roles',
              render: (v: string[]) => v.map((x) => <Tag key={x}>{x}</Tag>),
            },
          ]}
        />
      </Modal>

      {/* 组织编辑 */}
      <Modal
        open={orgOpen}
        title={orgEditing ? `编辑组织：${orgEditing.name}` : '新增组织'}
        onCancel={() => setOrgOpen(false)}
        onOk={() => void saveOrg()}
        confirmLoading={saving}
        okText="保存"
        destroyOnHidden
      >
        <Form form={orgForm} layout="vertical" preserve={false}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：机械组 / 深圳仓" />
          </Form.Item>
          <Form.Item name="parent_id" label="上级">
            <Select allowClear options={orgOptions.map((o) => ({ value: o.value, label: o.label }))} />
          </Form.Item>
          <Form.Item name="kind" label="类型">
            <Input placeholder="如：技术 / 业务 / 供应链 / 制造" />
          </Form.Item>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            上级留空 = 顶级部门（仅管理员）；总监只能在自己部门下建组。
          </Typography.Paragraph>
        </Form>
      </Modal>
    </Card>
  )
}
