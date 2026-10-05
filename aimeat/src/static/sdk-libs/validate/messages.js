/**
 * @file validate/messages.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a person reads when a value is refused, and what a field of a given format
 *   expects, in English, Finnish and Spanish. Each language is written in that language. A message
 *   stands next to its field, so it does not repeat the field's name; it says what to do.
 *
 *   A schema can replace any of these per field with `x-messages` ({ <rule>: text or { en, fi, es } })
 *   and add its own hint with `x-hint`. Those win over everything here.
 *
 *   Placeholders: {n} a limit, {len} the current length, {other} another field's label, {fields}
 *   a list of labels, {value} the one accepted value.
 * @structure MESSAGES { en, fi, es } · FORMAT_HINTS { en, fi, es } · FORMAT_MESSAGES { en, fi, es } · LIST_WORD
 * @usage import { MESSAGES, FORMAT_HINTS, FORMAT_MESSAGES } from './messages.js';
 * @version-history
 *   v1.0.0 - 2026-10-05 - Initial (wish-sy-tteiden-validointi-sovelluksiin-yksi-json-schema-ui-lle-a).
 */

/** @type {Record<string, Record<string, string>>} */
export const MESSAGES = {
  en: {
    required: 'Fill in this field.',
    requiredBecause: 'Fill in this field too, because {other} is filled in.',
    minLength: 'Write at least {n} characters.',
    minLength1: 'Write at least one character.',
    maxLength: 'At most {n} characters. There are {len} now.',
    pattern: 'Check the format.',
    format: 'Check the format.',
    minimum: 'The smallest allowed value is {n}.',
    maximum: 'The largest allowed value is {n}.',
    exclusiveMinimum: 'The value must be greater than {n}.',
    exclusiveMaximum: 'The value must be less than {n}.',
    multipleOf: 'Use steps of {n}.',
    enum: 'Choose one of the options.',
    const: 'The value must be {value}.',
    constTrue: 'Tick this to continue.',
    typeNumber: 'Write a number here.',
    typeInteger: 'Write a whole number here.',
    type: 'This value does not fit this field.',
    minItems: 'Choose at least {n}.',
    maxItems: 'Choose at most {n}.',
    uniqueItems: 'The same value is in the list twice.',
    sameAs: 'This does not match {other}.',
    anyOf: 'Fill in at least one of these: {fields}.',
    oneOf: 'Fill in only one of these: {fields}.',
    choice: 'Check these details.',
    not: 'This value is not accepted.',
    additional: 'This information is not accepted here.',
  },
  fi: {
    required: 'Täytä tämä kenttä.',
    requiredBecause: 'Täytä myös tämä, koska {other} on täytetty.',
    minLength: 'Kirjoita vähintään {n} merkkiä.',
    minLength1: 'Kirjoita vähintään yksi merkki.',
    maxLength: 'Enintään {n} merkkiä. Nyt merkkejä on {len}.',
    pattern: 'Tarkista muoto.',
    format: 'Tarkista muoto.',
    minimum: 'Pienin sallittu arvo on {n}.',
    maximum: 'Suurin sallittu arvo on {n}.',
    exclusiveMinimum: 'Arvon pitää olla suurempi kuin {n}.',
    exclusiveMaximum: 'Arvon pitää olla pienempi kuin {n}.',
    multipleOf: 'Sallitut arvot menevät {n}:n välein.',
    enum: 'Valitse jokin vaihtoehdoista.',
    const: 'Arvon pitää olla {value}.',
    constTrue: 'Valitse tämä, jotta voit jatkaa.',
    typeNumber: 'Kirjoita tähän luku.',
    typeInteger: 'Kirjoita tähän kokonaisluku.',
    type: 'Tämä arvo ei sovi tähän kenttään.',
    minItems: 'Valitse vähintään {n}.',
    maxItems: 'Valitse enintään {n}.',
    uniqueItems: 'Sama arvo on luettelossa kahdesti.',
    sameAs: 'Tämä ei ole sama kuin kentässä {other}.',
    anyOf: 'Täytä ainakin yksi näistä: {fields}.',
    oneOf: 'Täytä vain yksi näistä: {fields}.',
    choice: 'Tarkista nämä tiedot.',
    not: 'Tämä arvo ei kelpaa.',
    additional: 'Tätä tietoa ei voi antaa tässä.',
  },
  es: {
    required: 'Completa este campo.',
    requiredBecause: 'Completa también este campo, porque {other} tiene un valor.',
    minLength: 'Escribe al menos {n} caracteres.',
    minLength1: 'Escribe al menos un carácter.',
    maxLength: 'Máximo {n} caracteres. Ahora hay {len}.',
    pattern: 'Revisa el formato.',
    format: 'Revisa el formato.',
    minimum: 'El valor mínimo es {n}.',
    maximum: 'El valor máximo es {n}.',
    exclusiveMinimum: 'El valor debe ser mayor que {n}.',
    exclusiveMaximum: 'El valor debe ser menor que {n}.',
    multipleOf: 'Usa valores de {n} en {n}.',
    enum: 'Elige una de las opciones.',
    const: 'El valor debe ser {value}.',
    constTrue: 'Marca esta casilla para continuar.',
    typeNumber: 'Escribe un número aquí.',
    typeInteger: 'Escribe un número entero aquí.',
    type: 'Este valor no corresponde a este campo.',
    minItems: 'Elige al menos {n}.',
    maxItems: 'Elige como máximo {n}.',
    uniqueItems: 'El mismo valor aparece dos veces en la lista.',
    sameAs: 'No coincide con {other}.',
    anyOf: 'Completa al menos uno de estos: {fields}.',
    oneOf: 'Completa solo uno de estos: {fields}.',
    choice: 'Revisa estos datos.',
    not: 'Este valor no es válido.',
    additional: 'Este dato no se acepta aquí.',
  },
};

