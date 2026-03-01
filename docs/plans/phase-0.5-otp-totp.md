# Phase 0.5: OTP/TOTP-tuki — Implementointisuunnitelma

*Osa Phase 0 Foundation -kokonaisuutta. Ks. [Phase 0 yleiskatsaus](./2026-03-01-phase-0-foundation.md)*

---

## 0.5 OTP/TOTP-tuki

> Lähde: `docs/research/otp-totp-integraatio.md`

### 0.5.1 Tavoite

Lisätä TOTP (Time-based One-Time Password) -tuki GHII-kirjautumiseen. Tämä on kriittinen turvallisuusominaisuus ihmiskäyttäjille joiden ainoa autentikaatiotekijä on salasana.

### 0.5.2 Uudet riippuvuudet

```bash
cd aimeat
pnpm add otpauth qrcode
pnpm add -D @types/qrcode
```

| Paketti | Versio | Koko | Tarkoitus |
|---|---|---|---|
| `otpauth` | ^9.x | ~8KB | TOTP-generointi ja -validointi (0 riippuvuutta, TypeScript) |
| `qrcode` | ^1.x | ~30KB | QR-koodien generointi (data URL, SVG, terminaali) |
| `@types/qrcode` | ^1.x | — | TypeScript-tyypit qrcodelle |

### 0.5.3 Storage-muutokset

#### GHIIRecord-laajennukset

**Tiedosto:** `src/storage/interface.ts`

```typescript
export interface GHIIRecord {
  // ... nykyiset kentät (username, nodeId, ghii, displayName, bio, avatar,
  //     locale, passwordHash, verificationLevel, ownerName, createdAt, updatedAt) ...

  // Uudet TOTP-kentät:
  totpSecret?: string;          // AES-256-GCM salattu TOTP secret (Base32)
  totpEnabled: boolean;         // Onko TOTP aktivoitu (default: false)
  totpBackupCodes?: string[];   // SHA-256 hash:atut varakoodit
  totpLastUsedAt?: string;      // Viimeksi käytetyn koodin aikaleima (replay-suojaus)
  totpLastUsedCode?: string;    // Viimeksi käytetty koodi (replay-suojaus)
  totpFailedAttempts?: number;  // Epäonnistuneet yritykset (rate limiting)
  totpLockedUntil?: string;     // Lukittu tähän asti (rate limiting)
}
```

**HUOM:** `totpEnabled` on boolean jota EI voi asettaa ` optional`:ksi — se tarvitsee default-arvon `false`. Kaikki nykyiset GHIIRecordit saavat `totpEnabled: false` implisiittisesti.

### 0.5.4 Uusi service: TOTP

**Uusi tiedosto:** `src/services/totp.ts`

