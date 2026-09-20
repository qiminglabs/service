import type { ServiceProjectRecord } from './service-projects';
import type { ProjectCollaboratorDirectory, ProjectCollaboratorGroup } from './service-project-collaborators';
import { dailyReportEmails, dailyReportEmailValid } from './service-project-daily-reports.ts';

export type DailyReportRecipient = {
  key: string;
  name: string;
  email: string;
  group: ProjectCollaboratorGroup;
  issue: string;
};
export function dailyReportRecipients(project: Pick<ServiceProjectRecord, 'customerId' | 'collaborators'>, directory: ProjectCollaboratorDirectory): DailyReportRecipient[] {
  return (['customer', 'internal', 'partner'] as const).flatMap(group =>
    (project.collaborators?.[group] ?? []).map(member => {
      const person = group === 'customer'
        ? directory.contacts.find(person => person.id === member.id && person.customerId === project.customerId)
        : group === 'internal' ? directory.users.find(person => person.id === member.id)
        : directory.partnerUsers.find(person => person.id === member.id);
      const email = person?.email?.trim().toLowerCase() ?? '';
      const partner = group === 'partner' && person && 'partnerId' in person
        ? directory.partners.find(company => company.id === person.partnerId) : undefined;
      const issue = !person ? '联系人不可用' : person.status !== '启用' ? '联系人已停用'
        : group === 'partner' && partner?.status !== '启用' ? '所属企业不可用'
        : !email ? '未填写邮箱' : !dailyReportEmailValid(email) ? '邮箱格式无效' : '';
      return { key: `${group}:${member.id}`, name: person?.name ?? member.name, email, group, issue };
    }),
  );
}
export function defaultDailyReportRecipients(recipients: DailyReportRecipient[]) {
  const to = dailyReportEmails(recipients.filter(person => person.group === 'customer' && !person.issue).map(person => person.email).join('; '));
  const cc = dailyReportEmails(recipients.filter(person => person.group === 'internal' && !person.issue).map(person => person.email).join('; ')).filter(email => !to.includes(email));
  return { to: to.join('; '), cc: cc.join('; ') };
}
export function toggleDailyReportRecipient(value: string, person: DailyReportRecipient, checked: boolean) {
  if (person.issue) return value;
  const emails = dailyReportEmails(value);
  return (checked ? [...new Set([...emails, person.email])] : emails.filter(email => email !== person.email)).join('; ');
}
