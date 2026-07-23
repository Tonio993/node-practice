# Piano tecnico schema management

## Obiettivo
Trasformare il layer attuale da semplice sincronizzazione SQL a un vero schema model layer, in grado di rappresentare il modello configurato in modo indipendente dalle tabelle fisiche.

## Step previsti

1. Introduzione di un modello interno di schema
   - definire `SchemaConcept`, `SchemaField` e `SchemaRelation`
   - includere tipo di relazione, nome della foreign key, tabella/colonna target e `mappedBy`

2. Refactoring del servizio di sincronizzazione
   - separare il mapping delle righe di configurazione dalla loro applicazione sul database
   - rendere il codice più testabile e più facile da estendere

3. Estensione della logica di relazione
   - gestire `manyToOne`, `oneToMany` e `oneToOne` in modo esplicito
   - decidere se generare una FK, una join o una regola di unicità

4. Integrazione con il framework generico
   - far sì che il repository generico possa usare il modello runtime invece di dipendere solo dai decorator statici
   - mantenere il comportamento CRUD invariato

5. Aggiunta di un layer di runtime API
   - permettere di creare/aggiornare concetti, campi e relazioni
   - triggerare automaticamente la sincronizzazione dello schema

## Criteri di accettazione
- una relazione configurata produce una struttura coerente nel database
- il servizio ricostruisce il modello senza logiche ad hoc
- il framework generico può usare quel modello senza rompere il comportamento attuale

## Sequenza consigliata
1. introdurre il modello interno di schema
2. refactoring del servizio
3. espandere la gestione delle relazioni
4. integrare con il repository generico
5. aggiungere API runtime
