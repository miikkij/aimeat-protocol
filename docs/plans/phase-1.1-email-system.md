# Phase 1.1: Email-järjestelmä — Implementointisuunnitelma

*Osa Phase 1 "Ensimmäinen yhteisö" -kokonaisuutta. Ks. [Phase 1 yleiskatsaus](./phase-1-first-community.md)*

---

## 1.1 Email-järjestelmä

> Lähde: masterplan (§1.1)

### 1.1.1 Tavoite

Rakentaa email-palvelu joka mahdollistaa käyttäjien vahvistamisen, ilmoitukset ja magic link -kirjautumisen. Email-infra on perusta koko ihmiskerroksen toiminnalle: ilman sitä ei voi vahvistaa identiteettiä, lähettää matchaus-ehdotuksia tai ilmoittaa tapahtumista.

**Suunnitteluperiaate:** Email on *opt-in -infra*. Jos operaattori ei konfiguroi SMTP:tä, kaikki email-ominaisuudet disabloituvat gracefully. Mitään ei hajoa — email-riippuvaiset polut vain näyttävät viestin "Email ei käytettävissä tällä nodella".

### 1.1.2 Uudet riippuvuudet

```bash
cd aimeat
pnpm add nodemailer
pnpm add -D @types/nodemailer
```

| Paketti | Versio | Koko | Tarkoitus |
|---|---|---|---|
| `nodemailer` | ^6.x | ~200KB | SMTP-yhteys ja email-lähetys |
| `@types/nodemailer` | ^6.x | ~15KB | TypeScript-tyypit (dev) |

### 1.1.3 Konfiguraatio

#### MeatConfig-laajennukset

**Tiedosto:** `src/config.ts`

```typescript
export interface MeatConfig {
  // ... nykyiset kentät ...

  // Email (Phase 1.1)
  smtpHost: string | null;
  smtpPort: number;
  smtpUser: string | null;
  smtpPass: string | null;
  smtpFrom: string;
  smtpSecure: boolean;                    // true = TLS, false = STARTTLS
  emailConfirmationRequired: boolean;     // Operaattori päättää: vaaditaanko email-vahvistus
  emailEnabled: boolean;                  // Laskettu: smtpHost !== null
}
```

#### Ympäristömuuttujat

```env
# ── Email / SMTP ─────────────────────────────────────────────
# AIMEAT_SMTP_HOST="smtp.example.com"
# AIMEAT_SMTP_PORT=587
# AIMEAT_SMTP_USER="noreply@example.com"
# AIMEAT_SMTP_PASS="secret"
# AIMEAT_SMTP_FROM="AIMEAT <noreply@example.com>"
# AIMEAT_SMTP_SECURE=false                    # true = TLS (port 465), false = STARTTLS (port 587)
# AIMEAT_EMAIL_CONFIRMATION_REQUIRED=false    # true = GHII Level 1 requires email
```

#### Graceful degradation

`loadConfig()`:ssä:
```typescript
const smtpHost = process.env.AIMEAT_SMTP_HOST || null;
const emailEnabled = smtpHost !== null;

if (!emailEnabled) {
  logger.warn('SMTP not configured — email features disabled');
}
```

### 1.1.4 Uusi service: Email

**Tiedosto:** `src/services/email.ts`

```typescript
export interface EmailService {
  readonly enabled: boolean;

  sendVerificationCode(to: string, code: string, locale?: string): Promise<boolean>;
  sendMagicLink(to: string, loginUrl: string, locale?: string): Promise<boolean>;
  sendNotification(to: string, subject: string, body: string): Promise<boolean>;
  sendMatchSuggestion(to: string, matches: MatchSuggestion[], locale?: string): Promise<boolean>;
}

export interface MatchSuggestion {
  ghii: string;
  displayName: string;
  sharedInterests: string[];
  distance?: string;    // esim. "Tapiolassa"
}

export function createEmailService(config: MeatConfig): EmailService;
```

**Sisäinen toteutus:**

1. **Transporter:** `nodemailer.createTransport()` — luodaan kerran startup-aikana, uudelleenkäytetään
2. **Retry-logiikka:** 3 yritystä, exponential backoff (1s, 3s, 9s)
3. **Template-engine:** Ei ulkoista kirjastoa — HTML-pohjat template literal -funktioina:
   - `verificationEmailHtml(code, locale)` → HTML + plain text fallback
   - `magicLinkEmailHtml(loginUrl, locale)` → HTML + plain text
   - `notificationEmailHtml(subject, body, locale)` → HTML + plain text
   - `matchSuggestionEmailHtml(matches, locale)` → HTML + plain text
