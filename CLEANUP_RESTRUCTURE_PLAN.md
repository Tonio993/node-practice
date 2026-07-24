# Piano Di Pulizia E Ristrutturazione Del Codice

## Obiettivi
- Ridurre complessita e duplicazioni nel layer `generic-entity`.
- Rendere piu leggibili i flussi `configuration -> canonical -> runtime`.
- Migliorare la separazione delle responsabilita tra adapter, engine runtime e DDL manager.
- Mantenere stabilita funzionale con test e typecheck sempre verdi.

## Principi Guida
- Canonical-first: il modello canonico resta il solo modello operativo per il DDL.
- Single responsibility: ogni file/modulo con una responsabilita chiara.
- Refactor incrementale: piccoli passi con verifica continua.
- Nessuna regressione: ogni fase chiude con test completi.

## Stato Di Partenza (Sintesi)
- Step 12 completato: metodi legacy deprecati rimossi nei percorsi runtime.
- Suite test attuale verde.
- `SchemaManagementService` contiene ancora molte responsabilita (mapping, compare, policy, apply).

## Stato Avanzamento
- Fase 1: completata
	- estratte costanti e helper condivisi nel service per client/schema/report vuoto
	- ridotte duplicazioni locali negli adapter canonical/engine
	- validazione eseguita con typecheck e suite completa verdi
- Fase 2: non iniziata
- Fase 3: non iniziata
- Fase 4: non iniziata
- Fase 5: non iniziata
- Fase 6: non iniziata

## Piano In 6 Fasi

### Fase 1 - Quick Wins Di Leggibilita
Priorita: alta
Durata stimata: 0.5-1 giorno

Attivita:
- Uniformare naming interno e ordine dei metodi nei file chiave:
	- `src/shared/generic-entity/schema-management.service.ts`
	- `src/shared/generic-entity/canonical-schema-definition.ts`
	- `src/shared/generic-entity/engine-entity-definition.ts`
- Estrarre costanti locali per stringhe/valori ripetuti (es. default schema, map type aliases).
- Ridurre metodi troppo lunghi spezzando blocchi puramente tecnici in helper privati con nomi espliciti.
- Snellire commenti ridondanti e lasciare solo commenti utili al dominio.

Output:
- File piu scansionabili, meno rumore, zero cambi comportamento.

Acceptance:
- `npx tsc --noEmit` ok
- `npm run test:run` ok

### Fase 2 - Modularizzazione Di SchemaManagementService
Priorita: alta
Durata stimata: 1-2 giorni

Attivita:
- Separare `SchemaManagementService` in moduli collaborativi:
	- `schema-diff.builder.ts` (costruzione report + plan)
	- `schema-policy.guard.ts` (signal/block, allowlist, approval)
	- `schema-apply.executor.ts` (create/alter table, relations, unique)
	- `schema-introspection.repository.ts` (sqlite/postgres metadata)
- Lasciare in `schema-management.service.ts` solo orchestrazione e API pubbliche.

Output:
- Riduzione dimensione service centrale.
- Confini netti tra compare/policy/apply/introspection.

Acceptance:
- Nessuna modifica API pubbliche esistenti.
- Test service invariati o semplificati, tutti verdi.

### Fase 3 - Hardening Tipi E Contratti
Priorita: media
Durata stimata: 1 giorno

Attivita:
- Rafforzare tipi del report/diff evitando `Record<string, any>` dove possibile.
- Introdurre type guards per input non tipizzati provenienti dal db.
- Consolidare mapping type normalization in un modulo dedicato (es. `schema-type-normalizer.ts`).
- Ridurre cast `as any` nei test adapter dove non necessario.

Output:
- Contratti piu robusti e meno punti deboli nel compile-time.

Acceptance:
- Typecheck pulito senza nuovi warning.
- Migliore autocompletamento e minore uso di cast nei punti critici.

### Fase 4 - Pulizia Del Layer Adapter
Priorita: media
Durata stimata: 0.5-1 giorno

Attivita:
- Rendere simmetrica la struttura degli adapter:
	- decorator -> canonical
	- engine -> canonical
	- canonical -> engine
- Centralizzare utilita di naming e normalizzazione relazione dove ci sono pattern duplicati.
- Evitare logiche duplicate tra adapter e service.

Output:
- Adapter piu snelli, meno branching duplicato.

Acceptance:
- Test dedicati adapter (`tests/canonical-schema.*`) invariati o migliorati.

### Fase 5 - Test Suite Snella E Piu Diagnostica
Priorita: alta
Durata stimata: 0.5-1 giorno

Attivita:
- Introdurre helper comuni test per setup sqlite (`concept`, `concept_field`, `concept_relation`).
- Ridurre duplicazione setup in test file:
	- `tests/schema-management.service.test.ts`
	- `tests/canonical-schema.configuration-adapter.test.ts`
- Migliorare nomi test in formato `given/when/then` leggibile.
- Aggiungere test mirato per error messaging policy (guard/approval) con assert del messaggio oltre al tipo.

Output:
- Test piu brevi, piu chiari, piu facili da manutenere.

Acceptance:
- Stesso livello copertura logica.
- Runtime test non peggiora sensibilmente.

### Fase 6 - Documentazione Tecnica Essenziale
Priorita: media
Durata stimata: 0.5 giorno

Attivita:
- Aggiornare il documento architetturale canonical-first con mini migration notes.
- Aggiungere `README` breve nel folder `src/shared/generic-entity/` con:
	- responsabilita dei moduli
	- flussi principali
	- convenzioni naming
- Aggiornare `TODO.md` con checklist di completamento post-pulizia.

Output:
- Onboarding piu rapido e meno conoscenza implicita.

Acceptance:
- Un nuovo contributor riesce a localizzare rapidamente dove intervenire per compare/policy/apply.

## Ordine Consigliato Di Esecuzione
1. Fase 1
2. Fase 2
3. Fase 5
4. Fase 3
5. Fase 4
6. Fase 6

## Strategia Operativa
- Lavorare per micro-PR/commit tematiche (una fase o sottofase per volta).
- Dopo ogni blocco:
	- `npx tsc --noEmit`
	- `npm run test:run`
- Se un refactor tocca compare/policy/apply insieme, introdurre prima test di protezione e poi rifattorizzare.

## Rischi E Mitigazioni
- Rischio: regressioni nel comportamento policy (`signal/block/allowlist/token`).
	- Mitigazione: non cambiare semantica, aggiungere snapshot/assert mirati del report.
- Rischio: perdita di coerenza cross-engine sqlite/postgres.
	- Mitigazione: mantenere test espliciti su reference/schema builder.
- Rischio: over-engineering del refactor.
	- Mitigazione: fermarsi quando leggibilita e responsabilita sono chiare, senza astrarre prematuramente.

## Definition Of Done Della Pulizia
- Service core orchestratore, con moduli separati per compare/policy/apply/introspection.
- Riduzione significativa duplicazioni nei test.
- API pubbliche stabili e documentate.
- Test + typecheck verdi.
