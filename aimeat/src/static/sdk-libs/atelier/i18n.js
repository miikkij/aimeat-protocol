/**
 * @file atelier/i18n.js
 * @description Translation for the aimeat-atelier kit's OWN handful of strings, and the merge
 *   point for the host's. The kit ships English, Finnish and Spanish for the words it puts on
 *   screen itself (Loading, Retry, Nothing here yet, …); everything else — every label in your
 *   app — comes from the host, because the kit has no idea what your things are called.
 *
 *   Each language is written in that language, not as translated English.
 *
 *   It follows the PLATFORM language choice rather than inventing a second one: the current
 *   language is read from AIMEAT.auth.getLang() when the auth library is present, else the
 *   `aimeat-lang` storage key, else the browser, and it re-renders on the platform's
 *   `aimeat-lang-change` event. There is no language switch in this kit — the login pill has one.
 *   The language it draws in goes on <html lang> at load and on every change (markPage), when the
 *   page declares that language or, declaring none, the person chose it.
 * @structure BASE (en/fi/es) · KIT_KEYS · declared/chosen/markPage · lang/setLang · use(dict) · t(key, vars) · onChange
 * @usage  AIMEAT.atelier.i18n.use({ fi: { addTask: 'Lisää tehtävä' }, en: { addTask: 'Add task' } });
 *         AIMEAT.atelier.i18n.t('addTask');
 * @version-history
 *   v0.12.1 — 2026-10-04 — delegateDeclined (en/fi/es): the agent refused the delegated task.
 *   v0.12.0 — 2026-10-01 — The words of crew, palette, compare and tour (en/fi/es): crewLive (the
 *     count of who is here now), paletteLabel, palettePlaceholder, paletteEmpty, compareLabel and
 *     tourSkip; the tour's Next and Done use the existing next and done. English is the text those
 *     parts drew before.
 *   v0.11.0 — 2026-10-01 — The shop and flow parts' words (en/fi/es): priceTable (price*), cart
 *     (cart*), checkout (co*), thread (thread*), sortable, notices, facets, the calendar's weekday
 *     names (wd0 to wd6), yesterday and earlier. English is the text those parts drew before.
 *     KIT_KEYS exports the key list per language for the parity test.
 *   v0.10.0 — 2026-10-01 — morsels and morsel1 (en/fi/es): the word after a morsel count in the
 *     price parts. Finnish says murunen (1 murunen, {n} murusta), the word the locales use (Jouni,
 *     2026-10-01); English and Spanish say morsels.
 *   v0.9.0 — 2026-10-01 — markPage: <html lang> follows the kit's language from the first paint.
 *     Nothing in the kit set it, so the Design Book preview drew Finnish under lang="en".
 *   v0.8.0 — 2026-09-29 — promptLine1 (en/fi/es): the prompt panel says "1 line", not "1 lines".
 *   v0.7.0 — 2026-09-29 — The prompt panel's words (en/fi/es): its two steps, copy, show and hide,
 *     the paste box, the apply button and the refusal when no JSON object is in the answer.
 *   v0.6.0 — 2026-09-28 — working and done (en/fi/es): what the state button's status says to a
 *     screen reader while the work runs and when it has finished.
 *   v0.5.0 — 2026-09-28 — The workbench pieces' words (en/fi/es): chosen, now, ofTotal and the
 *     five check states a screen reader hears before a tile's title.
 *   v0.4.0 — 2026-09-05 — ambient, ambientOff, ambientCalm, ambientFull (en/fi/es): the weather
 *     switch's name and its three levels, each language composed as itself.
 *   v0.3.0 — 2026-09-02 — lessMotion (en/fi/es): the label of the bar's less-motion switch.
 *   v0.2.1 — 2026-08-28 — copilot* keys become aide* (the component was renamed before any app
 *     uses it), visible titles per language: Aide / Apuri / Ayudante.
 *   v0.2.0 — 2026-08-28 — The aide's words (title, notice, no-AI state, run/confirm) and the
 *     explain-screen title, in all three languages (TARGET-074 phase 6).
 *   v0.1.1 — 2026-08-28 — +signInHint, the shell's default hint on the designed sign-in state.
 *   v0.1.0 — 2026-08-27 — Initial (TARGET-074 phase 1, slice 1).
 */

