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
    - semplificato `GenericEntityRepository` per usare una sola tipologia di metadati (`EngineEntityDefinition`), eliminando branching interno tra statico e dinamico
     - `GenericEntityFactory` ora normalizza sempre l'input verso la definizione canonica prima di creare repository/service/controller
     - `GenericEntityFactory` rifattorizzata con costruttore monotipo su `EngineEntityDefinition` e factory method espliciti:
       - `fromDecoratedEntity(...)`
       - `fromEngineDefinition(...)`
       per confinare la conversione statica/dinamica al boundary di bootstrap
     - preservato comportamento CRUD e caricamento relazioni (one-to-many, many-to-one, one-to-one)
     - migliorata compatibilità cross-dialect del repository: lo schema viene applicato solo quando supportato dal client (evita `withSchema` su sqlite)
   - validazione:
     - aggiunto test di integrazione engine in `tests/generic-entity.repository.engine.test.ts`
     - suite completa test passata

5. [PENDENTE] Aggiunta di un layer di runtime API
   - permettere di creare/aggiornare concetti, campi e relazioni
   - triggerare automaticamente la sincronizzazione dello schema

## Percorso operativo per bootstrap delle tabelle di configurazione via schema manager
1. [COMPLETATO] Estendere il metadata delle entity statiche
  - introdurre metadata di colonna (tipo, nullable, unique, default, primaryKey, columnName)
  - mantenere le relazioni già gestite dai decorator attuali
  - note implementative:
    - esteso `EntityMetadata` con raccolta di colonne in `src/shared/generic-entity/generic-entity.decorator.ts`
    - aggiunto supporto a `ColumnOptions`/`ColumnMetadata` con default automatico di naming snake_case
    - annotato il modello di configurazione in `src/modules/concepts/concept.type.ts` tramite decorator `@Column`
    - aggiunto test di regression in `tests/generic-entity.decorator.test.ts` per il naming automatico (`table_name`, `primary_key`)

2. [COMPLETATO] Estendere la definizione canonica engine
  - aggiungere colonne e vincoli tabella (inclusi unique compositi) alla definizione canonica
  - mantenere compatibilità con `EngineEntityDefinitionAdapter.fromDecoratedEntity(...)` e con le definizioni da concept
  - note implementative:
    - introdotte interfacce `EngineColumnDefinition` ed `EngineTableConstraintDefinition`
    - `EngineEntityDefinition` ora espone `columns` e `tableConstraints`
    - `EngineEntityDefinitionAdapter.fromDecoratedEntity(...)` converte i metadati dei decorator in colonne e vincoli
    - `EngineEntityDefinitionAdapter.fromConcepts(...)` converte anche i campi e vincoli delle definizioni di schema
    - aggiunto test di integrazione in `tests/generic-entity.repository.engine.test.ts`

3. [COMPLETATO] Estendere lo schema manager per input in-memory
  - aggiungere colonne e vincoli tabella (almeno unique compositi)
  - mantenere compatibilità con `EngineEntityDefinitionAdapter.fromDecoratedEntity(...)` e con le definizioni da concept
  - note implementative:
    - aggiunto metodo pubblico `syncFromDefinitions(definitions)` in `SchemaManagementService`
    - conversione da `EngineEntityDefinition` a modello interno (`SchemaConceptDefinition`) con campi, relazioni e vincoli
    - applicazione vincoli unique compositi sia in create table sia in alter table idempotente
    - supporto coerente a `columnName` nella risoluzione delle colonne (`resolveFieldColumnName`)
    - aggiunto test dedicato in `tests/schema-management.service.test.ts` per sync in-memory e idempotenza vincoli

4. [COMPLETATO] Riuso pipeline DDL per sync in-memory
  - il nuovo ingresso `syncFromDefinitions(...)` riusa la stessa pipeline di apply (`ensureTable`, `ensureRelations`)
  - validazione: esecuzione ripetuta non genera duplicazioni di vincoli unique compositi

