/**
 * @file src/data/shape-labels.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The labels of the spaces and fields the node's own workspace shapes make, in the three
 *   languages the node ships, written into each workspace's `manifest.i18n` (space labels at
 *   "type.<name>", field labels at "<namespace>.<field>"). The workspace page already reads that block
 *   for the reader's language (public/views/profile/organisms/workspace.js wsT; the summary under the
 *   workspace's title at "summary"), the way a workspace
 *   an AI generated carries it; a shaped workspace carried none, so every reader saw the raw
 *   identifiers (page, decision, title, why).
 * @structure SPACE_LABELS · FIELD_LABELS · manifestI18n
 * @usage const i18n = manifestI18n(shape.workspaces[0].spaces);
 * @version-history
 *   v1.2.0 — 2026-11-14 — The spaces, fields and choices the team types add (ai-use, incident, requirement,
 *     change-request, campaign, ticket, minutes; purpose, provider, risk; minimal, limited, high).
 *   v1.1.0 — 2026-11-14 — VALUE_LABELS: a field's choices (its enum) at "<namespace>.<field>.<value>",
 *     which the form's options and the record view show in the reader's language.
 *   v1.0.0 — 2026-11-14 — Initial (team setup T24: a workspace reads in its reader's language).
 */
type L = { en: string; fi: string; es: string };

export const SPACE_LABELS: Record<string, L> = {
    page: { en: 'Pages', fi: 'Sivut', es: 'Páginas' },
    decision: { en: 'Decisions', fi: 'Päätökset', es: 'Decisiones' },
    goal: { en: 'Goals', fi: 'Tavoitteet', es: 'Objetivos' },
    plan: { en: 'Plans', fi: 'Suunnitelmat', es: 'Planes' },
    deliverable: { en: 'Deliverables', fi: 'Tuotokset', es: 'Entregables' },
    resource: { en: 'Resources', fi: 'Resurssit', es: 'Recursos' },
    customer: { en: 'Customers', fi: 'Asiakkaat', es: 'Clientes' },
    task: { en: 'Tasks', fi: 'Tehtävät', es: 'Tareas' },
    event: { en: 'Events', fi: 'Tapahtumat', es: 'Eventos' },
    item: { en: 'Open matters', fi: 'Avoimet asiat', es: 'Asuntos abiertos' },
    context: { en: 'Team context', fi: 'Tiimin konteksti', es: 'Contexto del equipo' },
    waiting: { en: 'Waiting for a person', fi: 'Odottaa ihmistä', es: 'Pendiente de una persona' },
    'ai-use': { en: 'AI uses', fi: 'Tekoälyn käytöt', es: 'Usos de la IA' },
    incident: { en: 'Incidents', fi: 'Häiriöt', es: 'Incidencias' },
    requirement: { en: 'Requirements', fi: 'Vaatimukset', es: 'Requisitos' },
    'change-request': { en: 'Change requests', fi: 'Muutospyynnöt', es: 'Solicitudes de cambio' },
    campaign: { en: 'Campaigns', fi: 'Kampanjat', es: 'Campañas' },
    ticket: { en: 'Tickets', fi: 'Tiketit', es: 'Tickets' },
    minutes: { en: 'Minutes', fi: 'Pöytäkirjat', es: 'Actas' },
};

export const FIELD_LABELS: Record<string, L> = {
    id: { en: 'ID', fi: 'Tunniste', es: 'ID' },
    title: { en: 'Title', fi: 'Otsikko', es: 'Título' },
    name: { en: 'Name', fi: 'Nimi', es: 'Nombre' },
    decision: { en: 'Decision', fi: 'Päätös', es: 'Decisión' },
    why: { en: 'Why', fi: 'Miksi', es: 'Por qué' },
    date: { en: 'Date', fi: 'Päivämäärä', es: 'Fecha' },
    by: { en: 'By', fi: 'Kuka', es: 'Quién' },
    who: { en: 'Who', fi: 'Kuka', es: 'Quién' },
    for: { en: 'For', fi: 'Kenelle', es: 'Para' },
    owner: { en: 'Owner', fi: 'Vastuuhenkilö', es: 'Responsable' },
    contact: { en: 'Contact', fi: 'Yhteystieto', es: 'Contacto' },
    status: { en: 'Status', fi: 'Tila', es: 'Estado' },
    notes: { en: 'Notes', fi: 'Muistiinpanot', es: 'Notas' },
    detail: { en: 'Detail', fi: 'Tarkemmin', es: 'Detalle' },
    due: { en: 'Due', fi: 'Määräaika', es: 'Fecha límite' },
    done: { en: 'Done', fi: 'Valmis', es: 'Hecho' },
    place: { en: 'Place', fi: 'Paikka', es: 'Lugar' },
    kind: { en: 'Kind', fi: 'Laji', es: 'Tipo' },
    summary: { en: 'Summary', fi: 'Tiivistelmä', es: 'Resumen' },
    core: { en: 'Context', fi: 'Konteksti', es: 'Contexto' },
    description: { en: 'Description', fi: 'Kuvaus', es: 'Descripción' },
    approach: { en: 'Approach', fi: 'Lähestymistapa', es: 'Enfoque' },
    version: { en: 'Version', fi: 'Versio', es: 'Versión' },
    steps: { en: 'Steps', fi: 'Vaiheet', es: 'Pasos' },
    acceptanceCriteria: { en: 'Acceptance criteria', fi: 'Hyväksymisehdot', es: 'Criterios de aceptación' },
    definitionOfDone: { en: 'Definition of done', fi: 'Valmiin määritelmä', es: 'Definición de terminado' },
    gateId: { en: 'Approval gate', fi: 'Hyväksyntäportti', es: 'Puerta de aprobación' },
    ts: { en: 'Time', fi: 'Aika', es: 'Hora' },
    label: { en: 'Label', fi: 'Nimike', es: 'Etiqueta' },
    origin: { en: 'Origin', fi: 'Alkuperä', es: 'Origen' },
    pointer: { en: 'Location', fi: 'Sijainti', es: 'Ubicación' },
    visibility: { en: 'Visibility', fi: 'Näkyvyys', es: 'Visibilidad' },
    purpose: { en: 'Purpose', fi: 'Tarkoitus', es: 'Finalidad' },
    provider: { en: 'Provider', fi: 'Toimittaja', es: 'Proveedor' },
    risk: { en: 'Risk class', fi: 'Riskiluokka', es: 'Clase de riesgo' },
};

