import type { CustomerProjectContact, CustomerServiceProject } from '@/lib/customer-service-projects';

function CollaboratorCard({ title, people, internal = false }: { title: string; people: CustomerProjectContact[]; internal?: boolean }) {
  return <section className="sr-panel sr-collaboration-card" aria-label={title}>
    <div className="sr-panel-heading"><h3>{title}<span>{people.length}</span></h3></div>
    <div className="sr-internal-body">
      {people.length ? <ul className="sr-participants">{people.map(person => <li key={person.id}>
        <span className="sr-collaborator-copy"><span className="sr-participant-name" title={person.name}>{person.name}</span>
          <small title={internal ? person.email : [person.phone, person.email].filter(Boolean).join(' · ')}>
            {internal ? person.email : [person.phone, person.email].filter(Boolean).join(' · ')}
          </small>
        </span>
        {person.roles.length > 0 && <span className="sr-help">{person.roles.join(' · ')}</span>}
      </li>)}</ul> : <p className="sr-help">暂无{title}</p>}
    </div>
  </section>;
}
export function CustomerProjectCollaborators({ project }: { project: CustomerServiceProject }) {
  return <aside className="sr-collaboration-column" aria-label="协作人">
    <CollaboratorCard title="客户协作人" people={project.collaborators} />
    <CollaboratorCard title="SmartX 协作人" people={project.internalCollaborators} internal />
    {project.showPartnerCollaborators && <CollaboratorCard title="合作伙伴协作人" people={project.partnerCollaborators} />}
  </aside>;
}
