export function MentionOptionLabel({ name, companyName, email }: { name: string; companyName?: string; email?: string }) {
  return <><strong>{name}</strong><small>{companyName?.trim() || '未填写公司名称'}、{email?.trim() || '未填写邮箱'}</small></>;
}
