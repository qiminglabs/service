'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarCheck, CalendarDays, ChevronLeft, ChevronRight, ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/date-field';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { personalSchedulingTransaction } from '@/lib/scheduling-store';
import {
  moveScheduleViewDate,
  scheduleToday,
  scheduleViewWindow,
  slotState,
  workOrderBookings,
  type PersonalScheduleSnapshot,
} from '@/lib/scheduling';
import type { OperationActor } from '@/lib/request-operations';
import type { CustomerRef } from '@/lib/service-requests';

type Props = {
  actor: OperationActor;
  customers: CustomerRef[];
  onOpen: (projectId: string, orderId: string) => void;
};

const calendarWeekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const weekdayLabel = (date: string) =>
  ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][
    new Date(`${date}T00:00:00Z`).getUTCDay()
  ];
const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : '服务日历读取失败。';

export function ServiceCalendar({ actor, customers, onOpen }: Props) {
  const [snapshot, setSnapshot] = useState<PersonalScheduleSnapshot>();
  const [error, setError] = useState('');
  const [anchor, setAnchor] = useState(scheduleToday);
  const mounted = useRef(false);
  const actorId = actor.id;
  const actorRole = actor.role;
  const actorName = actor.name;
  const load = useCallback(async () => {
    try {
      const result = await personalSchedulingTransaction({
        id: actorId,
        role: actorRole,
        name: actorName,
      });
      if (mounted.current) {
        setSnapshot(result);
        setError('');
      }
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
    }
  }, [actorId, actorRole, actorName]);

  useEffect(() => {
    mounted.current = true;
    const initialLoad = window.setTimeout(() => void load(), 0);
    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel('resource-scheduling')
        : null;
    if (channel) channel.onmessage = () => void load();
    window.addEventListener('focus', load);
    return () => {
      mounted.current = false;
      window.clearTimeout(initialLoad);
      channel?.close();
      window.removeEventListener('focus', load);
    };
  }, [load]);

  const { start, end, dates } = useMemo(
    () => scheduleViewWindow(anchor, 'month'),
    [anchor],
  );
  const person = snapshot?.resources[0];
  const dayStates = snapshot && person
    ? dates.map((date) => slotState(snapshot, person, { date }))
    : [];
  const scheduledDays = dayStates.filter((state) => state.state === 'occupied').length;
  const availableDays = dayStates.filter((state) => state.state === 'available').length;
  const scheduledOrders = snapshot
    ? new Set(
        workOrderBookings(snapshot)
          .filter((booking) => booking.start <= end && booking.end >= start)
          .map((booking) => `${booking.projectId}:${booking.orderId}`),
      ).size
    : 0;
  const leadingDays =
    (new Date(`${dates[0]}T00:00:00Z`).getUTCDay() + 6) % 7;

  return (
    <div className="schedule-workbench service-calendar">
      {error && <p className="sr-error" role="alert">{error}</p>}
      <div className="schedule-main">
        <div className="schedule-summary">
          <div>
            <ClipboardList size={19} />
            <span>所选月排期工单<strong>{scheduledOrders}<small>张</small></strong></span>
          </div>
          <div>
            <CalendarCheck size={19} />
            <span>所选月已排日程<strong>{scheduledDays}<small>天</small></strong></span>
          </div>
          <div>
            <CalendarDays size={19} />
            <span>所选月可用日程<strong>{availableDays}<small>天</small></strong></span>
          </div>
        </div>
        <section className="schedule-board" aria-label="个人服务日历">
          <div className="schedule-toolbar">
            <div className="schedule-period">
              <Button
                variant="outline"
                size="icon"
                aria-label="上一月"
                onClick={() => setAnchor(moveScheduleViewDate(anchor, 'month', -1))}
              >
                <ChevronLeft />
              </Button>
              <DateField
                label="查看月份"
                hideLabel
                value={start}
                onChange={(date) => date && setAnchor(date)}
              />
              <span className="schedule-period-end">至 {end}</span>
              <Button
                variant="outline"
                size="icon"
                aria-label="下一月"
                onClick={() => setAnchor(moveScheduleViewDate(anchor, 'month', 1))}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
          <div className="schedule-legend">
            <span><i data-state="available" />可用</span>
            <span><i data-state="occupied" />有排班</span>
            <span><i data-state="unavailable" />不可用</span>
          </div>
          <div className="service-calendar-body">
            <div className="service-calendar-weekdays" aria-hidden="true">
              {calendarWeekdays.map((day) => <span key={day}>{day}</span>)}
            </div>
            {snapshot && person ? (
              <div className="service-calendar-grid" aria-label={`${start} 至 ${end}的个人排期`}>
                {Array.from({ length: leadingDays }, (_, index) => (
                  <span className="service-calendar-blank" aria-hidden="true" key={`blank:${index}`} />
                ))}
                {dates.map((date, index) => {
                  const state = dayStates[index];
                  const orders = state.bookings.map((booking) => {
                    const project = snapshot.projects.find((item) => item.id === booking.projectId);
                    const order = project?.workOrders?.find((item) => item.id === booking.orderId);
                    return {
                      key: `${booking.projectId}:${booking.orderId}`,
                      projectId: booking.projectId,
                      orderId: booking.orderId,
                      label: customers.find((customer) => customer.id === project?.customerId)?.name || '客户信息缺失',
                      detail: `工单：${order?.item.serviceName || booking.orderId}；项目：${project?.name ?? ''}`,
                    };
                  });
                  const visibleCount = 2;
                  return (
                    <article
                      className="service-calendar-day"
                      data-state={state.state}
                      data-today={date === scheduleToday() || undefined}
                      key={date}
                      aria-label={`${date} ${orders.length ? `${orders.length} 个工单` : state.label}`}
                    >
                      <header>
                        <strong>{date.slice(8)}</strong>
                        <span>{weekdayLabel(date)}</span>
                        <small>{orders.length ? `${orders.length} 张工单` : state.label}</small>
                      </header>
                      <div className="service-calendar-orders">
                        {orders.slice(0, visibleCount).map((order) => (
                          <button
                            type="button"
                            className="service-calendar-order"
                            key={order.key}
                            title={order.detail}
                            aria-label={`查看工单概览：${order.label} · ${order.detail}`}
                            onClick={() => onOpen(order.projectId, order.orderId)}
                          >
                            <strong>{order.label}</strong>
                          </button>
                        ))}
                        {orders.length > visibleCount && (
                          <Popover>
                            <PopoverTrigger className="service-calendar-more" aria-label={`${date} 查看全部 ${orders.length} 个工单`}>
                              另有 {orders.length - visibleCount} 个
                            </PopoverTrigger>
                            <PopoverContent className="schedule-orders-popover" align="start">
                              <PopoverTitle>{person.name} · {date}</PopoverTitle>
                              <div className="schedule-orders-list">
                                {orders.map((order) => (
                                  <button
                                    type="button"
                                    className="schedule-order-detail"
                                    title={order.detail}
                                    aria-label={`查看工单概览：${order.label} · ${order.detail}`}
                                    key={order.key}
                                    onClick={() => onOpen(order.projectId, order.orderId)}
                                  >
                                    <strong>{order.label}</strong><small>{order.detail}</small>
                                  </button>
                                ))}
                              </div>
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="schedule-empty">
                {error ? '无法读取服务日历' : '正在读取服务日历…'}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
