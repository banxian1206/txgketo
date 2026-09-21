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
  POSITIONS,
  PROFESSIONS,
  createOrg,
  createUser,
  errMsg,
  getMyScope,
  listOrgs,
  listRoles,
  listUsers,
  updateOrg,
  updateUser,
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

/** 用户与权限（06 卷）：组织维护 + 用户管理（管理员 / 部门负责人管本部门）+ 角色说明 */
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

  // 部门负责人只看自己部门这棵树
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
    () => (scope?.is_admin ? POSITIONS : POSITIONS.filter((p) => p !== '部门负责人')),
    [scope],
  )

  // 部门负责人：用户列表里只展示本部门的人（后端也会拦越权操作）
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
      position: '成员',
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
          <Tag color={v === '部门负责人' ? 'red' : v === '组长' ? 'blue' : 'default'}>{v}</Tag>
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
      width: 80,
      render: (_: unknown, r: UserRow) => <a onClick={() => openEditUser(r)}>编辑</a>,
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
                    你是「{scope.department.name}」的部门负责人：只能维护本部门的人，且只能勾本部门角色。
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
        destroyOnClose
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

      {/* 组织编辑 */}
      <Modal
        open={orgOpen}
        title={orgEditing ? `编辑组织：${orgEditing.name}` : '新增组织'}
        onCancel={() => setOrgOpen(false)}
        onOk={() => void saveOrg()}
        confirmLoading={saving}
        okText="保存"
        destroyOnClose
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
            上级留空 = 顶级部门（仅管理员）；部门负责人只能在自己部门下建组。
          </Typography.Paragraph>
        </Form>
      </Modal>
    </Card>
  )
}
