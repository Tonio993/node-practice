import knex, { Knex } from 'knex'
import ClientPgLite from 'knex-pglite'
import path from 'path'
import fs from 'fs/promises'
import { Concept, ConceptField, ConceptRelation } from '../modules/concepts/concept.type'
import { CanonicalSchemaDefinitionAdapter } from '../shared/generic-entity/canonical-schema-definition'
import { SchemaManagementService } from '../shared/generic-entity/schema-management.service'

const databaseDir = path.join(process.cwd(), 'data', 'pgdata')
await fs.mkdir(databaseDir, { recursive: true })

export const db: Knex = knex({
    client: ClientPgLite,
    dialect: 'postgres',
    connection: {
        filename: databaseDir
    },
    useNullAsDefault: true
})

export async function initDb(): Promise<void> {
    await db.schema.createSchemaIfNotExists('concept_configuration')

    const schemaManagementService = new SchemaManagementService(db)
    const staticDefinitions = CanonicalSchemaDefinitionAdapter.fromDecoratedEntities([
        Concept,
        ConceptField,
        ConceptRelation,
    ])

    await schemaManagementService.syncFromDefinitions(staticDefinitions)
    await schemaManagementService.syncFromConfiguration()

    console.log('DB inizializzato')
}