5. Rifattorizzare il bootstrap in `src/db/knex.ts`
  - mantenere bootstrap minimo: creazione schema `concept_configuration`
  - generare le definizioni delle tabelle statiche (`concept`, `concept_field`, `concept_relation`) dalle entity
  - applicare le definizioni statiche tramite schema manager
  - eseguire poi `syncFromConfiguration()` per le tabelle dinamiche

6. Aggiungere allineamento dati configurativi base (opzionale ma consigliato)
  - seed idempotente per righe minime in `concept`, `concept_field`, `concept_relation`
  - utile per ambienti nuovi dove le tabelle statiche sono create ma il catalogo configurativo è vuoto

7. Coprire i vincoli critici con test dedicati
  - vincoli unique compositi delle tabelle di configurazione
  - gestione timestamps `created_at`/`updated_at`
  - coerenza naming camelCase/snake_case

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

## Roadmap proposta per modello canonico engine DDL + adapter separati

### Obiettivo architetturale
- definire un unico modello canonico usato dal motore DDL per create, alter, drop, compare e sync
- mantenere separati i modelli sorgente per:
  - metadata statici da decorator
  - configurazione runtime da tabelle `concept`, `concept_field`, `concept_relation`
- confinare tutta la conversione verso il modello canonico in adapter espliciti
- evitare che il motore DDL dipenda da dettagli di persistenza del catalogo o da dettagli object-runtime del repository

### Principi di progettazione
1. il modello canonico deve descrivere il desired schema, non la sorgente da cui proviene
2. gli id di configurazione (`concept.id`, `id_concept_source`, `id_concept_target`) non devono entrare nel modello canonico
3. i dettagli puramente runtime lato repository devono restare separati se non servono al DDL
4. le decisioni semantiche sulle relazioni devono essere normalizzate una sola volta, prima di entrare nel motore
5. il motore deve poter lavorare su input provenienti da sorgenti diverse senza branching per sorgente

### Step 1. Definire il perimetro del modello canonico
- stato: [COMPLETATO]
- identificare quali campi servono davvero al motore DDL:
  - nome entità logica
  - `tableName`
  - `tableSchema`
  - colonne con tipo, nullability, default, unique, primaryKey, `columnName`
  - vincoli tabella
  - relazioni in forma sufficiente a derivare foreign key e vincoli associati
- esplicitare quali campi non appartengono al canonico:
  - id del catalogo configurativo
  - riferimenti `sourceConceptId` e `targetConceptId`
  - eventuali dettagli puramente object-level che il DDL non usa direttamente
- output atteso:
  - una specifica scritta nel TODO o in un file dedicato con elenco campi obbligatori, opzionali e invarianti
- output prodotto:
  - specifica formale creata in `src/shared/generic-entity/canonical-ddl-model.spec.md`
  - include: perimetro, campi inclusi, campi esclusi, invarianti, responsabilità DDL, contratto adapter baseline

### Step 2. Scegliere se evolvere `EngineEntityDefinition` o introdurre un nuovo tipo canonico
- stato: [COMPLETATO - DECISIONE E BASELINE IMPLEMENTATA]
- valutare se `EngineEntityDefinition` attuale è già adatto come modello canonico DDL oppure se è troppo orientato al repository
- criteri di scelta:
  - se i campi attuali coprono il DDL senza ambiguità, conviene evolvere `EngineEntityDefinition`
  - se `propertyKey`, bucket relazionali o altre scelte runtime risultano troppo specifiche, conviene introdurre un nuovo modello dedicato, ad esempio `SchemaEngineDefinition` o `CanonicalSchemaDefinition`
- decisione consigliata:
  - preferire un modello canonico esplicitamente orientato al DDL se si prevede supporto futuro a diff, drop, rename, migration planning
  - preferire l’evoluzione di `EngineEntityDefinition` solo se si vuole minimizzare il refactoring e il repository resta allineato alle stesse semantiche
