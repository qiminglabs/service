import type { InternalUser } from './service-requests';

// Local prototype directory only; these are not provisioned accounts.
export const localInternalUsers: InternalUser[] = [
  {
    id: 'demo-sales-1',
    name: '销售用户一（示例）',
    email: 'sales1@example.com',
    department: '销售部',
    status: '启用',
  },
  {
    id: 'demo-sales-2',
    name: '销售用户二（示例）',
    email: 'sales2@example.com',
    department: '销售部',
    status: '启用',
  },
  {
    id: 'demo-presales-1',
    name: '售前用户一（示例）',
    email: 'presales1@example.com',
    department: '售前团队',
    status: '启用',
  },
  {
    id: 'demo-presales-2',
    name: '售前用户二（示例）',
    email: 'presales2@example.com',
    department: '售前团队',
    status: '启用',
  },
  {
    id: 'demo-project-1',
    name: '项目用户（示例）',
    email: 'project@example.com',
    department: '项目管理部',
    status: '启用',
  },
  {
    id: 'demo-service-1',
    name: '服务用户（示例）',
    email: 'service@example.com',
    department: '技术服务部',
    status: '启用',
  },
];
