'use client';
import { useI18n } from '@/lib/i18n/context';


import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  calendarState,
  slotState,
  type Booking,
  type Resource,
  type ScheduleSnapshot,
  type Slot,
} from '@/lib/scheduling';
import { canViewServiceProject } from '@/lib/service-projects';
import type { OperationActor } from '@/lib/request-operations';
import type { CustomerRef } from '@/lib/service-requests';

export function SchedulingDayCell({
  snapshot,
  person,
  slot,
  actor,
  customers,
  onOpen,
}: {
  snapshot: ScheduleSnapshot;
  person: Resource;
  slot: Slot;
  actor: OperationActor;
  customers: CustomerRef[];
  onOpen: (projectId: string, orderId: string) => void;
}) {
  const { localize, localizeList, localizeMessage } = useI18n();
  const day = slotState(snapshot, person, slot);
  const conflict =
    day.bookings.length > 0 &&
    calendarState(snapshot.data, person, slot).state === 'unavailable';
  const describe = (booking: Booking) => {
    const project = snapshot.projects.find(
      (project) => project.id === booking.projectId,
    );
    const order = project?.workOrders?.find(
      (order) => order.id === booking.orderId,
    );
    const allowed = !!project && canViewServiceProject(actor, project);
    const label = allowed
      ? customers.find((customer) => customer.id === project.customerId)
          ?.name || '客户信息缺失'
      : '其他项目占用';
    const detail = allowed
      ? `工单：${order?.item.serviceName || booking.orderId}；项目：${project.name}；日期：${booking.start} 至 ${booking.end}`
      : '';
    return { allowed, label, detail };
  };
  return (
    <td>
      <div
        className="schedule-slot"
        data-state={conflict ? 'conflict' : day.state}
        aria-label={localizeMessage("{0} {1} {2}{3}", [localize(person.name), localize(slot.date), localize(day.bookings.length ? localizeMessage("{0} 个工单", [String(localize(day.bookings.length))]) : day.label), localize(conflict ? '，排期冲突' : '')])}
      >
        {localize(day.exceptions.length > 0 && (
          <small className="schedule-personal-note">
            {localize(localizeList(day.exceptions.map((entry) => entry.kind), '、'))}
            {localize(conflict ? ' · 排期冲突' : '')}
          </small>
        ))}
        {localize(day.bookings.length ? (
          <>
            {localize(day.bookings.slice(0, 3).map((booking) => {
              const order = describe(booking);
              return (
                <button
                  type="button"
                  className="schedule-order-line"
                  key={`${booking.projectId}:${booking.orderId}`}
                  disabled={!order.allowed}
                  onClick={() => onOpen(booking.projectId, booking.orderId)}
                  aria-label={
                    localize(order.allowed
                      ? localizeMessage("查看工单概览：{0} · {1}", [String(localize(order.label)), String(localize(order.detail))])
                      : order.label)
                  }
                  title={localize(order.detail || order.label)}
                >
                  {localize(order.label)}
                </button>
              );
            }))}
            {localize(day.bookings.length > 3 && (
              <Popover>
                <PopoverTrigger
                  className="schedule-orders-more"
                  aria-label={localizeMessage("{0} {1} 查看全部 {2} 个工单", [localize(person.name), localize(slot.date), localize(day.bookings.length)])}
                >
                  {localize("另有")}{localize(day.bookings.length - 3)} {localize(" 个")}</PopoverTrigger>
                <PopoverContent
                  className="schedule-orders-popover"
                  align="start"
                >
                  <PopoverTitle>
                    {localize(person.name)} · {localize(slot.date)}
                  </PopoverTitle>
                  <div
                    className="schedule-orders-list"
                    aria-label={localizeMessage("全部 {0} 个工单", [localize(day.bookings.length)])}
                  >
                    {localize(day.bookings.map((booking) => {
                      const order = describe(booking);
                      return (
                        <button
                          type="button"
                          className="schedule-order-detail"
                          key={`${booking.projectId}:${booking.orderId}`}
                          disabled={!order.allowed}
                          onClick={() =>
                            onOpen(booking.projectId, booking.orderId)
                          }
                          title={localize(order.detail || order.label)}
                        >
                          <strong>{localize(order.label)}</strong>
                          {localize(order.detail && <small>{localize(order.detail)}</small>)}
                        </button>
                      );
                    }))}
                  </div>
                </PopoverContent>
              </Popover>
            ))}
          </>
        ) : (
          <span>{localize(day.label)}</span>
        ))}
      </div>
    </td>
  );
}
