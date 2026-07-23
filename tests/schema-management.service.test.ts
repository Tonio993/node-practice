import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import knex, { Knex } from 'knex'
import { SchemaManagementService } from '../src/shared/generic-entity/schema-management.service'

describe('schema management service', () => {
  let db: Knex

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    })

    await db.schema.createTable('concept', (table) => {
      table.increments('id').notNullable()
      table.string('name').notNullable().unique()
      table.string('table_name')
      table.string('table_schema')
      table.timestamps(true, true)
    })

    await db.schema.createTable('concept_field', (table) => {
      table.increments('id').notNullable()
      table.integer('id_concept').unsigned().notNullable()
      table.string('name').notNullable()
      table.string('type').notNullable()
      table.boolean('nullable').defaultTo(true)
      table.boolean('unique').defaultTo(false)
      table.string('default_value')
      table.boolean('primary_key').defaultTo(false)
      table.timestamps(true, true)
      table.unique(['id_concept', 'name'])
    })
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('creates a concrete table from concept configuration rows', async () => {
    const conceptId = await db('concept').insert({
      name: 'User',
      table_name: 'user',
      table_schema: 'concept_configuration',
    })

    await db('concept_field').insert([
      {
        id_concept: conceptId[0],
        name: 'username',
        type: 'string',
        nullable: false,
        unique: true,
      },
      {
        id_concept: conceptId[0],
        name: 'password',
        type: 'string',
        nullable: false,
      },
    ])

    const service = new SchemaManagementService(db)
    await service.syncFromConfiguration()

    const hasTable = await db.schema.hasTable('user')
    const hasUsernameColumn = await db.schema.hasColumn('user', 'username')
    const hasPasswordColumn = await db.schema.hasColumn('user', 'password')

    expect(hasTable).toBe(true)
    expect(hasUsernameColumn).toBe(true)
    expect(hasPasswordColumn).toBe(true)
  })
})
