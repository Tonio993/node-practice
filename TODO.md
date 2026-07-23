# Piano tecnico schema management

## Obiettivo
Trasformare il layer attuale da semplice sincronizzazione SQL a un vero schema model layer, in grado di rappresentare il modello configurato in modo indipendente dalle tabelle fisiche.

## Step previsti

1. [COMPLETATO] Introduzione di un modello interno di schema
   - definire `SchemaConcept`, `SchemaField` e `SchemaRelation`
   - includere tipo di relazione, nome della foreign key, tabella/colonna target e `mappedBy`
   - note implementative:
     - introdotto il file `src/shared/generic-entity/schema-definition.ts` con classi dedicate:
       - `SchemaConceptDefinition`
       - `SchemaFieldDefinition`
       - `SchemaRelationDefinition`
     - aggiunti helper di risoluzione nomi (`getResolvedTableName`, `getResolvedTableSchema`) per centralizzare naming e default schema
     - aggiunto test di mapping verso modello interno in `tests/schema-management.service.test.ts`

2. [COMPLETATO] Refactoring del servizio di sincronizzazione
   - separare il mapping delle righe di configurazione dalla loro applicazione sul database
   - rendere il codice più testabile e più facile da estendere
   - note implementative:
     - separato il flusso in due fasi nel servizio:
       - lettura/mapping (`loadConceptDefinitions`, `mapRowsToConceptDefinitions`)
       - applicazione (`applyConceptDefinitions`, `ensureTable`, `ensureRelations`)
     - il servizio ora usa in modo consistente il modello interno invece di oggetti anonimi
     - mantenuta idempotenza della sincronizzazione (creazione solo elementi mancanti)

3. [COMPLETATO] Estensione della logica di relazione
   - gestire `manyToOne`, `oneToMany` e `oneToOne` in modo esplicito
   - decidere se generare una FK, una join o una regola di unicità
   - note implementative:
     - normalizzato `relation_type` in enum logico (`manyToOne`, `oneToMany`, `oneToOne`, `unknown`)
     - regole attuali applicate:
       - `manyToOne`: FK sulla tabella source
       - `oneToMany`: FK sulla tabella target
       - `oneToOne`: FK sulla tabella source con vincolo `unique`
     - introdotta `resolveRelationContext` per separare la decisione semantica dalla DDL
     - aggiunti test dedicati per `oneToMany` e `oneToOne`
   - limite attuale:
     - `manyToMany`/join table non ancora implementato (da coprire negli step successivi)

4. [COMPLETATO] Integrazione con il framework generico
   - far sì che il repository generico possa usare il modello runtime invece di dipendere solo dai decorator statici
   - mantenere il comportamento CRUD invariato
   - note implementative:
    - introdotto `src/shared/generic-entity/engine-entity-definition.ts` con:
       - `EngineEntityDefinition`
       - `EngineRelationDefinition`
       - `EngineEntityDefinitionAdapter` per convertire sia classi decorate `@Entity` sia `SchemaConceptDefinition` nello stesso formato canonico usato dal motore
     - naming aggiornato da `Runtime*` a `Engine*` per evitare ambiguità: le definizioni sono trasversali (statiche + dinamiche), non solo "runtime"
     - semplificato `GenericEntityRepository` per usare una sola tipologia di metadati (`RuntimeEntityDefinition`), eliminando branching interno tra statico e dinamico
     - `GenericEntityFactory` ora normalizza sempre l'input verso la definizione canonica prima di creare repository/service/controller
     - `GenericEntityFactory` rifattorizzata con costruttore monotipo su `EngineEntityDefinition` e factory method espliciti:
       - `fromDecoratedEntity(...)`
       - `fromEngineDefinition(...)`
       per confinare la conversione statica/dinamica al boundary di bootstrap
     - preservato comportamento CRUD e caricamento relazioni (one-to-many, many-to-one, one-to-one)
     - migliorata compatibilità cross-dialect del repository: lo schema viene applicato solo quando supportato dal client (evita `withSchema` su sqlite)
   - validazione:
     - aggiunto test di integrazione runtime in `tests/generic-entity.repository.runtime.test.ts`
     - suite completa test passata

5. [PENDENTE] Aggiunta di un layer di runtime API
   - permettere di creare/aggiornare concetti, campi e relazioni
   - triggerare automaticamente la sincronizzazione dello schema

## Criteri di accettazione
- una relazione configurata produce una struttura coerente nel database
- il servizio ricostruisce il modello senza logiche ad hoc
- il framework generico può usare quel modello senza rompere il comportamento attuale

## Stato di validazione corrente
- test del servizio schema management: passati (`tests/schema-management.service.test.ts`)
- suite completa: passata (`npm run test:run`)
- bootstrap applicazione verificato con avvio server

## Riferimento commit
- milestone implementata nel commit: `c8fc0f6`

## Sequenza consigliata
1. introdurre il modello interno di schema
2. refactoring del servizio
3. espandere la gestione delle relazioni
4. integrare con il repository generico
5. aggiungere API runtime
