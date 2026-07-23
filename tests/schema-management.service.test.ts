import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import knex, { Knex } from 'knex'
import { SchemaManagementService } from '../src/shared/generic-entity/schema-management.service'
import { SchemaConceptDefinition, SchemaFieldDefinition, SchemaRelationDefinition } from '../src/shared/generic-entity/schema-definition'

describe('schema management service', () => {
  let db: Knex

  const hasUniqueIndexOnColumn = async (tableName: string, columnName: string): Promise<boolean> => {
    const indexes = await db.raw(`PRAGMA index_list('${tableName}')`) as Array<{ name: string; unique: number }>
    for (const index of indexes) {
      if (!index.unique) {
        continue
      }
      const columns = await db.raw(`PRAGMA index_info('${index.name}')`) as Array<{ name: string }>
      if (columns.some((column) => column.name === columnName)) {
        return true
      }
    }

    return false
  }

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
      table.string('column_name')
      table.string('label')
      table.string('description')
      table.integer('position')
      table.timestamps(true, true)
      table.unique(['id_concept', 'name'])
    })

    await db.schema.createTable('concept_relation', (table) => {
      table.increments('id').notNullable()
      table.integer('id_concept_source').unsigned().notNullable()
      table.integer('id_concept_target').unsigned().notNullable()
      table.string('relation_type').notNullable()
      table.string('foreign_key').notNullable()
      table.string('mapped_by')
      table.string('source_field')
      table.string('target_field')
      table.timestamps(true, true)
    })
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('maps raw configuration rows into an internal schema model', async () => {
    const conceptId = await db('concept').insert({
      name: 'User',
      table_name: 'user',
      table_schema: 'concept_configuration',
    })

    await db('concept_field').insert({
      id_concept: conceptId[0],
      name: 'username',
      type: 'string',
      nullable: false,
      unique: true,
    })

    await db('concept_relation').insert({
      id_concept_source: conceptId[0],
      id_concept_target: conceptId[0],
      relation_type: 'manyToOne',
      foreign_key: 'account_id',
    })

    const service = new SchemaManagementService(db)
    const concepts = await (service as any).loadConceptDefinitions()

    expect(concepts[0]).toBeInstanceOf(SchemaConceptDefinition)
    expect(concepts[0].fields[0]).toBeInstanceOf(SchemaFieldDefinition)
    expect(concepts[0].relations[0]).toBeInstanceOf(SchemaRelationDefinition)
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

  it('creates foreign key columns from concept relations', async () => {
    const [accountId] = await db('concept').insert({
      name: 'Account',
      table_name: 'account',
      table_schema: 'concept_configuration',
    }) as number[]

    const [userId] = await db('concept').insert({
      name: 'User',
      table_name: 'user',
      table_schema: 'concept_configuration',
    }) as number[]

    await db('concept_relation').insert({
      id_concept_source: userId,
      id_concept_target: accountId,
      relation_type: 'manyToOne',
      foreign_key: 'account_id',
    })

    const service = new SchemaManagementService(db)
    await service.syncFromConfiguration()

    const hasAccountIdColumn = await db.schema.hasColumn('user', 'account_id')

    expect(hasAccountIdColumn).toBe(true)
  })

  it('creates one-to-many foreign key on target concept table', async () => {
    const [companyId] = await db('concept').insert({
      name: 'Company',
      table_name: 'company',
      table_schema: 'concept_configuration',
    }) as number[]

    const [employeeId] = await db('concept').insert({
      name: 'Employee',
      table_name: 'employee',
      table_schema: 'concept_configuration',
    }) as number[]

    await db('concept_relation').insert({
      id_concept_source: companyId,
      id_concept_target: employeeId,
      relation_type: 'oneToMany',
      foreign_key: 'company_id',
    })

    const service = new SchemaManagementService(db)
    await service.syncFromConfiguration()

    const hasCompanyIdColumn = await db.schema.hasColumn('employee', 'company_id')
    const hasWrongColumnOnCompany = await db.schema.hasColumn('company', 'employee_id')

    expect(hasCompanyIdColumn).toBe(true)
    expect(hasWrongColumnOnCompany).toBe(false)
  })

  it('creates unique foreign key for one-to-one relation', async () => {
    const [profileId] = await db('concept').insert({
      name: 'Profile',
      table_name: 'profile',
      table_schema: 'concept_configuration',
    }) as number[]

    const [userId] = await db('concept').insert({
      name: 'User',
      table_name: 'user',
      table_schema: 'concept_configuration',
    }) as number[]

    await db('concept_relation').insert({
      id_concept_source: userId,
      id_concept_target: profileId,
      relation_type: 'oneToOne',
      foreign_key: 'profile_id',
    })

    const service = new SchemaManagementService(db)
    await service.syncFromConfiguration()

    const hasProfileIdColumn = await db.schema.hasColumn('user', 'profile_id')
    const hasUniqueIndex = await hasUniqueIndexOnColumn('user', 'profile_id')

    expect(hasProfileIdColumn).toBe(true)
    expect(hasUniqueIndex).toBe(true)
  })
})
