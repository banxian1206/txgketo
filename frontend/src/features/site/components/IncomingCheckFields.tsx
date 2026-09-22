// features/site/components/IncomingCheckFields.tsx —— 现场清点字段（重构 2.1：原 PC/移动逐行重复两份）
import { Button, Form, Input, Radio, Space } from 'antd'

/** 清点结论 + 缺件明细 + 备注（照片选择留在各壳，由外层 Form 收集） */
export default function IncomingCheckFields() {
  return (
    <>
      <Form.Item name="result" label="清点结论" rules={[{ required: true }]}>
        <Radio.Group optionType="button" buttonStyle="solid">
          <Radio.Button value="齐">齐</Radio.Button>
          <Radio.Button value="缺件">缺件</Radio.Button>
          <Radio.Button value="破损">破损</Radio.Button>
        </Radio.Group>
      </Form.Item>
      <Form.List name="shortage">
        {(fields, { add, remove }) => (
          <>
            {fields.map((f) => (
              <Space key={f.key} wrap style={{ marginBottom: 6 }}>
                <Form.Item name={[f.name, 'item']} style={{ marginBottom: 0 }}><Input placeholder="缺/损零件" style={{ width: 170 }} /></Form.Item>
                <Form.Item name={[f.name, 'qty']} style={{ marginBottom: 0 }}><Input type="number" placeholder="数量" style={{ width: 90 }} /></Form.Item>
                <Form.Item name={[f.name, 'reason']} style={{ marginBottom: 0 }}><Input placeholder="原因" style={{ width: 150 }} /></Form.Item>
                <a onClick={() => remove(f.name)}>删</a>
              </Space>
            ))}
            <Button type="dashed" block onClick={() => add()}>加一条缺件</Button>
          </>
        )}
      </Form.List>
      <Form.Item name="remark" label="备注" style={{ marginTop: 8 }}><Input /></Form.Item>
    </>
  )
}