4. **Locale-tuki:** `fi` ja `en` aluksi. Fallback: `en`.
5. **Logging:** Jokainen lähetys loggaa (onnistunut/epäonnistunut) winston-loggerilla, ei loggaa sähköpostiosoitteita (yksityisyys)

### 1.1.5 Storage-muutokset

#### Uusi record-tyyppi: EmailVerificationRecord

**Tiedosto:** `src/storage/interface.ts`

```typescript
export interface EmailVerificationRecord {
  id: string;                     // UUID
  ownerName: string;              // Kenelle (viittaa OwnerRecord.name)
  emailHash: string;              // SHA-256 hash of email (ei tallenneta raakaa emailia)
  code: string;                   // 6-numeroinen vahvistuskoodi (hash)
  purpose: 'registration' | 'login' | 'change';
  status: 'pending' | 'verified' | 'expired';
  attempts: number;               // Yrityskerrat (max 5)
  expiresAt: string;              // 15 min voimassa
  createdAt: string;
  verifiedAt: string | null;
}
```

#### Uudet Storage-metodit

```typescript
export interface Storage {
  // ... nykyiset metodit ...

  // Email Verification (Phase 1.1)
  createEmailVerification(record: EmailVerificationRecord): Promise<EmailVerificationRecord>;
  getEmailVerification(id: string): Promise<EmailVerificationRecord | null>;
  getActiveEmailVerification(ownerName: string, purpose: string): Promise<EmailVerificationRecord | null>;
  updateEmailVerification(id: string, updates: Partial<EmailVerificationRecord>): Promise<EmailVerificationRecord | null>;
  deleteExpiredEmailVerifications(): Promise<number>;   // Cleanup-job
}
```

#### In-memory -toteutus

**Tiedosto:** `src/storage/memory.ts`

```typescript
private emailVerifications = new Map<string, EmailVerificationRecord>();
```

### 1.1.6 Turvallisuuskäytännöt

| Käytäntö | Toteutus |
|---|---|
| Email ei tallenneta | Vain SHA-256-hash, ei raakaa osoitetta |
| Verification code | 6 numeroa, SHA-256-hash storagessa |
| Rate limiting | Max 3 koodia/tunti/owner, max 5 yritystä/koodi |
| Vanheneminen | 15 min, automaattinen cleanup |
| Retry | 3 yritystä, exponential backoff |
| SMTP credentials | Ympäristömuuttujista, ei loggata |

### 1.1.7 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Email-palvelu ilman SMTP-konfiguraatiota | `enabled: false`, ei virheitä |
| 2 | Verification code -lähetys (mocked SMTP) | Email lähetetty, record luotu |
| 3 | Verification code -vahvistus oikealla koodilla | Status → verified |
| 4 | Verification code -vahvistus väärällä koodilla | Attempts +1, status pysyy pending |
| 5 | 5 väärää yritystä | Status → expired, koodi lukittu |
| 6 | Vanhentunut koodi | 401, "Code expired" |
| 7 | Rate limiting: 4. koodi samalle ownerille | 429, "Too many verification requests" |
| 8 | Magic link -lähetys | Email lähetetty, URL oikein |
| 9 | Match suggestion -email | Email sisältää matchit oikein formatoituna |
| 10 | Template locale fi | Suomenkielinen email |
| 11 | Template locale en (fallback) | Englanninkielinen email |
| 12 | SMTP-virhe → retry | 3 yritystä, viimeinen onnistuu |

### 1.1.8 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/services/email.ts` — EmailService + templates |
| **Uusi** | `src/services/email-templates.ts` — HTML/plain text templates |
| **Muokataan** | `src/config.ts` — SMTP-konfiguraatio MeatConfigiin |
| **Muokataan** | `src/storage/interface.ts` — EmailVerificationRecord + metodit |
| **Muokataan** | `src/storage/memory.ts` — In-memory toteutus |
| **Muokataan** | `src/server.ts` — EmailService-instanssin luonti |
| **Muokataan** | `.env.example` — SMTP-muuttujat |
| **Muokataan** | `openapi.yaml` — EmailVerification-schema |

---

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