```typescript
import { TOTP, Secret } from 'otpauth';
import QRCode from 'qrcode';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

// ── TOTP-konfiguraatio ──

export interface TotpConfig {
  issuer: string;           // "AIMEAT" (näkyy sovelluksessa)
  algorithm: 'SHA1';        // Ainoa joka toimii kaikissa (Google Auth, MS Auth)
  digits: 6;                // 6-numeroinen koodi
  period: 30;               // 30 sekunnin ikkuna
  window: 1;                // ±1 ikkuna toleranssi
  backupCodeCount: number;  // 10 varakoodia
  encryptionKey?: Buffer;   // AES-256-GCM -avain secretin salaamiseen
}

// ── Secret-generointi ──

export interface TotpSetupResult {
  secret: string;           // Base32-enkoodattu secret (näytetään vain kerran)
  uri: string;              // otpauth:// URI
  qrDataUrl: string;        // data:image/png;base64,...
  backupCodes: string[];    // 10 × 8-merkkistä varakoodia (selkokieliset, näytetään vain kerran)
  encryptedSecret: string;  // Salattu versio storageen tallennettavaksi
  hashedBackupCodes: string[]; // SHA-256 hash:atut varakoodit storageen
}

export async function setupTotp(
  username: string,
  config: TotpConfig,
): Promise<TotpSetupResult> {
  const secret = new Secret({ size: 20 });
  const totp = new TOTP({
    issuer: config.issuer,
    label: username,
    algorithm: config.algorithm,
    digits: config.digits,
    period: config.period,
    secret,
  });

  const uri = totp.toString();
  const qrDataUrl = await QRCode.toDataURL(uri);

  // Varakoodit: 10 × 8-merkkinen satunnainen koodi
  const backupCodes: string[] = [];
  const hashedBackupCodes: string[] = [];
  for (let i = 0; i < config.backupCodeCount; i++) {
    const code = randomBytes(4).toString('hex'); // 8 hex-merkkiä
    backupCodes.push(code);
    hashedBackupCodes.push(createHash('sha256').update(code).digest('hex'));
  }

  // Salaa secret storagea varten
  const encryptedSecret = config.encryptionKey
    ? encryptSecret(secret.base32, config.encryptionKey)
    : secret.base32; // Ei salausta → tallennetaan sellaisenaan (dev-moodi)

  return {
    secret: secret.base32,
    uri,
    qrDataUrl,
    backupCodes,
    encryptedSecret,
    hashedBackupCodes,
  };
}

// ── Validointi ──

export function validateTotpCode(
  encryptedSecret: string,
  code: string,
  config: TotpConfig,
): { valid: boolean; delta: number | null } {
  const secretBase32 = config.encryptionKey
    ? decryptSecret(encryptedSecret, config.encryptionKey)
    : encryptedSecret;

  const totp = new TOTP({
    issuer: config.issuer,
    algorithm: config.algorithm,
    digits: config.digits,
    period: config.period,
    secret: Secret.fromBase32(secretBase32),
  });

  const delta = totp.validate({ token: code, window: config.window });
  return { valid: delta !== null, delta };
}

// ── Varakoodi-validointi ──

export function validateBackupCode(
  code: string,
  hashedCodes: string[],
): { valid: boolean; index: number } {
  const hashed = createHash('sha256').update(code).digest('hex');
  const index = hashedCodes.indexOf(hashed);
  return { valid: index !== -1, index };
}

// ── AES-256-GCM salaus/purku ──

function encryptSecret(secret: string, key: Buffer): string { ... }
function decryptSecret(data: string, key: Buffer): string { ... }
```

### 0.5.5 Uusi route: TOTP Management

**Uusi tiedosto:** `src/routes/totp.ts`

```typescript
export function totpRouter(config: MeatConfig, storage: Storage): Router
```

#### POST /v1/ghii/totp/setup — Aloita TOTP-setup

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/ghii/totp/setup` |
| **Auth** | Vaatii JWT (GHII-käyttäjä) |

**Response 200:**

```json
{
  "ok": true,
  "data": {
    "totp_secret": "JBSWY3DPEHPK3PXP",
    "totp_uri": "otpauth://totp/AIMEAT:alice?secret=JBSWY3DPEHPK3PXP&issuer=AIMEAT&algorithm=SHA1&digits=6&period=30",
    "qr_data_url": "data:image/png;base64,...",
    "backup_codes": ["a1b2c3d4", "e5f6g7h8", ...],
    "note": "Scan the QR code with your authenticator app. Save the backup codes securely. They cannot be shown again."
  }
}
```

**Logiikka:**
1. Hae GHIIRecord käyttäjän perusteella
2. Jos `totpEnabled === true` → 409 TOTP_ALREADY_ENABLED
3. Generoi TOTP setup (`setupTotp()`)
4. **Tallenna salattu secret tilapäisesti** (vielä EI aktivoi):
   - Aseta `totpSecret = encryptedSecret` storageen
   - `totpEnabled` pysyy `false` — aktivoidaan vasta verify-vaiheessa
   - `totpBackupCodes = hashedBackupCodes` storageen
5. Palauta secret, URI, QR-koodi ja varakoodit

#### POST /v1/ghii/totp/verify — Vahvista ja aktivoi TOTP

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/ghii/totp/verify` |
| **Auth** | Vaatii JWT |

**Request body:**

```json
{ "code": "123456" }
```

**Logiikka:**
1. Hae GHIIRecord
2. Jos `totpSecret` puuttuu → 400 TOTP_NOT_SETUP
3. Jos `totpEnabled === true` → 409 TOTP_ALREADY_ENABLED
4. Validoi koodi `validateTotpCode()`
5. Jos validi → aseta `totpEnabled = true` → 200
6. Jos invalidi → 401 INVALID_TOTP

#### DELETE /v1/ghii/totp — Poista TOTP käytöstä