/** The choices of the shapes' fields (their schema `enum`), shown at "<namespace>.<field>.<value>". */
export const VALUE_LABELS: Record<string, L> = {
    open: { en: 'Open', fi: 'Auki', es: 'Abierto' },
    done: { en: 'Done', fi: 'Valmis', es: 'Hecho' },
    met: { en: 'Met', fi: 'Saavutettu', es: 'Cumplido' },
    dropped: { en: 'Dropped', fi: 'Hylätty', es: 'Descartado' },
    proposed: { en: 'Proposed', fi: 'Ehdotettu', es: 'Propuesto' },
    approved: { en: 'Approved', fi: 'Hyväksytty', es: 'Aprobado' },
    superseded: { en: 'Superseded', fi: 'Korvattu', es: 'Sustituido' },
    in_progress: { en: 'In progress', fi: 'Työn alla', es: 'En curso' },
    delivered: { en: 'Delivered', fi: 'Toimitettu', es: 'Entregado' },
    accepted: { en: 'Accepted', fi: 'Hyväksytty', es: 'Aceptado' },
    rejected: { en: 'Rejected', fi: 'Hylätty', es: 'Rechazado' },
    decision: { en: 'Decision', fi: 'Päätös', es: 'Decisión' },
    'plan-change': { en: 'Plan change', fi: 'Suunnitelman muutos', es: 'Cambio de plan' },
    deliverable: { en: 'Deliverable', fi: 'Tuotos', es: 'Entregable' },
    rating: { en: 'Rating', fi: 'Arvio', es: 'Valoración' },
    doc: { en: 'Document', fi: 'Dokumentti', es: 'Documento' },
    code: { en: 'Code', fi: 'Koodi', es: 'Código' },
    asset: { en: 'Asset', fi: 'Aineisto', es: 'Recurso' },
    knowledge: { en: 'Knowledge', fi: 'Tieto', es: 'Conocimiento' },
    link: { en: 'Link', fi: 'Linkki', es: 'Enlace' },
    local: { en: 'Here', fi: 'Täällä', es: 'Aquí' },
    referenced: { en: 'Referenced', fi: 'Viitattu', es: 'Referenciado' },
    private: { en: 'Private', fi: 'Yksityinen', es: 'Privado' },
    owner: { en: 'Owner only', fi: 'Vain omistaja', es: 'Solo el propietario' },
    group: { en: 'Group', fi: 'Ryhmä', es: 'Grupo' },
    public: { en: 'Public', fi: 'Julkinen', es: 'Público' },
    send: { en: 'Send', fi: 'Lähetys', es: 'Envío' },
    pay: { en: 'Payment', fi: 'Maksu', es: 'Pago' },
    delete: { en: 'Delete', fi: 'Poisto', es: 'Borrado' },
    approve: { en: 'Approval', fi: 'Hyväksyntä', es: 'Aprobación' },
    'skill-change': { en: 'Change to the team skill', fi: 'Muutos tiimiskilliin', es: 'Cambio en la skill del equipo' },
    other: { en: 'Other', fi: 'Muu', es: 'Otro' },
    minimal: { en: 'Minimal', fi: 'Vähäinen', es: 'Mínimo' },
    limited: { en: 'Limited', fi: 'Rajoitettu', es: 'Limitado' },
    high: { en: 'High', fi: 'Suuri', es: 'Alto' },
};

/** The `manifest.i18n` block for a workspace: its summary ("summary"), every space, every labelled
 *  field and every labelled choice of a field, in en, fi and es. */
export function manifestI18n(spaces: readonly { name: string; namespace: string; schema?: Record<string, unknown> }[], summary?: L): Record<'en' | 'fi' | 'es', Record<string, string>> {
    const out: Record<'en' | 'fi' | 'es', Record<string, string>> = { en: {}, fi: {}, es: {} };
    if (summary) for (const lang of ['en', 'fi', 'es'] as const) out[lang].summary = summary[lang];
    for (const s of spaces) {
        const label = SPACE_LABELS[s.name];
        if (label) for (const lang of ['en', 'fi', 'es'] as const) out[lang][`type.${s.name}`] = label[lang];
        const props = (s.schema?.properties ?? {}) as Record<string, unknown>;
        for (const [field, def] of Object.entries(props)) {
            const f = FIELD_LABELS[field];
            if (f) for (const lang of ['en', 'fi', 'es'] as const) out[lang][`${s.namespace}.${field}`] = f[lang];
            const choices = (def && typeof def === 'object' && Array.isArray((def as { enum?: unknown }).enum)) ? (def as { enum: unknown[] }).enum : [];
            for (const value of choices) {
                const v = typeof value === 'string' ? VALUE_LABELS[value] : undefined;
                if (v) for (const lang of ['en', 'fi', 'es'] as const) out[lang][`${s.namespace}.${field}.${value}`] = v[lang];
            }
        }
    }
    return out;
}
