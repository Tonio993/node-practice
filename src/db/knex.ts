import knex, { Knex } from 'knex'
import ClientPgLite from 'knex-pglite'
import path from 'path'
import fs from 'fs/promises'

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

    // CONCEPT_CONFIGURATION.CONCEPT
    if (!await db.schema.withSchema('concept_configuration').hasTable('concept')) {
        await db.schema.withSchema('concept_configuration').createTable('concept', (t) => {
            t.increments('id').notNullable()
            t.string('name').unique().notNullable()
            t.timestamps(true, true) // created_at, updated_at
        })
    }

    // CONCEPT_CONFIGURATOIN.CONCEPT_FIELD
    if (!await db.schema.withSchema('concept_configuration').hasTable('concept_field')) {
        await db.schema.withSchema('concept_configuration').createTable('concept_field', (t) => {
            t.increments('id').notNullable()
            t.integer('id_concept').unsigned().notNullable()
            t.foreign('id_concept').references('id').inTable('concept_configuration.concept')
            t.string('name').notNullable()
            t.string('type').notNullable()
            t.timestamps(true, true)

            t.unique(['id_concept', 'name'])
        })
    }

    console.log('DB inizializzato')
}