/** The word that joins the last two labels of a list: "A, B or C". */
export const LIST_WORD = { en: 'or', fi: 'tai', es: 'o' };

/**
 * What a field of a format expects, shown under the field before anything is typed. The field's
 * label already names the thing, so a hint gives only the shape and an example.
 * @type {Record<string, Record<string, string>>}
 */
export const FORMAT_HINTS = {
  en: {
    email: 'For example name@example.com.',
    uri: 'Starts with https://, for example https://example.com.',
    url: 'Starts with https://, for example https://example.com.',
    date: 'For example 2026-10-05.',
    time: 'For example 14:30:00.',
    'fi-business-id': 'Seven digits, a hyphen and a check digit, for example 0737546-2.',
    'fi-personal-id': 'For example 131052-308T.',
    iban: 'For example FI21 1234 5600 0007 85.',
    'fi-postal-code': 'Five digits, for example 00100.',
    phone: 'For example +358 40 123 4567.',
  },
  fi: {
    email: 'Esimerkiksi nimi@esimerkki.fi.',
    uri: 'Alkaa https://, esimerkiksi https://esimerkki.fi.',
    url: 'Alkaa https://, esimerkiksi https://esimerkki.fi.',
    date: 'Esimerkiksi 2026-10-05.',
    time: 'Esimerkiksi 14:30:00.',
    'fi-business-id': 'Seitsemän numeroa, väliviiva ja tarkistusnumero, esimerkiksi 0737546-2.',
    'fi-personal-id': 'Esimerkiksi 131052-308T.',
    iban: 'Esimerkiksi FI21 1234 5600 0007 85.',
    'fi-postal-code': 'Viisi numeroa, esimerkiksi 00100.',
    phone: 'Esimerkiksi +358 40 123 4567.',
  },
  es: {
    email: 'Por ejemplo nombre@ejemplo.com.',
    uri: 'Empieza por https://, por ejemplo https://ejemplo.com.',
    url: 'Empieza por https://, por ejemplo https://ejemplo.com.',
    date: 'Por ejemplo 2026-10-05.',
    time: 'Por ejemplo 14:30:00.',
    'fi-business-id': 'Siete dígitos, un guion y un dígito de control, por ejemplo 0737546-2.',
    'fi-personal-id': 'Por ejemplo 131052-308T.',
    iban: 'Por ejemplo FI21 1234 5600 0007 85.',
    'fi-postal-code': 'Cinco dígitos, por ejemplo 00100.',
    phone: 'Por ejemplo +57 300 123 4567.',
  },
};

/**
 * What a refused value of a format is told, by the reason its test gave (formats.js). `shape` is
 * the fallback for every reason a format does not name.
 * @type {Record<string, Record<string, Record<string, string>>>}
 */
