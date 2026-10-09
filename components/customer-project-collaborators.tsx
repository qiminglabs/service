
import { useI18n } from '@/lib/i18n/context';
import type { CustomerProjectContact, CustomerServiceProject } from '@/lib/customer-service-projects';

function CollaboratorCard({ title, people, internal = false }: { title: string; people: CustomerProjectContact[]; internal?: boolean }) {
  const { localize } = useI18n();
  return <section className="sr-panel sr-collaboration-card" aria-label={localize(title)}>
    <div className="sr-panel-heading"><h3>{localize(title)}<span>{localize(people.length)}</span></h3></div>
    <div className="sr-internal-body">
      {localize(people.length ? <ul className="sr-participants">{localize(people.map(person => <li key={person.id}>
        <span className="sr-collaborator-copy"><span className="sr-participant-name" title={localize(person.name)}>{localize(person.name)}</span>
          <small title={localize(internal ? person.email : [person.phone, person.email].filter(Boolean).join(' · '))}>
            {localize(internal ? person.email : [person.phone, person.email].filter(Boolean).join(' · '))}
          </small>
        </span>
        {localize(person.roles.length > 0 && <span className="sr-help">{localize(person.roles.join(' · '))}</span>)}
      </li>))}</ul> : <p className="sr-help">{localize("暂无")}{localize(title)}</p>)}
    </div>
  </section>;
}
export function CustomerProjectCollaborators({ project }: { project: CustomerServiceProject }) {
  const { localize } = useI18n();
  return <aside className="sr-collaboration-column" aria-label={localize("协作人")}>
    <CollaboratorCard title={localize("客户协作人")} people={project.collaborators} />
    <CollaboratorCard title={localize("SmartX 协作人")} people={project.internalCollaborators} internal />
    {localize(project.showPartnerCollaborators && <CollaboratorCard title={localize("合作伙伴协作人")} people={project.partnerCollaborators} />)}
  </aside>;
}