/** The kit's own strings. A host dictionary of the same shape is merged over this. */
const BASE = {
  en: {
    loading: 'Loading…',
    lessMotion: 'Less motion',
    ambient: 'Ambient',
    ambientOff: 'Off',
    ambientCalm: 'Calm',
    ambientFull: 'Full',
    ready: 'Ready.',
    retry: 'Try again',
    close: 'Close',
    back: 'Back',
    cancel: 'Cancel',
    save: 'Save',
    confirm: 'Confirm',
    search: 'Search',
    menu: 'Menu',
    more: 'More',
    open: 'Open',
    empty: 'Nothing here yet',
    emptyHint: 'What you add will appear here.',
    noResults: 'Nothing matched',
    noResultsHint: 'Try a different word.',
    loadFailed: 'This did not load',
    loadFailedHint: 'Check your connection and try again.',
    signIn: 'Log in to continue.',
    signInHint: 'Use the account button in the top corner.',
    required: 'Required',
    optional: 'Optional',
    total: 'Total',
    you: 'You',
    next: 'Next',
    previous: 'Previous',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fitView: 'Fit to view',
    send: 'Send',
    aideTitle: 'Aide',
    aidePlaceholder: 'Ask, or say what to do…',
    opsOk: 'up',
    opsWarn: 'degraded',
    opsDown: 'down',
    'queue.waiting': 'waiting',
    'queue.running': 'running',
    'queue.done': 'done',
    'queue.failed': 'failed',
    consoleEmpty: 'Nothing logged yet',
    atlasDown: 'The map could not load',
    heatLess: 'less',
    heatMore: 'more',
    today: 'Today',
    m1: 'JAN', m2: 'FEB', m3: 'MAR', m4: 'APR', m5: 'MAY', m6: 'JUN',
    m7: 'JUL', m8: 'AUG', m9: 'SEP', m10: 'OCT', m11: 'NOV', m12: 'DEC',
    aideNotice: 'You are talking with an AI. Answers can be wrong; actions run only when you confirm them.',
    aideNoAi: 'AI is not set up on this account yet. Connect a key under Profile, and the aide wakes up.',
    aideFailed: 'That did not go through. Try again.',
    aideRun: 'Run it',
    aideUnknownAction: 'The model proposed something this app does not declare — nothing was run.',
    explainTitle: 'What this screen holds',
    delegateGo: 'Let AI handle it',
    delegateHanded: 'Handed over',
    delegateFailed: 'The agent could not finish it.',
    delegateDeclined: 'The agent declined it.',
    delegateNoAgents: 'No agent is connected to this account yet.',
    agentActivityNone: 'No agent activity yet.',
    chosen: 'Chosen',
    now: 'Now',
    ofTotal: '{value} of {total}',
    checkOk: 'Done',
    checkTodo: 'Needs you',
    checkFail: 'Failed',
    checkWait: 'In progress',
    checkOptional: 'Optional',
    promptStepCopy: '1. Copy the prompt',
    promptStepCopyOnly: 'Copy the instructions for your AI',
    promptStepPaste: '2. Paste the answer from your AI',
    promptCopy: 'Copy the prompt',
    promptShowAll: 'Show the whole prompt',
    promptHide: 'Hide the prompt',
    promptApply: 'Show the changes',
    promptPastePh: 'Paste the answer here',
    promptLines: '{n} lines', promptLine1: '1 line',
    promptCopied: 'Copied',
    promptNoJson: 'The answer has no JSON object in it. Paste the whole answer.',
    working: 'Working…',
    done: 'Done',
    morsels: '{n} morsels', morsel1: '1 morsel',
    yesterday: 'Yesterday',
    earlier: 'Earlier',
    wd0: 'Sun', wd1: 'Mon', wd2: 'Tue', wd3: 'Wed', wd4: 'Thu', wd5: 'Fri', wd6: 'Sat',
    priceMonth: 'Month', priceYear: 'Year',
    pricePerMonth: '/month', pricePerYear: '/year',
    priceChoose: 'Choose',
    priceMostChosen: 'Most chosen',
    pricePeriods: 'Billing period',
    sortMove: 'Move {label}',
    sortEmpty: 'Nothing to put in order',
    cartRemove: 'Remove',
    cartCheckout: 'Checkout',
    cartFewer: 'One fewer',
    cartMore: 'One more',
    cartEmpty: 'Your cart is empty',
    cartEmptyHint: 'Anything you add shows up here.',
    noticesMarkAll: 'Mark all read',
    noticesEmpty: 'Nothing new',
    noticesEmptyHint: 'Notices land here as they arrive.',
    facetsClear: 'Clear',
    facetsNone: 'No filters', facets1: '1 filter', facetsN: '{n} filters',
    facetsEmpty: 'Nothing to filter by',
    threadSent: 'Sent', threadRead: 'Read', threadFailed: 'Not sent',
    threadLabel: 'Discussion',
    threadEmpty: 'No messages yet',
    threadEmptyHint: 'Write the first one.',
    threadPlaceholder: 'Write a message…',
    coOrder: 'Your order', coDetails: 'Details', coDelivery: 'Delivery', coReview: 'Review',
    coSteps: 'Order steps',
    coName: 'Full name',
    coEmail: 'Email',
    coEmailHint: 'Where the receipt goes.',
    coAddress: 'Street address',
    coPostcode: 'Postcode',
    coCity: 'City',
    coCountry: 'Country',
    coContinue: 'Continue to delivery',
    coItems: 'Items',
    coNoShipping: 'Delivery is agreed after the order is in.',
    coShipLater: 'Chosen after the order',
    coNote: 'A note with the order',
    coNotePlaceholder: 'Anything we should know?',
    coPlace: 'Place order',
    coPlaced: 'Order placed. The receipt is on its way to your email.',
    coNeeded: '{field} is needed before the order can go.',
    coEmailAt: 'An email address has an @ in it.',
    coFailed: 'The order did not go through. Try once more.',
    coEmpty: 'Nothing in the order',
    coEmptyHint: 'Add something and it appears here.',
    crewLive: '{n} here now',
    paletteLabel: 'Commands',
    palettePlaceholder: 'go to, run, adopt…',
    paletteEmpty: 'Nothing matches.',
    compareLabel: 'Compare',
    tourSkip: 'Skip',
  },
  fi: {
    loading: 'Ladataan…',
    lessMotion: 'Vähemmän liikettä',
    ambient: 'Taustaliike',
    ambientOff: 'Pois',
    ambientCalm: 'Rauhallinen',
    ambientFull: 'Täysi',
    ready: 'Valmis.',
    retry: 'Yritä uudelleen',
    close: 'Sulje',
    back: 'Takaisin',
    cancel: 'Peruuta',
    save: 'Tallenna',
    confirm: 'Vahvista',
    search: 'Hae',
    menu: 'Valikko',
    more: 'Lisää',
    open: 'Avaa',
    empty: 'Täällä ei ole vielä mitään',
    emptyHint: 'Lisäämäsi asiat näkyvät tässä.',
    noResults: 'Ei osumia',
    noResultsHint: 'Kokeile toista sanaa.',
    loadFailed: 'Tämä ei latautunut',
    loadFailedHint: 'Tarkista yhteys ja yritä uudelleen.',
    signIn: 'Kirjaudu sisään jatkaaksesi.',
    signInHint: 'Käytä yläkulman tilinappia.',
    required: 'Pakollinen',
    optional: 'Valinnainen',
    total: 'Yhteensä',
    you: 'Sinä',
    next: 'Seuraava',
    previous: 'Edellinen',
    zoomIn: 'Lähennä',
    zoomOut: 'Loitonna',
    fitView: 'Sovita näkymään',
    send: 'Lähetä',
    aideTitle: 'Apuri',
    aidePlaceholder: 'Kysy, tai sano mitä tehdään…',
    opsOk: 'toiminnassa',
    opsWarn: 'takkuaa',
    opsDown: 'nurin',
    'queue.waiting': 'jonossa',
    'queue.running': 'käynnissä',
    'queue.done': 'valmis',
    'queue.failed': 'epäonnistui',
    consoleEmpty: 'Ei vielä lokirivejä',
    atlasDown: 'Kartta ei latautunut',
    heatLess: 'vähän',
    heatMore: 'paljon',
    today: 'Tänään',
    m1: 'TAM', m2: 'HEL', m3: 'MAA', m4: 'HUH', m5: 'TOU', m6: 'KES',
    m7: 'HEI', m8: 'ELO', m9: 'SYY', m10: 'LOK', m11: 'MAR', m12: 'JOU',
    aideNotice: 'Keskustelet tekoälyn kanssa. Vastaus voi olla väärin; toiminnot ajetaan vasta kun vahvistat ne.',
    aideNoAi: 'Tälle tilille ei ole vielä kytketty tekoälyä. Liitä avain profiilissa, niin apuri herää.',
    aideFailed: 'Se ei mennyt läpi. Yritä uudelleen.',
    aideRun: 'Aja',
    aideUnknownAction: 'Malli ehdotti jotain mitä tämä appsi ei tunne — mitään ei ajettu.',
    explainTitle: 'Mitä tällä näytöllä on',
    delegateGo: 'Anna tekoälyn hoitaa',
    delegateHanded: 'Annettu hoidettavaksi',
    delegateFailed: 'Agentti ei saanut sitä valmiiksi.',
    delegateDeclined: 'Agentti kieltäytyi siitä.',
    delegateNoAgents: 'Tähän tiliin ei ole vielä kytketty agenttia.',
    agentActivityNone: 'Ei agenttitoimintaa vielä.',
    chosen: 'Valittu',
    now: 'Nyt',
    ofTotal: '{value} / {total}',
    checkOk: 'Kunnossa',
    checkTodo: 'Tarvitsee sinua',
    checkFail: 'Epäonnistui',
    checkWait: 'Kesken',
    checkOptional: 'Valinnainen',
    promptStepCopy: '1. Kopioi kehote',
    promptStepCopyOnly: 'Kopioi ohje tekoälyllesi',
    promptStepPaste: '2. Liitä tekoälyn vastaus',
    promptCopy: 'Kopioi kehote',
    promptShowAll: 'Näytä koko kehote',
    promptHide: 'Piilota kehote',
    promptApply: 'Näytä muutokset',
    promptPastePh: 'Liitä vastaus tähän',
    promptLines: '{n} riviä', promptLine1: '1 rivi',
    promptCopied: 'Kopioitu',
    promptNoJson: 'Vastauksessa ei ole JSON-oliota. Liitä koko vastaus.',
    working: 'Käsitellään…',
    done: 'Valmis',
    morsels: '{n} murusta', morsel1: '1 murunen',
    yesterday: 'Eilen',
    earlier: 'Aiemmin',
    wd0: 'Su', wd1: 'Ma', wd2: 'Ti', wd3: 'Ke', wd4: 'To', wd5: 'Pe', wd6: 'La',
    priceMonth: 'Kuukausi', priceYear: 'Vuosi',
    pricePerMonth: '/kk', pricePerYear: '/vuosi',
    priceChoose: 'Valitse',
    priceMostChosen: 'Suosituin',
    pricePeriods: 'Laskutusjakso',
    sortMove: 'Siirrä: {label}',
    sortEmpty: 'Ei mitään järjestettävää',
    cartRemove: 'Poista',
    cartCheckout: 'Kassalle',
    cartFewer: 'Yksi vähemmän',
    cartMore: 'Yksi lisää',
    cartEmpty: 'Ostoskori on tyhjä',
    cartEmptyHint: 'Lisäämäsi tuotteet näkyvät tässä.',
    noticesMarkAll: 'Merkitse kaikki luetuiksi',
    noticesEmpty: 'Ei uusia ilmoituksia',
    noticesEmptyHint: 'Uudet ilmoitukset näkyvät tässä.',
    facetsClear: 'Tyhjennä',
    facetsNone: 'Ei suodattimia', facets1: '1 suodatin', facetsN: '{n} suodatinta',
    facetsEmpty: 'Ei mitään suodatettavaa',
    threadSent: 'Lähetetty', threadRead: 'Luettu', threadFailed: 'Ei lähetetty',
    threadLabel: 'Keskustelu',
    threadEmpty: 'Ei vielä viestejä',
    threadEmptyHint: 'Kirjoita ensimmäinen viesti.',
    threadPlaceholder: 'Kirjoita viesti…',
    coOrder: 'Tilauksesi', coDetails: 'Yhteystiedot', coDelivery: 'Toimitus', coReview: 'Yhteenveto',
    coSteps: 'Tilauksen vaiheet',
    coName: 'Koko nimi',
    coEmail: 'Sähköposti',
    coEmailHint: 'Lähetämme kuitin tähän osoitteeseen.',
    coAddress: 'Katuosoite',
    coPostcode: 'Postinumero',
    coCity: 'Postitoimipaikka',
    coCountry: 'Maa',
    coContinue: 'Jatka toimitukseen',
    coItems: 'Tuotteet',
    coNoShipping: 'Toimituksesta sovitaan, kun tilaus on tehty.',
    coShipLater: 'Valitaan tilauksen jälkeen',
    coNote: 'Lisätietoja tilaukseen',
    coNotePlaceholder: 'Onko jotain, mitä meidän pitää tietää?',
    coPlace: 'Tilaa',
    coPlaced: 'Tilaus on tehty. Kuitti tulee sähköpostiisi.',
    coNeeded: 'Täytä tämä ennen kuin tilaat.',
    coEmailAt: 'Sähköpostiosoitteessa on @-merkki.',
    coFailed: 'Tilaus ei mennyt läpi. Yritä uudelleen.',
    coEmpty: 'Tilauksessa ei ole tuotteita',
    coEmptyHint: 'Lisää tuote, niin se näkyy tässä.',
    crewLive: '{n} paikalla nyt',
    paletteLabel: 'Komennot',
    palettePlaceholder: 'siirry, suorita, ota käyttöön…',
    paletteEmpty: 'Ei osumia.',
    compareLabel: 'Vertaa',
    tourSkip: 'Ohita',
  },
  es: {
    loading: 'Cargando…',
    lessMotion: 'Menos movimiento',
    ambient: 'Ambiente',
    ambientOff: 'Apagado',
    ambientCalm: 'Suave',
    ambientFull: 'Completo',
    ready: 'Listo.',
    retry: 'Inténtalo otra vez',
    close: 'Cerrar',
    back: 'Atrás',
    cancel: 'Cancelar',
    save: 'Guardar',
    confirm: 'Confirmar',
    search: 'Buscar',
    menu: 'Menú',
    more: 'Más',
    open: 'Abrir',
    empty: 'Aquí todavía no hay nada',
    emptyHint: 'Lo que añadas aparecerá aquí.',
    noResults: 'Sin coincidencias',
    noResultsHint: 'Prueba con otra palabra.',
    loadFailed: 'Esto no se cargó',
    loadFailedHint: 'Revisa tu conexión e inténtalo otra vez.',
    signIn: 'Inicia sesión para continuar.',
    signInHint: 'Usa el botón de cuenta en la esquina superior.',
    required: 'Obligatorio',
    optional: 'Opcional',
    total: 'Total',
    you: 'Tú',
    next: 'Siguiente',
    previous: 'Anterior',
    zoomIn: 'Acercar',
    zoomOut: 'Alejar',
    fitView: 'Ajustar a la vista',
    send: 'Enviar',
    aideTitle: 'Ayudante',
    aidePlaceholder: 'Pregunta, o di qué hacer…',
    opsOk: 'en marcha',
    opsWarn: 'degradado',
    opsDown: 'caído',
    'queue.waiting': 'en cola',
    'queue.running': 'en curso',
    'queue.done': 'hecho',
    'queue.failed': 'falló',
    consoleEmpty: 'Sin líneas de registro todavía',
    atlasDown: 'El mapa no se cargó',
    heatLess: 'menos',
    heatMore: 'más',
    today: 'Hoy',
    m1: 'ENE', m2: 'FEB', m3: 'MAR', m4: 'ABR', m5: 'MAY', m6: 'JUN',
    m7: 'JUL', m8: 'AGO', m9: 'SEP', m10: 'OCT', m11: 'NOV', m12: 'DIC',
    aideNotice: 'Estás hablando con una IA. Las respuestas pueden fallar; las acciones solo se ejecutan cuando las confirmas.',
    aideNoAi: 'Esta cuenta aún no tiene IA configurada. Conecta una clave en el perfil y el ayudante despierta.',
    aideFailed: 'No ha funcionado. Inténtalo otra vez.',
    aideRun: 'Ejecutar',
    aideUnknownAction: 'El modelo propuso algo que esta app no declara — no se ejecutó nada.',
    explainTitle: 'Qué hay en esta pantalla',
    delegateGo: 'Deja que la IA lo haga',
    delegateHanded: 'Encargado',
    delegateFailed: 'El agente no pudo terminarlo.',
    delegateDeclined: 'El agente lo rechazó.',
    delegateNoAgents: 'Esta cuenta aún no tiene ningún agente conectado.',
    agentActivityNone: 'Sin actividad de agentes todavía.',
    chosen: 'Elegida',
    now: 'Ahora',
    ofTotal: '{value} de {total}',
    checkOk: 'Listo',
    checkTodo: 'Te necesita',
    checkFail: 'Falló',
    checkWait: 'En curso',
    checkOptional: 'Opcional',
    promptStepCopy: '1. Copia la instrucción',
    promptStepCopyOnly: 'Copia las instrucciones para tu IA',
    promptStepPaste: '2. Pega la respuesta de tu IA',
    promptCopy: 'Copiar la instrucción',
    promptShowAll: 'Ver la instrucción completa',
    promptHide: 'Ocultar la instrucción',
    promptApply: 'Ver los cambios',
    promptPastePh: 'Pega aquí la respuesta',
    promptLines: '{n} líneas', promptLine1: '1 línea',
    promptCopied: 'Copiado',
    promptNoJson: 'La respuesta no contiene ningún objeto JSON. Pega la respuesta entera.',
    working: 'Procesando…',
    done: 'Hecho',
    morsels: '{n} morsels', morsel1: '1 morsel',
    yesterday: 'Ayer',
    earlier: 'Antes',
    wd0: 'Dom', wd1: 'Lun', wd2: 'Mar', wd3: 'Mié', wd4: 'Jue', wd5: 'Vie', wd6: 'Sáb',
    priceMonth: 'Mensual', priceYear: 'Anual',
    pricePerMonth: '/mes', pricePerYear: '/año',
    priceChoose: 'Elegir',
    priceMostChosen: 'El más elegido',
    pricePeriods: 'Periodo de facturación',
    sortMove: 'Mover {label}',
    sortEmpty: 'No hay nada que ordenar',
    cartRemove: 'Quitar',
    cartCheckout: 'Ir a pagar',
    cartFewer: 'Uno menos',
    cartMore: 'Uno más',
    cartEmpty: 'Tu carrito está vacío',
    cartEmptyHint: 'Lo que agregues aparece aquí.',
    noticesMarkAll: 'Marcar todo como leído',
    noticesEmpty: 'Nada nuevo',
    noticesEmptyHint: 'Los avisos aparecen aquí cuando llegan.',
    facetsClear: 'Borrar',
    facetsNone: 'Sin filtros', facets1: '1 filtro', facetsN: '{n} filtros',
    facetsEmpty: 'No hay nada para filtrar',
    threadSent: 'Enviado', threadRead: 'Leído', threadFailed: 'No enviado',
    threadLabel: 'Conversación',
    threadEmpty: 'Todavía no hay mensajes',
    threadEmptyHint: 'Escribe el primero.',
    threadPlaceholder: 'Escribe un mensaje…',
    coOrder: 'Tu pedido', coDetails: 'Tus datos', coDelivery: 'Envío', coReview: 'Resumen',
    coSteps: 'Pasos del pedido',
    coName: 'Nombre completo',
    coEmail: 'Correo electrónico',
    coEmailHint: 'Aquí te llega el recibo.',
    coAddress: 'Dirección',
    coPostcode: 'Código postal',
    coCity: 'Ciudad',
    coCountry: 'País',
    coContinue: 'Continuar al envío',
    coItems: 'Productos',
    coNoShipping: 'El envío se acuerda cuando el pedido está hecho.',
    coShipLater: 'Se elige después del pedido',
    coNote: 'Una nota para el pedido',
    coNotePlaceholder: '¿Hay algo que debamos saber?',
    coPlace: 'Realizar pedido',
    coPlaced: 'Pedido realizado. El recibo va en camino a tu correo.',
    coNeeded: 'Completa este dato antes de hacer el pedido.',
    coEmailAt: 'Un correo electrónico lleva una @.',
    coFailed: 'El pedido no se pudo enviar. Inténtalo otra vez.',
    coEmpty: 'El pedido está vacío',
    coEmptyHint: 'Agrega algo y aparece aquí.',
    crewLive: 'Aquí ahora: {n}',
    paletteLabel: 'Comandos',
    palettePlaceholder: 'ir a, ejecutar, adoptar…',
    paletteEmpty: 'Sin coincidencias.',
    compareLabel: 'Comparar',
    tourSkip: 'Omitir',
  },
};

