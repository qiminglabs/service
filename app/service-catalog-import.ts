export type ImportedServiceCatalogSeed = {
  serviceCategory:
    | '产品实施交付'
    | '产品增值服务'
    | '运维支持或培训'
    | '技术保障或支持';
  serviceName: string;
  serviceDescription: string;
  pricingUnit?: '服务人天' | '巡检权益' | '升级权益';
  supportedProviders: Array<'原厂' | '代理商' | '服务商'>;
};

const allProviders: ImportedServiceCatalogSeed['supportedProviders'] = [
  '原厂',
  '服务商',
  '代理商',
];
const originalProvider: ImportedServiceCatalogSeed['supportedProviders'] = [
  '原厂',
];

export const importedServiceCatalogSeeds: ImportedServiceCatalogSeed[] = [
  {
    serviceCategory: '产品实施交付',
    serviceName: '超融合核心平台新装',
    serviceDescription:
      '新建集群，SMTX OS+CloudTower+可观测性平台（含流量可视化）+备份与容灾安装实施，含规划设计、部署测试、报告整理、运维培训',
    supportedProviders: allProviders,
  },
  {
    serviceCategory: '产品实施交付',
    serviceName: '超融合核心平台扩容',
    serviceDescription:
      '集群扩容节点，SMTX OS+CloudTower+可观测性平台（含流量可视化）+备份与容灾，含规划设计、部署测试、报告整理，无新增产品安装时，不含运维培训（首次新装已包含）',
    supportedProviders: allProviders,
  },
  {
    serviceCategory: '产品实施交付',
    serviceName: '分布式存储新装',
    serviceDescription:
      '新建集群，SMTX ZBS+CloudTower+对接 SMTX ELF 或第三方计算平台，含规划设计、部署测试、报告整理、运维培训',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品实施交付',
    serviceName: '分布式存储扩容',
    serviceDescription:
      '集群节点扩容，SMTX ZBS+CloudTower+对接 SMTX ELF 或第三方计算平台，含规划设计、部署测试、报告整理，无新增产品安装时，不含运维培训（首次新装已包含）',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品实施交付',
    serviceName: '超融合双活集群新装',
    serviceDescription:
      '新建集群，SMTX OS+双活模块+CloudTower+可观测性平台（含流量可视化）+备份与容灾安装实施，含规划设计、部署测试、报告整理、运维培训',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品实施交付',
    serviceName: '超融合双活集群扩容',
    serviceDescription:
      '集群扩容节点，SMTX OS+双活模块+CloudTower+可观测性平台（含流量可视化）+备份与容灾，含规划设计、部署测试、报告整理，无新增产品安装时，不含运维培训（首次新装已包含）',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品实施交付',
    serviceName: '超融合集群转换双活集群',
    serviceDescription:
      '非双活集群转双活集群，含规划设计、部署测试、报告整理、运维培训',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品实施交付',
    serviceName: '硬件兼容性测试',
    serviceDescription:
      '产品实施交付中，对于不符合 SmartX HCL 的服务器或配件进行兼容性测试，并评估是否可以在正式环境使用',
    supportedProviders: allProviders,
  },
  {
    serviceCategory: '产品实施交付',
    serviceName: '备份与容灾-备份组件新装',
    serviceDescription:
      '新装备份组件，含规划设计、部署测试、报告整理、运维培训',
    supportedProviders: allProviders,
  },
  {
    serviceCategory: '产品实施交付',
    serviceName: '备份与容灾-复制组件新装',
    serviceDescription:
      '新装复制组件，含规划设计、部署测试、报告整理、运维培训',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品实施交付',
    serviceName: 'Kubernetes 服务组件新装',
    serviceDescription: '新装SKS组件，含规划设计、部署测试、报告整理、运维培训',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品实施交付',
    serviceName: 'Everoute 分布式防火墙组件新装',
    serviceDescription:
      '新装ER分布式防火墙组件，含规划设计、部署测试、报告整理、运维培训',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品实施交付',
    serviceName: 'Everoute 负载均衡组件新装',
    serviceDescription:
      '新装ER负载均衡组件，含规划设计、部署测试、报告整理、运维培训',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品实施交付',
    serviceName: 'Everoute 虚拟专有云网络组件新装',
    serviceDescription:
      '新装ER虚拟专有云网络组件，含规划设计、部署测试、报告整理、运维培训',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品实施交付',
    serviceName: '文件存储组件新装',
    serviceDescription: '新装SFS组件，含规划设计、部署测试、报告整理、运维培训',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品实施交付',
    serviceName: '自服务中心组件新装',
    serviceDescription: '新装SSC组件，含规划设计、部署测试、报告整理、运维培训',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品实施交付',
    serviceName: '榫卯 AI 平台组件新装',
    serviceDescription: '新装AI组件，含规划设计、部署测试、报告整理、运维培训',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品实施交付',
    serviceName: '其他组件新装一',
    serviceDescription: 'CloudTower、可观测性平台、V2V工具等',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品实施交付',
    serviceName: '其他组件新装二',
    serviceDescription: 'STMX CloudMove、UCS、亚信安全产品等',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品实施交付',
    serviceName: '单机虚拟化新装',
    serviceDescription: '新建虚拟化，含规划设计、部署测试、报告整理、运维培训',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品增值服务',
    serviceName: '备份与容灾组件方案梳理及规划设计',
    serviceDescription: '产品实施交付之外，与业务应用相关的方案设计、技术支持',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品增值服务',
    serviceName: 'Kubernetes 服务组件方案梳理及规划设计',
    serviceDescription:
      '产品实施交付之外，与业务应用相关的方案设计和技术支持，如使用规划、业务上线/迁移技术支持',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品增值服务',
    serviceName: 'Everoute 组件方案梳理及规划设计',
    serviceDescription:
      '产品实施交付之外，与业务应用相关的方案设计和技术支持，如策略梳理、迁移/上线方案（含分布式防火墙、LB、VPC）',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品增值服务',
    serviceName: '文件存储组件与应用系统对接技术支持',
    serviceDescription: '产品实施交付之外，与业务应用相关的方案设计、技术支持',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品增值服务',
    serviceName: '分布式存储与应用系统对接技术支持',
    serviceDescription: '对接第三方平台（比如华为云）的最佳实践',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品增值服务',
    serviceName: '自服务中心方案规划与技术支持',
    serviceDescription:
      '产品实施交付之外，自服务中心与业务应用相关的方案设计、技术支持',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品增值服务',
    serviceName: '榫卯 AI 平台方案规划与技术支持',
    serviceDescription:
      '产品实施交付之外，榫卯 AI 平台与业务应用相关的方案设计、技术支持',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品增值服务',
    serviceName: 'V2V/P2V 方案规划与技术支持',
    serviceDescription:
      '产品实施交付之外，V2V/P2V 与业务应用相关的方案设计、技术支持',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品增值服务',
    serviceName: '第三方产品对接技术支持',
    serviceDescription: 'SmartX 软件与第三方产品（比如鼎甲、爱数）对接最佳实践',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品增值服务',
    serviceName: '技术方案评估及概要设计',
    serviceDescription:
      '在项目前期阶段，进行整体技术方案的合理性及可行性评估，并进行实施方案的框架或概要设计，确保售前方案到实施落地平稳衔接',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '产品增值服务',
    serviceName: '信创验收支持',
    serviceDescription:
      '配合客户信创验收提供的解决方案或实施支持，比如安全测评、等保评级、base OS 转换等',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '运维支持或培训',
    serviceName: '基础巡检',
    serviceDescription: '基于巡检中心的自动化巡检及问题处理',
    supportedProviders: allProviders,
  },
  {
    serviceCategory: '运维支持或培训',
    serviceName: '基础巡检（服务权益）',
    serviceDescription: '基于巡检中心的自动化巡检及问题处理',
    pricingUnit: '巡检权益',
    supportedProviders: allProviders,
  },
  {
    serviceCategory: '运维支持或培训',
    serviceName: '集群升级',
    serviceDescription: '集群软件及组件版本升级',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '运维支持或培训',
    serviceName: '集群升级（服务权益）',
    serviceDescription: '集群软件及组件版本升级',
    pricingUnit: '升级权益',
    supportedProviders: allProviders,
  },
  {
    serviceCategory: '运维支持或培训',
    serviceName: '深度巡检',
    serviceDescription:
      '覆盖硬件环境、软件运行情况及健康度、业务运行情况及运维最佳实践的全面的深度检查，评估改善方案，并梳理优化',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '运维支持或培训',
    serviceName: '监控告警对接技术支持',
    serviceDescription: '对接 snmp、smtp、webhook、api 的最佳实践',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '运维支持或培训',
    serviceName: '协助运维',
    serviceDescription: '协助客户运维，比如创建监控视图、安装 cloudinit 等',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '运维支持或培训',
    serviceName: '服务汇报',
    serviceDescription:
      '梳理客户服务情况、集群及业务运行情况、运维改善建议等，输出服务报告（通常配合 TAM 进行）',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '运维支持或培训',
    serviceName: '运维培训',
    serviceDescription: '产品使用及运维培训（通常随产品实施交付一同进行）',
    supportedProviders: allProviders,
  },
  {
    serviceCategory: '运维支持或培训',
    serviceName: '高级培训',
    serviceDescription: '运维最佳实践、常见故障排错、其他针对性培训等',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '技术保障或支持',
    serviceName: '集群/节点关机保障',
    serviceDescription:
      '集群临时下线/节点临时下线（主机维护）/主机轮流关机调整（常见增加内存或网卡操作），配合客户提供技术保障',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '技术保障或支持',
    serviceName: '集群搬迁保障',
    serviceDescription: '机房/集群搬迁，配合客户提供技术保障',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '技术保障或支持',
    serviceName: '网络变更保障',
    serviceDescription: '交换机/物理链路/网络 IP 变更，配合客户提供技术保障',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '技术保障或支持',
    serviceName: '集群节点替换与数量调整',
    serviceDescription: '集群替换节点/缩节点操作',
    supportedProviders: originalProvider,
  },
  {
    serviceCategory: '技术保障或支持',
    serviceName: '测试集群售后服务支持',
    serviceDescription:
      '非正式交付的临时集群、或者有测转销计划的测试集群，提前提供售后服务支持（需要销售对项目 commit 并进行申请）',
    supportedProviders: originalProvider,
  },
];
