import type { ServiceFlow } from './service-flows';
import { orderedServiceSteps } from './service-flow-steps.ts';

export type ServiceFlowPhase = { id: string; name: string };
export function serviceFlowGroups(flow: ServiceFlow) {
  const current = flow;
  const steps = orderedServiceSteps(current.steps);
  return [
    ...(current.phases ?? []).map((phase) => ({
      ...phase,
      steps: steps.filter((step) => step.phaseId === phase.id),
    })),
    { id: '', name: '未分组', steps: steps.filter((step) => !step.phaseId) },
  ];
}
export function arrangeServiceFlow(flow: ServiceFlow): ServiceFlow {
  const current = flow;
  return {
    ...current,
    steps: serviceFlowGroups(current)
      .flatMap((group) =>
        group.steps.map((step) => ({
          ...step,
          phase: group.id ? group.name : '',
        })),
      )
      .map((step, index) => ({ ...step, sequence: index + 1 })),
  };
}
export function assignServiceStepPhase(
  flow: ServiceFlow,
  stepId: string,
  phaseId: string,
) {
  const current = flow;
  if (phaseId && !(current.phases ?? []).some((phase) => phase.id === phaseId))
    throw new Error('阶段不存在。');
  return arrangeServiceFlow({
    ...current,
    steps: current.steps.map((step) =>
      step.id === stepId
        ? { ...step, phaseId, sequence: current.steps.length + 1 }
        : step,
    ),
  });
}
export function removeServiceFlowPhase(flow: ServiceFlow, phaseId: string) {
  const current = flow;
  return arrangeServiceFlow({
    ...current,
    phases: (current.phases ?? []).filter((phase) => phase.id !== phaseId),
    steps: current.steps.map((step) =>
      step.phaseId === phaseId ? { ...step, phaseId: '', phase: '' } : step,
    ),
  });
}
export function validateServiceFlowPhases(flow: ServiceFlow) {
  if (flow.phases === undefined) {
    if (flow.steps.some((step) => step.phaseId))
      throw new Error('步骤引用的阶段不存在。');
    return;
  }
  if (
    !Array.isArray(flow.phases) ||
    flow.phases.length > 100 ||
    flow.phases.some(
      (phase) =>
        !phase ||
        typeof phase.id !== 'string' ||
        !phase.id.trim() ||
        phase.id.length > 120 ||
        typeof phase.name !== 'string' ||
        !phase.name.trim() ||
        phase.name.length > 120,
    ) ||
    new Set(flow.phases.map((phase) => phase.id)).size !== flow.phases.length ||
    new Set(flow.phases.map((phase) => phase.name.trim())).size !==
      flow.phases.length
  )
    throw new Error('阶段需填写不重复的名称，最多 100 个阶段。');
  for (const step of flow.steps) {
    if (step.phaseId !== undefined && typeof step.phaseId !== 'string')
      throw new Error('步骤阶段格式无效。');
    if (step.phaseId && !flow.phases.some((phase) => phase.id === step.phaseId))
      throw new Error('步骤引用的阶段不存在。');
  }
  flow.phases = flow.phases.map((phase) => ({
    ...phase,
    name: phase.name.trim(),
  }));
  // Keep execution order and exported phase labels identical to the canvas groups.
  flow.steps = arrangeServiceFlow(flow).steps;
}