/** Every key the kit ships, per language, for the parity check. */
export const KIT_KEYS = {
  en: Object.keys(BASE.en),
  fi: Object.keys(BASE.fi),
  es: Object.keys(BASE.es),
};

/** Host dictionaries merged in by `use()`, keyed by language. */
const HOST = { en: {}, fi: {}, es: {} };

/** @type {Array<(lang: string) => void>} */
const listeners = [];

let current = detect();

/** Resolve the platform language: auth library → storage key → browser → 'en'. */
function detect() {
  try {
    const ns = /** @type {any} */ (window).AIMEAT;
    if (ns && ns.auth && typeof ns.auth.getLang === 'function') {
      const l = ns.auth.getLang();
      if (l) return String(l).slice(0, 2);
    }
    const stored = localStorage.getItem('aimeat-lang');
    if (stored) return stored.slice(0, 2);
  } catch { /* storage blocked — fall through to the browser */ }
  return (navigator.language || 'en').slice(0, 2);
}

/** The languages the page declares in its aimeat-locales meta, or null when it declares none. */
function declared() {
  try {
    const m = /** @type {HTMLMetaElement|null} */ (document.querySelector('meta[name="aimeat-locales"]'));
    if (!m || !m.content) return null;
    return m.content.split(/[\s,]+/).map(function (c) { return c.trim().toLowerCase(); }).filter(Boolean);
  } catch {
    return null;
  }
}