export const FORMAT_MESSAGES = {
  en: {
    email: { shape: 'This is not an email address.' },
    uri: { shape: 'This is not a web address. A web address starts with https://, for example.' },
    url: { shape: 'This is not a web address. A web address starts with https://, for example.' },
    date: { shape: 'This is not a date.' },
    time: { shape: 'This is not a time.' },
    'date-time': { shape: 'This is not a date and time.' },
    'fi-business-id': {
      shape: 'A Business ID has seven digits, a hyphen and a check digit.',
      check: 'The check digit of the Business ID does not match. Check the digits.',
    },
    'fi-personal-id': {
      shape: 'A personal identity code has six digits, a century sign and four characters.',
      date: 'The personal identity code does not start with a real date.',
      check: 'The check character of the personal identity code does not match. Check the characters.',
    },
    iban: {
      shape: 'An IBAN starts with a country code and two digits, such as FI21.',
      length: 'The IBAN has the wrong number of characters for its country.',
      check: 'The check digits of the IBAN do not match. Check the account number.',
    },
    'fi-postal-code': { shape: 'A postal code has five digits.' },
    phone: { shape: 'This is not a phone number. Use digits, with a + at the start if needed.' },
  },
  fi: {
    email: { shape: 'Tämä ei ole sähköpostiosoite.' },
    uri: { shape: 'Tämä ei ole verkko-osoite. Osoite alkaa esimerkiksi https://.' },
    url: { shape: 'Tämä ei ole verkko-osoite. Osoite alkaa esimerkiksi https://.' },
    date: { shape: 'Tämä ei ole päivämäärä.' },
    time: { shape: 'Tämä ei ole kellonaika.' },
    'date-time': { shape: 'Tämä ei ole päivämäärä ja kellonaika.' },
    'fi-business-id': {
      shape: 'Y-tunnuksessa on seitsemän numeroa, väliviiva ja tarkistusnumero.',
      check: 'Y-tunnuksen tarkistusnumero ei täsmää. Tarkista numerot.',
    },
    'fi-personal-id': {
      shape: 'Henkilötunnuksessa on kuusi numeroa, välimerkki ja neljä merkkiä.',
      date: 'Henkilötunnuksen alussa ei ole oikeaa päivämäärää.',
      check: 'Henkilötunnuksen tarkistusmerkki ei täsmää. Tarkista merkit.',
    },
    iban: {
      shape: 'IBAN alkaa maatunnuksella ja kahdella numerolla, esimerkiksi FI21.',
      length: 'IBANissa on väärä määrä merkkejä tälle maalle.',
      check: 'IBANin tarkistusnumerot eivät täsmää. Tarkista tilinumero.',
    },
    'fi-postal-code': { shape: 'Postinumerossa on viisi numeroa.' },
    phone: { shape: 'Tämä ei ole puhelinnumero. Käytä numeroita ja tarvittaessa alussa +-merkkiä.' },
  },
  es: {
    email: { shape: 'Esto no es una dirección de correo.' },
    uri: { shape: 'Esto no es una dirección web. Una dirección web empieza, por ejemplo, por https://.' },
    url: { shape: 'Esto no es una dirección web. Una dirección web empieza, por ejemplo, por https://.' },
    date: { shape: 'Esto no es una fecha.' },
    time: { shape: 'Esto no es una hora.' },
    'date-time': { shape: 'Esto no es una fecha con hora.' },
    'fi-business-id': {
      shape: 'El Y-tunnus tiene siete dígitos, un guion y un dígito de control.',
      check: 'El dígito de control del Y-tunnus no coincide. Revisa los dígitos.',
    },
    'fi-personal-id': {
      shape: 'El número de identidad tiene seis dígitos, un signo de siglo y cuatro caracteres.',
      date: 'El número de identidad no empieza con una fecha real.',
      check: 'El carácter de control del número de identidad no coincide. Revisa los caracteres.',
    },
    iban: {
      shape: 'El IBAN empieza con el código del país y dos dígitos, por ejemplo FI21.',
      length: 'El IBAN no tiene el número de caracteres que corresponde a su país.',
      check: 'Los dígitos de control del IBAN no coinciden. Revisa el número de cuenta.',
    },
    'fi-postal-code': { shape: 'El código postal tiene cinco dígitos.' },
    phone: { shape: 'Esto no es un número de teléfono. Usa dígitos y, si hace falta, un + al principio.' },
  },
};
