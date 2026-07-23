import knex, { Knex } from 'knex'
import ClientPgLite from 'knex-pglite'
import path from 'path'
import fs from 'fs/promises'
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

    // CONCEPT_CONFIGURATION.CONCEPT
    if (!await db.schema.withSchema('concept_configuration').hasTable('concept')) {
        await db.schema.withSchema('concept_configuration').createTable('concept', (t) => {
            t.increments('id').notNullable()
            t.string('name').unique().notNullable()
            t.string('table_name')
            t.string('table_schema')
            t.timestamps(true, true) // created_at, updated_at
        })
    } else {
        const hasTableName = await db.schema.withSchema('concept_configuration').hasColumn('concept', 'table_name')
        const hasTableSchema = await db.schema.withSchema('concept_configuration').hasColumn('concept', 'table_schema')

        if (!hasTableName || !hasTableSchema) {
            await db.schema.withSchema('concept_configuration').alterTable('concept', (t) => {
                if (!hasTableName) {
                    t.string('table_name').nullable()
                }
                if (!hasTableSchema) {
                    t.string('table_schema').nullable()
                }
            })
        }
    }

    // CONCEPT_CONFIGURATOIN.CONCEPT_FIELD
    if (!await db.schema.withSchema('concept_configuration').hasTable('concept_field')) {
        await db.schema.withSchema('concept_configuration').createTable('concept_field', (t) => {
            t.increments('id').notNullable()
            t.integer('id_concept').unsigned().notNullable()
            t.foreign('id_concept').references('id').inTable('concept_configuration.concept')
            t.string('name').notNullable()
            t.string('type').notNullable()
            t.boolean('nullable').defaultTo(true)
            t.boolean('unique').defaultTo(false)
            t.string('default_value')
            t.boolean('primary_key').defaultTo(false)
            t.timestamps(true, true)

            t.unique(['id_concept', 'name'])
        })
    } else {
        const hasNullable = await db.schema.withSchema('concept_configuration').hasColumn('concept_field', 'nullable')
        const hasUnique = await db.schema.withSchema('concept_configuration').hasColumn('concept_field', 'unique')
        const hasDefaultValue = await db.schema.withSchema('concept_configuration').hasColumn('concept_field', 'default_value')
        const hasPrimaryKey = await db.schema.withSchema('concept_configuration').hasColumn('concept_field', 'primary_key')

        if (!hasNullable || !hasUnique || !hasDefaultValue || !hasPrimaryKey) {
            await db.schema.withSchema('concept_configuration').alterTable('concept_field', (t) => {
                if (!hasNullable) {
                    t.boolean('nullable').defaultTo(true)
                }
                if (!hasUnique) {
                    t.boolean('unique').defaultTo(false)
                }
                if (!hasDefaultValue) {
                    t.string('default_value').nullable()
                }
                if (!hasPrimaryKey) {
                    t.boolean('primary_key').defaultTo(false)
                }
            })
        }
    }

    const schemaManagementService = new SchemaManagementService(db)
    await schemaManagementService.syncFromConfiguration()

    console.log('DB inizializzato')
}