/** Whether the person chose a language on this origin (the shared `aimeat-lang` key). */
function chosen() {
  try { return !!localStorage.getItem('aimeat-lang'); } catch { return false; }
}

/**
 * Put the language the kit draws in on <html lang>. A page that declares its languages is marked
 * only with one of them; a page that declares none (the Design Book preview) only when the person
 * chose one. A one-language page keeps what the server wrote, and the browser default alone
 * changes nothing.
 * @param {string} lang
 */
function markPage(lang) {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const list = declared();
  if (list ? (list.length < 2 || list.indexOf(lang) < 0) : !chosen()) return;
  try { document.documentElement.setAttribute('lang', lang); } catch { /* no document */ }
}

/** @param {string} lang */
function announce(lang) {
  markPage(lang);
  for (const cb of listeners.slice()) {
    try { cb(lang); } catch { /* one bad listener never stops the rest */ }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('aimeat-lang-change', function (ev) {
    const detail = /** @type {any} */ (ev).detail;
    const lang = (detail && detail.lang) || detect();
    if (lang === current) return;
    current = String(lang).slice(0, 2);
    announce(current);
  });
  // At load, and again once the document is parsed when the meta may still lie below this script.
  markPage(current);
  if (typeof document !== 'undefined' && document.readyState === 'loading' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', function () { markPage(current); });
  }
}

export const i18n = {
  /** The languages the kit itself ships. A host may add more via `use()`. */
  langs: ['en', 'fi', 'es'],

  /** The language in force right now. @returns {string} */
  lang() { return current; },

  /**
   * Set the language for the kit AND the platform (one key, `aimeat-lang`, shared with the site).
   * @param {string} lang
   */
  setLang(lang) {
    const next = String(lang).slice(0, 2);
    if (next === current) return;
    current = next;
    try {
      const ns = /** @type {any} */ (window).AIMEAT;
      if (ns && ns.auth && typeof ns.auth.setLang === 'function') ns.auth.setLang(next);
      else localStorage.setItem('aimeat-lang', next);
    } catch { /* storage blocked — the in-memory language still changed */ }
    announce(current);
  },

  /**
   * Merge the host's dictionary over the kit's. Either `{ en: {...}, fi: {...} }` or a flat
   * object for the current language.
   * @param {Record<string, any>} dict
   */
  use(dict) {
    if (!dict) return;
    const looksNested = Object.keys(dict).every(function (k) {
      return dict[k] && typeof dict[k] === 'object' && !Array.isArray(dict[k]);
    });
    if (looksNested) {
      for (const lang in dict) {
        HOST[lang] = Object.assign({}, HOST[lang] || {}, dict[lang]);
      }
    } else {
      HOST[current] = Object.assign({}, HOST[current] || {}, dict);
    }
    announce(current);
  },

  /**
   * Look up a string: host(current) → kit(current) → kit(en) → the key itself. `{name}` in the
   * text is replaced from `vars`.
   * @param {string} key
   * @param {Record<string, any>} [vars]
   * @returns {string}
   */
  t(key, vars) {
    const text = (HOST[current] && HOST[current][key])
      || (BASE[current] && BASE[current][key])
      || (HOST.en && HOST.en[key])
      || BASE.en[key]
      || key;
    if (!vars) return String(text);
    return String(text).replace(/\{(\w+)\}/g, function (whole, name) {
      return vars[name] == null ? whole : String(vars[name]);
    });
  },

  /**
   * Run a callback whenever the language changes (host `use()` counts — new words arrived).
   * @param {(lang: string) => void} cb
   * @returns {() => void}  stop listening
   */
  onChange(cb) {
    listeners.push(cb);
    return function () {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    };
  },
};

/** Shorthand used inside the kit's own components. @type {(key: string, vars?: any) => string} */
export const t = i18n.t;
