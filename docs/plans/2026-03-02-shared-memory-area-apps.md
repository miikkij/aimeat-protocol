# Yhteinen muistialue sovelluskorttien prompteihin

**Päivämäärä:** 2026-03-02  
**Tila:** Suunnitelma → Toteutus  
**Tiedosto:** `aimeat/src/routes/portal-human.ts`  
**Vaikutus:** Prompt-muuttujat `askUser` ja `prompts`-objekti

---

## Tausta

Portal-sivun Sovellukset-kortti (Card 2) tarjoaa 6 kategoriaa: Pelit, Muistiinpanot, Seurantatyökalut, Perhetyökalut, Luovat ja Oma idea. Jokainen generoi promptin joka ohjeistaa AI:ta rakentamaan HTML-sovelluksen joka käyttää AIME AT muisti-APIa tallennukseen.

### Nykytila

Jokainen sovellus saa **oman erillisen** muistialueen:
- `apps.notes.[note-id]` — yksityiset muistiinpanot
- `apps.art.[drawing-id]` — omat piirustukset
- `apps.tracker.[date]` — oma seuranta

Käyttäjä ei näe muiden tekemiä sisältöjä eikä voi jakaa omia yhteiseen tilaan.

### Ongelma

- Ei yhteisöllisyyttä: jokainen sovellus on siiloissa
- Muisti-kortti (Card 1) antaa jo tarkan osoitteen (`portal.board.main`) ja näyttää muiden viestit → tätä mallia pitää laajentaa sovelluskortteihin
- Esim. piirustusohjelma: käyttäjä ei näe muiden teoksia eikä voi laittaa omaansa galleriaan

---

## Ratkaisu

### 1. Uusi alkukysymys: Muistialue (OMA / YHTEINEN)

Lisätään `askUser`-muuttujaan kolmas kysymys:

```
3. Memory area: Should this app have its OWN private space, or use a SHARED community space?
   - OWN: unique key like "apps.[type].[my-unique-id]" — only I see my data
   - SHARED: community key (given below) — I see others' content and can add mine
   If SHARED, the app must show a gallery/list of all community items and let the user add theirs.
```

### 2. Yhteiset muistiosoitteet per kategoria

| Kategoria | Yhteinen avain | Mitä käyttäjä näkee | Mitä voi lisätä |
|---|---|---|---|
| **Pelit** | `apps.games.[gametype].lobby` | Jo yhteinen — muiden pelit | Oma peli |
| **Muistiinpanot** | `apps.notes.community.board` | Muiden julkiset muistiinpanot | Oma muistiinpano |
| **Seurantatyökalut** | `apps.tracker.community.dashboard` | Yhteishaasteen tulokset | Oma edistyminen |
| **Perhetyökalut** | `apps.family.shared.[list-id]` | Jo yhteinen URL hash -mallilla | Oma lisäys |
| **Luovat** | `apps.art.community.gallery` | Kaikkien taideteokset | Oma piirustus/teos |
| **Oma idea** | `apps.custom.community.[nimi]` | Riippuu ideasta | Riippuu ideasta |

### 3. Yhteisen alueen dataformaatti

Jokaisella yhteisellä alueella sama perusrakenne:

```json
{
  "items": [
    {
      "id": "unique-id",
      "author": "Käyttäjänimi",
      "title": "Otsikko",
      "data": "...sisältö...",
      "created": "2026-03-02T10:00:00Z"
    }
  ]
}
```

Promptissa annetaan eksplisiittisesti:
- **Luku:** `GET {nodeUrl}/v1/memory/{yhteinen-avain}` → `data.value.items`
- **Kirjoitus:** GET ensin, lisää oma item `items`-taulukkoon, POST takaisin (read-modify-write)
- **Formaatti:** Kategoria-kohtainen (esim. art-galleriassa `data` on base64-kuva)

### 4. Konkreettiset muutokset

#### a) `askUser` — lisätään kysymys 3

