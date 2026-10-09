import type { MaterialRequirement } from '../service-requests';
import { materialRequiredFor } from '../material-requirements.ts';
import { requestTypes } from '../request-types.ts';
import { translate, translateList, translateMessage, type Locale } from './translate.ts';

export function translateMaterialRequirement(material: MaterialRequirement, locale: Locale, labels: Record<string, string> = {}): string {
  const types = requestTypes.filter(type => materialRequiredFor(material, type));
  return types.length
    ? translateMessage('{0}必须上传', [translateList(types, locale, labels)], locale, labels)
    : translate('选填', locale, labels);
}