- proposta formalizzata:
  - introdurre un tipo canonico DDL dedicato e mantenere `EngineEntityDefinition` come modello runtime del repository
  - gestire una fase transitoria con adapter esplicito `EngineEntityDefinition -> CanonicalSchemaDefinition`
  - dettaglio proposta in `src/shared/generic-entity/canonical-ddl-model.spec.md` (sezione "Step 2 Proposal")
- note implementative:
  - introdotto il nuovo modello canonico in `src/shared/generic-entity/canonical-schema-definition.ts`
  - aggiunti adapter espliciti:
    - decorator -> canonical (`CanonicalSchemaDefinitionAdapter.fromDecoratedEntity`)
    - concept configuration -> canonical (`CanonicalSchemaDefinitionAdapter.fromConcepts`)
    - engine legacy -> canonical (`CanonicalSchemaDefinitionAdapter.fromEngineDefinitions`)
  - aggiornato `SchemaManagementService.syncFromDefinitions(...)` per accettare input canonico come percorso preferito, mantenendo compatibilità legacy
  - aggiunto test dedicato in `tests/schema-management.service.test.ts` per il percorso canonico

### Step 3. Normalizzare il modello delle relazioni
- definire una rappresentazione relazionale unica per il motore
- evitare che il motore debba conoscere contemporaneamente:
  - relazioni bucketizzate (`oneToMany`, `manyToOne`, `oneToOne`)
  - relazioni catalog-based con source/target per id
- decidere una forma canonica unica, ad esempio una lista piatta di relazioni con:
  - `relationType`
  - entità sorgente
  - entità target
  - colonna FK
  - `mappedBy`
  - eventuale indicazione di ownership o derivabilità della FK
- beneficio:
  - il motore DDL calcola una sola volta il contesto applicativo della relazione e non dipende dalla sorgente del dato

### Step 4. Separare il modello canonico dai modelli sorgente
- mantenere `schema-definition.ts` come modello della configurazione persistita, non come modello operativo del motore
- mantenere i metadata da decorator come modello sorgente statico, già espresso in `generic-entity.decorator.ts`
- introdurre adapter espliciti:
  - decorator -> modello canonico
  - configurazione runtime -> modello canonico
- facoltativo ma consigliato:
  - introdurre tipi nominali o file distinti per rendere visibile a colpo d’occhio cosa è sorgente e cosa è canonico

### Step 5. Rifattorizzare `SchemaManagementService` per lavorare nativamente sul modello canonico
- obiettivo intermedio:
  - `syncFromConfiguration()` legge le righe di configurazione e le converte subito nel modello canonico
  - `syncFromDefinitions()` accetta direttamente il modello canonico oppure lo riceve tramite adapter
- modifiche previste:
  - eliminare la dipendenza interna primaria da `SchemaConceptDefinition` come shape di lavoro del DDL
  - sostituire `applyConceptDefinitions(...)` con una pipeline che lavori sul modello canonico
  - riscrivere `ensureTable`, `ensureRelations`, `ensureUniqueConstraints` per dipendere solo dal modello canonico
- beneficio:
  - un solo linguaggio interno per tutto il motore schema

### Step 6. Ridurre o eliminare la conversione inversa engine -> concept
- il metodo `mapEngineDefinitionsToConceptDefinitions(...)` in `schema-management.service.ts` è un sintomo dell’attuale doppio modello operativo
- target architetturale:
  - il motore non deve più convertire il modello canonico in `SchemaConceptDefinition` per poter applicare DDL
- risultato atteso:
  - `SchemaConceptDefinition` resta utile solo per rappresentare righe lette dal catalogo o per casi in cui si debba persistere la configurazione

