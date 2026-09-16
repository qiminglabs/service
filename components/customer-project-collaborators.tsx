import type { CustomerProjectContact, CustomerServiceProject } from '@/lib/customer-service-projects';

function CollaboratorCard({ title, people, smartx = false }: { title: string; people: CustomerProjectContact[]; smartx?: boolean }) {
  return <section className="sr-panel sr-collaboration-card" aria-label={title}>
    <div className="sr-panel-heading"><h3>{title}{!smartx && <span>{people.length}</span>}</h3></div>
    <div className={`sr-internal-body${smartx ? ' sr-smartx-contact' : ''}`}>
      {people.length ? <ul className="sr-participants">{people.map(person => <li key={person.id}>
        <span className="sr-collaborator-copy"><span className="sr-participant-name" title={person.name}>{person.name}</span>
          <small title={`${person.phone || '未填写电话'} · ${person.email || '未填写邮箱'}`}>
            {person.phone || '未填写电话'}{' · '}{person.email || '未填写邮箱'}
          </small>
        </span>
        {person.roles.length > 0 && <span className="sr-help">{person.roles.join(' · ')}</span>}
      </li>)}</ul> : <p className="sr-help">暂无{title}</p>}
    </div>
  </section>;
}
export function CustomerProjectCollaborators({ project }: { project: CustomerServiceProject }) {
  return <aside className="sr-collaboration-column" aria-label="协作人">
    <CollaboratorCard title="SmartX 联系人" people={project.smartxContacts} smartx />
    <CollaboratorCard title="客户协作人" people={project.collaborators} />
    {project.showPartnerCollaborators && <CollaboratorCard title="合作伙伴协作人" people={project.partnerCollaborators} />}
  </aside>;
}
