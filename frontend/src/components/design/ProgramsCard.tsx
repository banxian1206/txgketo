// components/design/ProgramsCard.tsx —— 由 EquipmentDesign 拆出（重构 1.6 · 只拆不改）
import { Button, Card, Empty, Popconfirm, Space, Table, Tooltip } from 'antd'
import { Status, Chip } from '../../components/ds'


import AuthedFileLink from '../AuthedFileLink'

import { programFileUrl, type ProgramItem, type User } from '../../api/client'
import { DRAWING_STATUS as STATUS_COLOR, toneOf } from '../../theme/status'
import { CHANGE_STATUS as CHANGE_STATUS_COLOR } from '../../theme/status'

import { changeActionAvailable as CHANGE_ACTION_AVAILABLE } from './shared'
export default function ProgramsCard({
  doNewProgramVersion,
  openProgramVersions,
  profile,
  programs,
  removeProgram,
  setChangeTarget,
  setProgCreateOpen,
  setProgUploadOpen,
  setProgUploadTarget
}: {
  doNewProgramVersion: (...args: any[]) => any;
  openProgramVersions: (...args: any[]) => any;
  profile: User | null;
  programs: ProgramItem[];
  removeProgram: any;
  setChangeTarget: (...args: any[]) => any;
  setProgCreateOpen: (...args: any[]) => any;
  setProgUploadOpen: (...args: any[]) => any;
  setProgUploadTarget: (...args: any[]) => any;
}) {
  return (
    <>
      <Card
        size="small"
        title={`PLC 程序版本（${programs.length}）`}
        style={{ marginTop: 16 }}
        extra={
          <Button
            size="small"
            onClick={() => {
              // ★ F14：destroyOnHidden 弹窗未挂载时 resetFields 会报 useForm 未连接警告；新实例本就干净
              setProgCreateOpen(true)
            }}
          >
            + 新建程序
          </Button>
        }
      >
        <Table<ProgramItem>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={programs}
          locale={{ emptyText: <Empty description="程序专业还没建程序（建好后走评审单两级审核发布）" /> }}
          columns={[
            { title: '程序', dataIndex: 'name' },
            {
              title: '版本',
              dataIndex: 'current_version',
              width: 70,
              render: (v: string) => <Chip>{v}</Chip>,
            },
            {
              title: '文件',
              dataIndex: 'current_filename',
              width: 200,
              render: (v: string | null | undefined) => v ?? '—',
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 90,
              render: (v: string) => <Status tone={toneOf(STATUS_COLOR[v])}>{v}</Status>,
            },
            {
              title: '操作',
              key: 'action',
              width: 230,
              render: (_: unknown, p: ProgramItem) => (
                <Space size="small">
                  {p.status === '草稿' && (
                    <a
                      onClick={() => {
                        setProgUploadTarget(p)
                        setProgUploadOpen(true) // ★ F14：同上，destroyOnHidden 不需要开前 reset
                      }}
                    >
                      上传程序
                    </a>
                  )}
                  <a onClick={() => void openProgramVersions(p)}>版本</a>
                  {p.current_filename && (
                    <AuthedFileLink path={programFileUrl(p.id)}>下载程序</AuthedFileLink>
                  )}
                  {p.status === '已发布' && !p.change_request && (
                    <a
                      onClick={() =>
                        setChangeTarget({
                          type: 'PROGRAM',
                          ref: String(p.id),
                          title: `程序 ${p.name}（${p.current_version}）`,
                        })
                      }
                    >
                      提改版申请
                    </a>
                  )}
                  {p.status === '已发布' && p.change_request && (
                    <Tooltip title={`改版申请 ${p.change_request.cr_no}：${p.change_request.status}`}>
                      <Chip tone={toneOf(CHANGE_STATUS_COLOR[p.change_request.status])}>
                        {p.change_request.status}
                      </Chip>
                    </Tooltip>
                  )}
                  {CHANGE_ACTION_AVAILABLE(p.change_request) &&
                    p.change_request?.change_task_owner_id === profile?.id && (
                      <a onClick={() => doNewProgramVersion(p)}>改版出新版</a>
                    )}
                  {p.status === '草稿' && (
                    <Popconfirm title={`删除程序 ${p.name}？`} onConfirm={() => void removeProgram(p)}>
                      <a>删除</a>
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </>
  )
}