| Kenttä | Arvo |
|---|---|
| **Metodi** | DELETE |
| **Polku** | `/v1/ghii/totp` |
| **Auth** | Vaatii JWT |

**Request body:**

```json
{ "code": "123456" }
```

Vaatii voimassaolevan TOTP-koodin TAI varakoodin poistamiseen. Asettaa `totpEnabled = false`, tyhjentää `totpSecret` ja `totpBackupCodes`.

#### POST /v1/ghii/totp/backup-codes — Generoi uudet varakoodit

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/ghii/totp/backup-codes` |
| **Auth** | Vaatii JWT |

**Request body:**

```json
{ "code": "123456" }
```

Vaatii voimassaolevan TOTP-koodin. Generoi 10 uutta varakoodia ja korvaa vanhat. Palauttaa uudet varakoodit selkokielisinä (näytetään vain kerran).

**Response 200:**

```json
{
  "ok": true,
  "data": {
    "backup_codes": ["a1b2c3d4", "e5f6g7h8", ...],
    "note": "Save these codes securely. The previous codes are no longer valid."
  }
}
```

### 0.5.6 Muutokset olemassaoleviin tiedostoihin

#### `src/routes/ghii.ts` — Login-flow-muutos

**POST /v1/ghii/login:**

```typescript
// Nykyisen password-tarkistuksen JÄLKEEN, ENNEN avainten generointia:

// TOTP-tarkistus
const ghiiRecord = await storage.getGHII(ghii);
if (ghiiRecord?.totpEnabled) {
  const { totp_code, backup_code } = req.body;

  if (!totp_code && !backup_code) {
    res.status(401).json(error(config.nodeId, 'TOTP_REQUIRED',
      'TOTP code is required for this account', 401, {
        totp_required: true,
      }));
    return;
  }

  // Rate limiting: tarkista lukitus
  if (ghiiRecord.totpLockedUntil && new Date(ghiiRecord.totpLockedUntil) > new Date()) {
    res.status(429).json(error(config.nodeId, 'TOTP_LOCKED',
      'Too many failed attempts. Try again later.'));
    return;
  }

  let totpValid = false;

  if (totp_code) {
    // Replay-suojaus
    if (ghiiRecord.totpLastUsedCode === totp_code) {
      res.status(401).json(error(config.nodeId, 'TOTP_REPLAY', 'This code has already been used'));
      return;
    }

    const result = validateTotpCode(ghiiRecord.totpSecret!, totp_code, totpConfig);
    totpValid = result.valid;

    if (totpValid) {
      await storage.updateGHII(ghii, {
        totpLastUsedCode: totp_code,
        totpLastUsedAt: new Date().toISOString(),
        totpFailedAttempts: 0,
      });
    }
  } else if (backup_code) {
    const result = validateBackupCode(backup_code, ghiiRecord.totpBackupCodes ?? []);
    totpValid = result.valid;

    if (totpValid) {
      // Poista käytetty varakoodi
      const codes = [...(ghiiRecord.totpBackupCodes ?? [])];
      codes.splice(result.index, 1);
      await storage.updateGHII(ghii, { totpBackupCodes: codes });
    }
  }

  if (!totpValid) {
    // Kasvata failed attempts
    const attempts = (ghiiRecord.totpFailedAttempts ?? 0) + 1;
    const updates: Partial<GHIIRecord> = { totpFailedAttempts: attempts };
    if (attempts >= 5) {
      updates.totpLockedUntil = new Date(Date.now() + 5 * 60_000).toISOString(); // 5 min lukitus
      updates.totpFailedAttempts = 0;
    }
    await storage.updateGHII(ghii, updates);

    res.status(401).json(error(config.nodeId, 'INVALID_TOTP', 'Invalid TOTP code'));
    return;
  }
}

