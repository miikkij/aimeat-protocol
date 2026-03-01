# Phase 2.3: Collaborative workspaces — Implementointisuunnitelma

*Osa Phase 2 "Markkinapaikka + yhteisötyökalut" -kokonaisuutta. Ks. [Phase 2 yleiskatsaus](./phase-2-marketplace-community.md)*

---

## 2.3 Collaborative workspaces

> Lähde: masterplan (§2.3)

### 2.3.1 Tavoite

Rakentaa jaetut työtilat organismeille: yhteinen memory-namespace jossa jäsenet ja AI-agentit voivat lukea, kirjoittaa ja organisoida dataa yhdessä. Workspace on organismin "jaettu muisti" — kuin yhteinen tiedostojärjestelmä johon kaikki jäsenet pääsevät.

### 2.3.2 Arkkitehtuuri

**Memory-namespace:** `organism.{id}.shared.*`

Organismin workspace koostuu:
1. **Shared memory** — `organism.{id}.shared.*` avaimet, jokaisen jäsenen luettavissa/kirjoitettavissa
2. **Organismin metadata** — `organism.{id}.meta.*` (vain adminit kirjoittavat)
3. **Jäsenten workspace-profiilit** — `organism.{id}.member.{owner}.*` (jäsen kirjoittaa, kaikki lukevat)

**Pääsynhallinta:**

| Namespace | Luku | Kirjoitus |
|---|---|---|
| `organism.{id}.shared.*` | Kaikki jäsenet + organismin agentit | Kaikki jäsenet + organismin agentit |
| `organism.{id}.meta.*` | Kaikki jäsenet | Vain adminit |
| `organism.{id}.member.{owner}.*` | Kaikki jäsenet | Vain kyseinen jäsen |

### 2.3.3 Workspace-middleware

**Tiedosto:** `src/middleware/workspace-access.ts`

```typescript
export function requireWorkspaceMembership(storage: Storage): RequestHandler {
  return async (req, res, next) => {
    const key = req.params.key as string;
    const match = key.match(/^organism\.([^.]+)\./);
    if (!match) return next(); // Ei workspace-avain

    const organismId = match[1];
    const ownerName = req.auth?.owner;
    if (!ownerName) return res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Authentication required'));

    const membership = await storage.getMembership(organismId, ownerFromGhii(ownerName));
    if (!membership || membership.status !== 'active') {
      return res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not a member of this organism'));
    }

    // Meta-namespace: vain adminit kirjoittavat
    if (key.startsWith(`organism.${organismId}.meta.`) && req.method !== 'GET') {
      if (membership.role !== 'admin' && membership.role !== 'creator') {
        return res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Admin access required'));
      }
    }

    // Member-namespace: vain oma jäsen kirjoittaa
    const memberMatch = key.match(/^organism\.[^.]+\.member\.([^.]+)\./);
    if (memberMatch && req.method !== 'GET') {
      if (memberMatch[1] !== ownerName) {
        return res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Cannot write to another member workspace'));
      }
    }

    next();
  };
}
```

### 2.3.4 AI-agentit workspacessa

Organismi voi lisätä AI-agentteja (`agentGaiis`-lista). Nämä agentit:
- Voivat lukea workspace-dataa (organism.{id}.shared.*)
- Voivat kirjoittaa workspace-dataa (consent-ohjattu)
- Suorittavat työtä organismin puolesta (work queue)
- Esim. "Lintukerho-botti" joka kerää havaintodataa ja päivittää yhteenvetoja

**Consent-integraatio:**
- Organismin admin myöntää consent: `dataPattern: "organism.{id}.shared.**"`, `recipient: "{agent-gaii}"`, `purpose: "workspace-agent"`
- Agentin pääsy perutaan poistamalla consent

### 2.3.5 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Jäsen kirjoittaa organism.X.shared.notes | 200, tallennettu |
| 2 | Ei-jäsen kirjoittaa organism.X.shared.notes | 403 |
| 3 | Jäsen lukee organism.X.shared.notes | 200, data palautettu |
| 4 | Jäsen kirjoittaa organism.X.meta.config | 403 (ei admin) |
| 5 | Admin kirjoittaa organism.X.meta.config | 200 |
| 6 | Jäsen kirjoittaa toisen member-namespaceen | 403 |
| 7 | Jäsen kirjoittaa omaan member-namespaceen | 200 |
| 8 | AI-agentti lukee workspacea (consent) | 200 |
| 9 | AI-agentti lukee workspacea (ei consentia) | 403 |
| 10 | Poistettu jäsen ei pääse workspaceen | 403 |

### 2.3.6 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/middleware/workspace-access.ts` — Workspace-pääsynhallinta |
| **Muokataan** | `src/routes/memory.ts` — Workspace-middleware integraatio |
| **Muokataan** | `src/routes/organisms.ts` — Agent-lisäys/poisto endpointit |
| **Muokataan** | `openapi.yaml` — Workspace-avainten dokumentointi |

---

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
