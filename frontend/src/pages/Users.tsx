import {
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useState } from 'react'

import {
  PROFESSIONS,
  POSITIONS,
  createUser,
  errMsg,
  listOrgs,
  listRoles,
  listUsers,
  updateUser,
  type OrgRow,
  type RoleRow,
  type UserRow,
} from '../api/client'

/** 用户与岗位：审核人（组长/总监）就是在这里配出来的（05 卷 §2.1） */
export default function Users() {
  const { message } = App.useApp()
  const [rows, setRows] = useState<UserRow[]>([])
  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [u, o, r] = await Promise.all([listUsers(), listOrgs(), listRoles()])
      setRows(u)
      setOrgs(o)
      setRoles(r)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ role_codes: ['DESIGN'] })
    setOpen(true)
  }

  const openEdit = (row: UserRow) => {
    setEditing(row)
    form.setFieldsValue({
      username: row.username,
      name: row.name,
      phone: row.phone,
      org_id: row.org_id,
      profession: row.profession,
      position: row.position,
      role_codes: row.roles ?? [],
      is_active: row.is_active,
      password: undefined,
    })
    setOpen(true)
  }

  const save = async () => {
    const v = await form.validateFields()
    setSaving(true)
    try {
      if (editing) {
        await updateUser(editing.id, {
          name: v.name,
          phone: v.phone ?? null,
          org_id: v.org_id ?? null,
          profession: v.profession ?? null,
          position: v.position ?? null,
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
          profession: v.profession ?? null,
          position: v.position ?? null,
          role_codes: v.role_codes ?? [],
        })
        message.success('用户已创建')
      }
      setOpen(false)
      await load()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const orgName = (id?: number | null) => orgs.find((o) => o.id === id)?.name ?? '—'

  const columns: ColumnsType<UserRow> = [
    { title: '账号', dataIndex: 'username', width: 110 },
    { title: '姓名', dataIndex: 'name', width: 110 },
    {
      title: '组织',
      dataIndex: 'org_id',
      width: 100,
      render: (v: number | null | undefined) => orgName(v),
    },
    {
      title: '专业',
      dataIndex: 'profession',
      width: 80,
      render: (v: string | null | undefined) => v ?? '—',
    },
    {
      title: '岗位',
      dataIndex: 'position',
      width: 100,
      render: (v: string | null | undefined) =>
        v ? <Tag color={v === '工程总监' ? 'red' : v === '设计组长' ? 'blue' : 'default'}>{v}</Tag> : '—',
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
      render: (_: unknown, r: UserRow) => <a onClick={() => openEdit(r)}>编辑</a>,
    },
  ]

  return (
    <Card title="用户与岗位" extra={<Button type="primary" onClick={openCreate}>新建用户</Button>}>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        审核链在这里配：专业（机械/电气/程序/工艺）+ 岗位（设计师/设计组长/工程总监）。
        立项时设计任务直接派给各专业设计组长，组长再拆给组员；提交后也是这套人来做两级审核（05 卷 §2.1）。
      </Typography.Paragraph>
      <Table<UserRow>
        rowKey="id"
        size="middle"
        loading={loading}
        dataSource={rows}
        columns={columns}
        pagination={{ pageSize: 20, showSizeChanger: false }}
      />
      <Modal
        open={open}
        title={editing ? `编辑用户：${editing.name}` : '新建用户'}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        confirmLoading={saving}
        okText="保存"
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="username"
            label="账号"
            rules={editing ? [] : [{ required: true, message: '请输入账号' }]}
          >
            <Input disabled={!!editing} autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="password"
            label={editing ? '重置密码（留空不改）' : '密码'}
            rules={editing ? [] : [{ required: true, message: '请输入密码' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="手机">
            <Input />
          </Form.Item>
          <Form.Item name="org_id" label="组织">
            <Select allowClear options={orgs.map((o) => ({ value: o.id, label: o.name }))} />
          </Form.Item>
          <Space size="middle" style={{ display: 'flex' }}>
            <Form.Item name="profession" label="专业" style={{ flex: 1 }}>
              <Select allowClear options={PROFESSIONS.map((p) => ({ value: p, label: p }))} />
            </Form.Item>
            <Form.Item name="position" label="岗位" style={{ flex: 1 }}>
              <Select allowClear options={POSITIONS.map((p) => ({ value: p, label: p }))} />
            </Form.Item>
          </Space>
          <Form.Item name="role_codes" label="角色">
            <Select
              mode="multiple"
              options={roles.map((r) => ({ value: r.code, label: r.name }))}
            />
          </Form.Item>
          {editing && (
            <Form.Item name="is_active" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </Card>
  )
}
