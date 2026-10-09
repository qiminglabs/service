import { renderActivityText, type ActivityEvent } from '../activity-events.ts';
import activityMessages from '../activity-messages.json' with { type: 'json' };
import { translate, translateExact, translateList, translateMessage, type Locale } from './translate.ts';

type Activity = { title: string; detail: string; event?: ActivityEvent };
const catalog: Record<string, { en: string }> = activityMessages;
export function translateActivityTitle(activity: Activity, locale: Locale, labels: Record<string, string> = {}): string {
  return activity.event?.version === 1 ? renderActivityText(activity.event.params.title, locale) : translate(activity.title, locale, labels);
}

// Older activity records contain canonical Chinese strings. Decode only the
// system-generated shape for the matching event type; never rewrite storage.
export function translateActivityDetail(activity: Activity, locale: Locale, labels: Record<string, string> = {}): string {
  if (activity.event?.version === 1) return renderActivityText(activity.event.params.detail, locale);
  const { title, detail } = activity;
  if (locale !== 'en' || !detail) return detail;
  const exact = (value: string) => catalog[value]?.en ?? translateExact(value, locale, labels);
  const message = (key: string, values: (string | number)[]) => catalog[key] ? renderActivityText({ kind: 'message', key, values }, locale) : translateMessage(key, values, locale, labels);
  const list = (values: string[]) => translateList(values, locale, labels);
  const amount = (value: string) => {
    const rows = value.split('、');
    const parsed = rows.map(row => row.match(/^(远程|现场) ([\d.]+) 人天$/));
    if (parsed.every(Boolean)) return list(parsed.map(row => message('{0} {1} 人天', [exact(row![1]), row![2]])));
    const total = value.match(/^([\d.]+) 人天$/);
    return total ? message('{0} 人天', [total[1]]) : exact(value);
  };

  if (title === '创建服务项目') {
    const [header, ...projects] = detail.split('\n');
    const counts = header.match(/^创建 (\d+) 个项目、(\d+) 个工单。$/);
    if (counts) return [message('创建 {0} 个项目、{1} 个工单。', [counts[1], counts[2]]), ...projects.map(project => {
      const split = project.indexOf('：');
      return split < 0 ? exact(project) : message('{0}：{1}', [exact(project.slice(0, split)), list(project.slice(split + 1).split('、').map(exact))]);
    })].join('\n');
  }

  if (title === '发起客户确认') {
    const match = detail.match(/^([\s\S]*?) · 计价总人天 ([\d.]+) · 客户资产 ([\d.]+) · 特批 ([\d.]+)$/);
    if (match) {
      const totals = message('计价总人天 {0} · 客户资产 {1} · 特批 {2}', match.slice(2));
      return match[1] ? message('{0} · {1}', [exact(match[1]), totals]) : totals;
    }
  }

  if (['特殊审批全部通过', '特殊审批环节通过', '特殊审批驳回，退回申请人'].includes(title)) {
    const match = detail.match(/^([\s\S]+?) · ([\s\S]+?)(审批通过|驳回，退回申请人)(?:；下一审批人：([\s\S]+))?$/);
    if (match) {
      const decision = match[3] === '审批通过'
        ? message('{0} · {1}审批通过', [exact(match[1]), match[2]])
        : message('{0} · {1}驳回，退回申请人', [exact(match[1]), match[2]]);
      return match[4] ? message('{0}；下一审批人：{1}', [decision, match[4]]) : decision;
    }
  }

  if (title === '发起特殊审批' || title === '发起额度特批') {
    const parts = detail.split(' · ');
    if (parts[0].startsWith('申请额度 ') && parts.length >= 2) {
      const requested = message('申请额度 {0}', [amount(parts[0].slice('申请额度 '.length))]);
      if (title === '发起特殊审批' && parts.length >= 4) {
        return message('{0} · {1} · {2} · {3}', [requested, exact(parts.slice(1, -2).join(' · ')), exact(parts.at(-2)!), parts.at(-1)!]);
      }
      return message('{0} · {1}', [requested, exact(parts.slice(1).join(' · '))]);
    }
  }

  if (title === '人天核定' || title === '核定人天' || title === '人天核定 · 评估完成') {
    const match = detail.match(/^预估 ([\d.]+) 人天 · 计价 ([\d.]+) 人天 · ([\s\S]*)$/);
    if (match) {
      const [formulas, ...notes] = match[3].split(' · ');
      const rows = formulas.split('；').map(row => row.match(/^(.+)：(差额权益 )?([\d.]+) × ([\d.]+) = ([\d.]+)$/));
      if (rows.every(Boolean)) {
        const lines = rows.map(row => message('{0}：{1} × {2} = {3}', [exact(row![1]), row![2] ? message('差额权益 {0}', [row![3]]) : row![3], row![4], row![5]]));
        const summary = message('预估 {0} 人天 · 计价 {1} 人天 · {2}', [match[1], match[2], translateList(lines, locale, labels, '; ')]);
        return notes.length ? message('{0} · {1}', [summary, exact(notes.join(' · '))]) : summary;
      }
    }
  }

  // These event details are human-authored comments, not system message templates.
  if (title.startsWith('材料评估') || ['额度特批通过', '额度特批拒绝', '项目额度审批通过', '项目额度审批拒绝'].includes(title)) return exact(detail);
  return translate(detail, locale, labels);
}
