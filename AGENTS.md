# 项目日期组件规范

- 所有新增或修改的日期选择字段统一使用 `components/date-field.tsx` 导出的 `DateField`，与服务申请的日期选择体验一致。
- 使用中文弹出日历，保留“今天”“清空”、键盘操作及只读/禁用状态；不要新增浏览器原生 `type="date"` 日期输入框或另起一套日期选择器。
- 通过 `id`、`label`、`required`、`value`、`onChange`、`readonly` 和 `disabled` 配置业务字段。单日值使用 `YYYY-MM-DD` 字符串，未填写为 `''`，不转换成 UTC 时间戳。
- 必填、历史日期是否允许等业务校验仍由对应表单负责。日期时间或日期范围的新需求应在公共组件体系内扩展，不改变已有数据格式或校验规则。

# 项目时间组件规范

- 所有新增或修改的时刻选择字段统一使用 `components/time-field.tsx` 导出的 `TimeField`，禁止新增浏览器原生 `type="time"` 或 `datetime-local` 输入框。
- 保留整块字段点击展开、小时/分钟双列、直接输入、清空/取消/确定、键盘操作、只读和禁用状态。弹层必须正确覆盖所在业务弹窗。
- 使用 `id`、`label`、`required`、`value`、`onChange`、`readonly` 和 `disabled` 配置。值使用 24 小时制 `HH:mm` 字符串，空值为 `''`；不转换成 UTC 时间戳。
- 日期时间组合使用 `DateField` + `TimeField`。预约是否在未来等业务规则由业务表单与保存逻辑校验，公共组件仅校验时刻格式。
