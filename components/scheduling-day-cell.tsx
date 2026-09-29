'use client';

import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
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
  const day = slotState(snapshot, person, slot);
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
        data-state={day.state}
        aria-label={`${person.name} ${slot.date} ${day.bookings.length ? `${day.bookings.length} 个工单` : day.label}`}
      >
        {day.bookings.length ? (
          <>
            {day.bookings.slice(0, 3).map((booking) => {
              const order = describe(booking);
              return (
                <button
                  type="button"
                  className="schedule-order-line"
                  key={`${booking.projectId}:${booking.orderId}`}
                  disabled={!order.allowed}
                  onClick={() => onOpen(booking.projectId, booking.orderId)}
                  aria-label={
                    order.allowed
                      ? `查看工单概览：${order.label} · ${order.detail}`
                      : order.label
                  }
                  title={order.detail || order.label}
                >
                  {order.label}
                </button>
              );
            })}
            {day.bookings.length > 3 && (
              <Popover>
                <PopoverTrigger
                  className="schedule-orders-more"
                  aria-label={`${person.name} ${slot.date} 查看全部 ${day.bookings.length} 个工单`}
                >
                  另有 {day.bookings.length - 3} 个
                </PopoverTrigger>
                <PopoverContent
                  className="schedule-orders-popover"
                  align="start"
                >
                  <PopoverTitle>
                    {person.name} · {slot.date}
                  </PopoverTitle>
                  <div
                    className="schedule-orders-list"
                    tabIndex={0}
                    aria-label={`全部 ${day.bookings.length} 个工单`}
                  >
                    {day.bookings.map((booking) => {
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
                          title={order.detail || order.label}
                        >
                          <strong>{order.label}</strong>
                          {order.detail && <small>{order.detail}</small>}
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </>
        ) : (
          <span>{day.label}</span>
        )}
      </div>
    </td>
  );
}
