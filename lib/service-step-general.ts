import type { ServiceFlowStep } from './service-flow-steps';
import type { StoredFile } from './service-requests';

export function generalStepDescription(step: ServiceFlowStep) {
  return step.generalDescription ?? step.checklist.join('\n');
}
export function validateGeneralStepSubmission(
  step: ServiceFlowStep,
  description: string,
  attachments: StoredFile[],
) {
  if (step.type !== 'combined') throw new Error('此步骤不是通用类型。');
  if (typeof description !== 'string' || description.length > 60000)
    throw new Error('说明不能超过 60000 字。');
  if (step.recordRequired && !description.trim())
    throw new Error('请填写说明。');
  if (!Array.isArray(attachments)) throw new Error('附件格式无效。');
  if (step.attachmentRequired && !attachments.length)
    throw new Error('请至少上传一份附件。');
  if (
    attachments.some(
      (file) =>
        !file ||
        !(file.blob instanceof Blob) ||
        !file.blob.size ||
        file.blob.size > 20 * 1024 * 1024 ||
        file.size !== file.blob.size,
    )
  )
    throw new Error('附件须为非空文件，单个不超过 20 MB。');
  return {
    description,
    attachments: structuredClone(attachments).map((file) => ({
      ...file,
      deliverToCustomer: false as const,
    })),
    deliverToCustomer: false as const,
  };
}
