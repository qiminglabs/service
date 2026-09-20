import type { ConfirmationMail } from '@/lib/project-confirmation-notice';
import { dailyReportProjectUrl } from '@/lib/service-project-daily-reports';
export function ConfirmationMailNotice({
  confirmation,
  projectId,
}: {
  confirmation: ConfirmationMail;
  projectId: string;
}) {
  return (
    <section className="confirmation-mail-notice">
      <h4>客户确认</h4>
      <p className="whitespace-pre-wrap">{confirmation.notice}</p>
      <a
        className="confirmation-mail-button"
        href={dailyReportProjectUrl(projectId)}
        target="_blank"
        rel="noopener noreferrer"
      >
        去确认
      </a>
    </section>
  );
}
