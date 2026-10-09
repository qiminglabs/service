import activityMessages from '../activity-messages.json' with { type: 'json' };
const reserved = new Set(Object.entries(activityMessages).filter(([, entry]) => !entry.uiLabel).map(([key]) => key));
export function isEditableTranslation(key: string): boolean { return !reserved.has(key); }