### Step 7. Riallineare il repository generic entity rispetto al nuovo confine
- decidere se il repository deve continuare a usare `EngineEntityDefinition` attuale oppure una proiezione runtime del modello canonico
- approccio consigliato:
  - se il repository richiede ancora `propertyKey` e struttura bucketizzata delle relazioni, mantenere un modello runtime separato
  - aggiungere un adapter canonico -> runtime repository solo se necessario
- beneficio:
  - evitare che esigenze CRUD contaminino il modello DDL

### Step 8. Rifattorizzare il bootstrap delle tabelle statiche
- aggiornare il bootstrap in `src/db/knex.ts` in modo che:
  - le entity statiche decorate siano convertite nel modello canonico
  - il motore DDL applichi il modello canonico per creare o allineare le tabelle statiche
  - successivamente la configurazione runtime venga letta, convertita nel modello canonico e sincronizzata
- obiettivo:
  - stessa pipeline per statico e dinamico, cambiano solo gli adapter di ingresso

### Step 9. Introdurre supporto esplicito al compare/diff
- una volta ottenuto il modello canonico, aggiungere una fase esplicita di confronto tra:
  - stato desiderato
  - stato reale del database
- questo step è importante perché giustifica davvero il valore del modello unico
- capacità da prevedere:
  - rilevazione colonne mancanti
  - rilevazione vincoli mancanti
  - rilevazione differenze di tipo o nullability
  - pianificazione di alter safe vs destructive

### Step 10. Formalizzare i limiti sulle operazioni distruttive
- prima di introdurre `drop`, `rename` o alter distruttivi, definire policy esplicite:
  - quali operazioni sono automatiche
  - quali sono solo segnalate in diff
  - quali richiedono conferma o migration esplicita
- questo evita che il modello canonico venga interpretato come licenza a sincronizzare in modo distruttivo senza regole

### Step 11. Allineare i test per livelli di responsabilità
- separare i test in tre blocchi:
  - test degli adapter decorator -> canonico
  - test degli adapter configurazione -> canonico
  - test del motore DDL sul modello canonico
- aggiungere casi specifici per:
  - naming `camelCase`/`snake_case`
  - relazioni `manyToOne`, `oneToMany`, `oneToOne`
  - vincoli unique singoli e compositi
  - idempotenza della sync
  - compatibilità sqlite vs postgres per schema e reference

### Step 12. Deprecare gradualmente il modello operativo precedente
- una volta che il motore usa stabilmente il canonico:
  - ridurre progressivamente i punti in cui `SchemaConceptDefinition` viene usato come modello di lavoro
  - lasciare `SchemaConceptDefinition` e correlati come representation layer della configurazione
  - aggiornare naming e documentazione per chiarire il confine tra:
    - modello canonico DDL
    - modello configurativo persistito
    - eventuale modello runtime repository

### Ordine di implementazione consigliato
1. definire la shape del modello canonico e le invarianti
2. decidere se riusare `EngineEntityDefinition` o introdurre un nuovo tipo canonico
3. implementare gli adapter sorgente -> canonico
4. portare `SchemaManagementService` a lavorare direttamente sul canonico
5. rimuovere la conversione canonico -> `SchemaConceptDefinition` dal percorso DDL
6. riallineare bootstrap e punti di ingresso statici/dinamici
7. aggiungere compare/diff come capacità nativa del motore
8. consolidare test e documentazione

### Benefici attesi
- una sola pipeline DDL per statico e dinamico
- minore ridondanza semantica tra modello configurativo e modello motore
- minore accoppiamento tra catalogo configurativo, decorator e motore DDL
- base più pulita per funzionalità future come compare, planning e sync non distruttiva
- test più leggibili perché separano sorgente, adattamento e applicazione

### Rischi e attenzioni
- rischio di usare come modello canonico una shape troppo orientata al CRUD runtime
- rischio di introdurre un doppio canone nascosto se repository e DDL restano troppo diversi
- rischio di mischiare nel canonico dettagli del catalogo che non servono al motore
- necessità di fissare in anticipo la semantica delle relazioni e delle operazioni distruttive
