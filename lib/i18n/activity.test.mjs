import test from 'node:test';
import assert from 'node:assert/strict';
import { translateActivityDetail } from './activity.ts';

const activities = [
  { title: '创建服务项目', detail: '创建 1 个项目、2 个工单。\n【示例】计划调整取消项目：超融合核心平台新装、集群升级（服务权益）' },
  { title: '发起客户确认', detail: ' · 计价总人天 2 · 客户资产 0 · 特批 2' },
  { title: '特殊审批全部通过', detail: '最终审批 · 陆明审批通过' },
  { title: '特殊审批环节通过', detail: '申请人汇报人审批 · 赵言审批通过；下一审批人：陆明' },
  { title: '发起特殊审批', detail: '申请额度 远程 2 人天 · 演示用特殊审批，按已保存规则依次处理。 · 金融客户特殊审批 · 赵言 → 陆明' },
  { title: '服务依据关联', detail: '计价总人天 2 · 关联 0 人天' },
  { title: '人天核定', detail: '预估 2 人天 · 计价 2 人天 · 超融合核心平台新装：2 × 1 = 2；集群升级（服务权益）：差额权益 0 × 0.3 = 0 · 演示估算，以实际服务评估为准。' },
  { title: '材料评估 · 评估通过', detail: '示例环境清单与需求材料已核对，可以进入服务评估。' },
];

test('historical activity details translate full system messages while preserving people, numbers and stored records', () => {
  const before = structuredClone(activities);
  const results = activities.map(activity => translateActivityDetail(activity, 'en'));
  for (const text of results) {
    assert.doesNotMatch(text.replaceAll('陆明', '').replaceAll('赵言', ''), /[\u3400-\u9fff]/, text);
    assert.doesNotMatch(text, /\{\d+\}/, text);
  }
  assert.match(results[0], /Created 1 projects and 2 work orders\./);
  assert.match(results[0], /Cluster Upgrade \(Entitlement\)/);
  assert.equal(results[1], 'Total billable person-days 2 · Customer assets 0 · Exception allowance 2');
  assert.equal(results[2], 'Final approval · Approved by 陆明');
  assert.match(results[3], /Approved by 赵言; Next approver: 陆明/);
  assert.match(results[4], /赵言 → 陆明$/);
  assert.match(results[6], /0 × 0.3 = 0/);
  for (const activity of activities) assert.equal(translateActivityDetail(activity, 'zh-CN'), activity.detail);
  assert.deepEqual(activities, before);
});

test('legacy activity uses fixed event templates while preserving configurable labels and opinions', () => {
  assert.equal(translateActivityDetail(activities[2], 'en', { 最终审批: 'Final review', '{0} · {1}审批通过': '{1} approved {0}' }), 'Final review · Approved by 陆明');
  const detail = '用户意见：保留远程、现场原始说明 $&';
  assert.equal(translateActivityDetail({ title: '材料评估 · 评估通过', detail }, 'en'), detail);
  assert.equal(translateActivityDetail({ title: '特殊审批全部通过', detail: '客户自定义步骤 · 张三审批通过' }, 'en'), '客户自定义步骤 · Approved by 张三');
  const mixed = translateActivityDetail({ title: '发起特殊审批', detail: '申请额度 远程 2 人天、现场 1.5 人天 · 用户意见 · 客户自定义审批 · 张三 → 李四' }, 'en');
  assert.equal(mixed, 'Requested allowance Remote 2 person-days, Onsite 1.5 person-days · 用户意见 · 客户自定义审批 · 张三 → 李四');
});