Ennen:
```javascript
var askUser = 'Before building, ask me:\n' +
  '1. What should the app be called?\n' +
  '2. How should it look and feel?\n' +
  'Use my answers to customize the title, colors, fonts, and overall vibe.\n\n';
```

Jälkeen:
```javascript
var askUser = 'Before building, ask me:\n' +
  '1. What should the app be called?\n' +
  '2. How should it look and feel?\n' +
  '3. Memory area: OWN private space, or SHARED community space where you see others\' content?\n' +
  'Use my answers to customize everything.\n\n';
```

#### b) Jokainen kategoriaprompt — lisätään yhteisen alueen osio

Kussakin promptissa lisätään `apiRef`:n jälkeen uusi blokki:

```
## Shared community option (if user chooses SHARED):
Key: "[yhteinen-avain]"
Read: GET {nodeUrl}/v1/memory/[yhteinen-avain]
Format: { "items": [...community-specific items...] }
To add: GET existing → append new item to items array → POST full object back.
Show all community items in a gallery/list. Let user add theirs with their name.
```

#### c) Per kategoria — lisäosiot

**notes:**
```
## Shared community board (if user chooses SHARED):
Key: "apps.notes.community.board"
Format: {"items": [{"id":"unique","author":"Name","title":"Title","body":"Content","created":"ISO"}]}
Show all community notes in a feed. Let user add their own with their name.
```

**trackers:**
```
## Shared community dashboard (if user chooses SHARED):
Key: "apps.tracker.community.dashboard"
Format: {"items": [{"id":"unique","author":"Name","category":"habit/expense/etc","entries":[...],"created":"ISO"}]}
Show a shared leaderboard/dashboard of everyone's tracked items. Let user add theirs.
```

**creative:**
```
## Shared community gallery (if user chooses SHARED):
Key: "apps.art.community.gallery"
Format: {"items": [{"id":"unique","author":"Name","title":"Title","data":"data:image/png;base64,...","created":"ISO"}]}
Show all community artwork in a gallery grid. Let user upload/save theirs alongside.
```

**custom:**
```
## Shared community option (if user chooses SHARED):
Ask the user what to call the shared space (e.g. "apps.custom.community.[name]").
Use the same items array pattern for storing shared data.
```

#### d) games — ei muutosta (lobby on jo yhteinen)

Lisätään vain maininta:
```
NOTE: The lobby is already a shared community space — all players see the same lobby.
If user wants a PRIVATE lobby instead, use "apps.games.[gametype].private.[uniqueId].lobby"
```

#### e) family — ei muutosta (URL hash on jo jaettu)

Lisätään vain maininta:
```
NOTE: This is already shared via URL hash — family members access the same data.
The SHARED option here means a PUBLIC community list visible to everyone.
Key for public: "apps.family.community.lists"
```

### 5. Mitä EI muuteta

- Memory card (Card 1) — toimii jo oikein
- `apiRef`-muuttuja — pysyy ennallaan
- Backend — ei uusia endpointeja, kaikki menee `POST /v1/memory` + `GET /v1/memory/:key`
- Lokalisointi — promptit ovat englanniksi (AI ymmärtää)

### 6. Toteutusjärjestys

1. ✏️ Päivitä `askUser` — lisää muistialuekysymys
2. ✏️ Päivitä `prompts.notes` — lisää yhteisen alueen osio
3. ✏️ Päivitä `prompts.trackers` — lisää yhteisen alueen osio
4. ✏️ Päivitä `prompts.creative` — lisää yhteisen alueen osio
5. ✏️ Päivitä `prompts.games` — lisää maininta lobbysta + yksityinen vaihtoehto
6. ✏️ Päivitä `prompts.family` — lisää maininta jaetusta + julkinen vaihtoehto
7. ✏️ Päivitä `prompts.custom` — lisää yhteisen alueen ohje
8. ✅ Tarkista `npx tsc --noEmit`