// ... jatka normaalisti avainten generointiin ja JWT:n luontiin ...
```

#### `src/config.ts` — Uudet konfiguraatiokentät

```typescript
// TOTP
totpEnabled: boolean;                    // Feature flag (default: true)
totpIssuer: string;                      // QR-koodissa näkyvä nimi (default: 'AIMEAT')
totpAlgorithm: 'SHA1';                   // Ainoa joka toimii kaikkialla
totpDigits: 6;                           // Koodin pituus
totpPeriod: number;                      // Sekuntia (default: 30)
totpWindow: number;                      // ±N ikkunaa toleranssi (default: 1)
totpBackupCodeCount: number;             // Varakoodien määrä (default: 10)
totpSecretEncryptionKey: string | null;  // AES-256-avain (hex, 64 merkkiä) tai null
totpMaxFailedAttempts: number;           // Max yrityksiä ennen lukitusta (default: 5)
totpLockoutSeconds: number;             // Lukitusaika sekunteina (default: 300)
```

**Ympäristömuuttujat:**

```env
AIMEAT_TOTP_ENABLED=true
AIMEAT_TOTP_ISSUER=AIMEAT
AIMEAT_TOTP_PERIOD=30
AIMEAT_TOTP_WINDOW=1
AIMEAT_TOTP_BACKUP_CODE_COUNT=10
AIMEAT_TOTP_SECRET_ENCRYPTION_KEY=       # Tyhjä = ei salausta (vain dev)
AIMEAT_TOTP_MAX_FAILED_ATTEMPTS=5
AIMEAT_TOTP_LOCKOUT_SECONDS=300
```

### 0.5.7 Turvallisuuskäytännöt

| Uhka | Suojaus |
|---|---|
| Brute force | 5 yritystä → 5 min lukitus |
| Replay attack | Viimeksi käytetty koodi + aikaleima tallennetaan |
| Secret-vuoto | AES-256-GCM -salaus at rest |
| Puhelimen katoaminen | 10 kertakäyttöistä varakoodia |
| Man-in-the-middle | HTTPS (TLS) pakollinen tuotannossa |
| Aikasynkronointi | ±1 ikkunan toleranssi (±30s) |

### 0.5.8 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | `POST /v1/ghii/totp/setup` ilman authia | 401 |
| 2 | `POST /v1/ghii/totp/setup` autentikoituna | 200, secret + QR + varakoodit |
| 3 | `POST /v1/ghii/totp/verify` oikealla koodilla | 200, totpEnabled = true |
| 4 | `POST /v1/ghii/totp/verify` väärällä koodilla | 401 INVALID_TOTP |
| 5 | Login ilman TOTP:a kun enabled | 401 TOTP_REQUIRED (body: totp_required: true) |
| 6 | Login oikealla TOTP-koodilla | 200, normaalit avaimet + JWT |
| 7 | Login väärällä TOTP-koodilla | 401 INVALID_TOTP |
| 8 | Login varakoodilla | 200, varakoodi poistetaan listalta |
| 9 | Sama varakoodi uudestaan | 401 (jo käytetty) |
| 10 | 5 väärää yritystä → lukitus | 429 TOTP_LOCKED |
| 11 | Odota lukitusajan → yritä uudelleen | 200 (lukitus ohi) |
| 12 | `DELETE /v1/ghii/totp` oikealla koodilla | 200, TOTP disabled |
| 13 | `POST /v1/ghii/totp/setup` kun jo enabled | 409 TOTP_ALREADY_ENABLED |
| 14 | Login saman koodin kahdesti 30s sisällä | 401 TOTP_REPLAY |
| 15 | TOTP_ENABLED=false → setup-endpoint palauttaa 503 | 503 FEATURE_DISABLED |
| 16 | `POST /v1/ghii/totp/backup-codes` oikealla TOTP-koodilla | 200, 10 uutta varakoodia |
| 17 | `POST /v1/ghii/totp/backup-codes` väärällä koodilla | 401 INVALID_TOTP |
| 18 | Vanhat varakoodit eivät toimi uusien generoinnin jälkeen | 401 |

### 0.5.9 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/services/totp.ts` |
| **Uusi** | `src/routes/totp.ts` |
| **Muokataan** | `src/storage/interface.ts` — GHIIRecord TOTP-kentät |
| **Muokataan** | `src/storage/memory.ts` — GHIIRecord default-arvot |
| **Muokataan** | `src/storage/mongodb.ts` — GHIIRecord TOTP-kentät MongoDB:lle |
| **Muokataan** | `src/routes/ghii.ts` — login-flow TOTP-tarkistus |
| **Muokataan** | `src/config.ts` — TOTP-konfiguraatio |
| **Muokataan** | `src/models/schemas.ts` — TotpSetupSchema, TotpVerifySchema |
| **Muokataan** | `src/server.ts` — totpRouter import + mount |
| **Muokataan** | `test/e2e-full.ts` — TOTP-testifaasi |

---

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
