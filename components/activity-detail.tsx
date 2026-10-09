'use client';
import { useI18n } from '@/lib/i18n/context';
import type { ActivityEvent } from '@/lib/activity-events';
import { translateActivityDetail, translateActivityTitle } from '@/lib/i18n/activity';

export function ActivityDetail({ activity }: { activity: { title: string; detail: string; event?: ActivityEvent } }) {
  const { locale, labels } = useI18n();
  return translateActivityDetail(activity, locale, labels);
}

export function ActivityTitle({ activity }: { activity: { title: string; detail: string; event?: ActivityEvent } }) {
  const { locale, labels } = useI18n();
  return translateActivityTitle(activity, locale, labels);
}
