/**
 * @file src/data/shape-labels.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The labels of the spaces and fields the node's own workspace shapes make, in the three
 *   languages the node ships, written into each workspace's `manifest.i18n` (space labels at
 *   "type.<name>", field labels at "<namespace>.<field>"). The workspace page already reads that block
 *   for the reader's language (public/views/profile/organisms/workspace.js wsT), the way a workspace
 *   an AI generated carries it; a shaped workspace carried none, so every reader saw the raw
 *   identifiers (page, decision, title, why).
 * @structure SPACE_LABELS · FIELD_LABELS · manifestI18n
 * @usage const i18n = manifestI18n(shape.workspaces[0].spaces);
 * @version-history
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
};

/** The `manifest.i18n` block for a workspace's spaces: every space and every labelled field, in en, fi and es. */
export function manifestI18n(spaces: readonly { name: string; namespace: string; schema?: Record<string, unknown> }[]): Record<'en' | 'fi' | 'es', Record<string, string>> {
    const out: Record<'en' | 'fi' | 'es', Record<string, string>> = { en: {}, fi: {}, es: {} };
    for (const s of spaces) {
        const label = SPACE_LABELS[s.name];
        if (label) for (const lang of ['en', 'fi', 'es'] as const) out[lang][`type.${s.name}`] = label[lang];
        const props = (s.schema?.properties ?? {}) as Record<string, unknown>;
        for (const field of Object.keys(props)) {
            const f = FIELD_LABELS[field];
            if (f) for (const lang of ['en', 'fi', 'es'] as const) out[lang][`${s.namespace}.${field}`] = f[lang];
        }
    }
    return out;
}
