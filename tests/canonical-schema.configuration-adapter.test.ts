import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import knex, { Knex } from 'knex'
import { SchemaManagementService } from '../src/shared/generic-entity/schema-management.service'

describe('configuration to canonical adapter', () => {
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

  it('maps configuration rows into canonical definitions with normalized names', async () => {
    const conceptId = await db('concept').insert({
      name: 'UserProfile',
      table_name: 'UserProfile',
      table_schema: 'concept_configuration',
    })

    await db('concept_field').insert({
      id_concept: conceptId[0],
      name: 'tenantId',
      type: 'string',
      nullable: false,
      unique: true,
      column_name: 'TenantId',
    })

    await db('concept_relation').insert({
      id_concept_source: conceptId[0],
      id_concept_target: conceptId[0],
      relation_type: 'manyToOne',
      foreign_key: 'AccountId',
    })

    const service = new SchemaManagementService(db)
    const definitions = await (service as any).loadCanonicalDefinitionsFromConfiguration()

    expect(definitions).toHaveLength(1)
    expect(definitions[0].logicalName).toBe('UserProfile')
    expect(definitions[0].tableName).toBe('user_profile')
    expect(definitions[0].columns[0]).toMatchObject({
      columnName: 'tenant_id',
      dataType: 'string',
      nullable: false,
      unique: true,
    })
    expect(definitions[0].relations[0]).toMatchObject({
      relationType: 'manyToOne',
      sourceEntity: 'user_profile',
      targetEntity: 'user_profile',
      foreignKeyColumn: 'account_id',
    })
  })

  it('maps oneToMany and oneToOne relations and applies fallback foreign key naming', async () => {
    const [companyId] = await db('concept').insert({
      name: 'Company',
      table_name: 'Company',
      table_schema: 'concept_configuration',
    }) as number[]

    const [employeeId] = await db('concept').insert({
      name: 'Employee',
      table_name: 'Employee',
      table_schema: 'concept_configuration',
    }) as number[]

    const [profileId] = await db('concept').insert({
      name: 'ProfileCard',
      table_name: 'ProfileCard',
      table_schema: 'concept_configuration',
    }) as number[]

    await db('concept_field').insert([
      {
        id_concept: companyId,
        name: 'displayName',
        type: 'string',
        nullable: false,
        unique: true,
      },
      {
        id_concept: employeeId,
        name: 'employeeCode',
        type: 'string',
        nullable: false,
      },
    ])

    await db('concept_relation').insert([
      {
        id_concept_source: companyId,
        id_concept_target: employeeId,
        relation_type: 'oneToMany',
        foreign_key: 'CompanyId',
      },
      {
        id_concept_source: employeeId,
        id_concept_target: profileId,
        relation_type: 'oneToOne',
        foreign_key: '   ',
      },
    ])

    const service = new SchemaManagementService(db)
    const definitions = await (service as any).loadCanonicalDefinitionsFromConfiguration()

    const companyDefinition = definitions.find((definition: any) => definition.logicalName === 'Company')
    const employeeDefinition = definitions.find((definition: any) => definition.logicalName === 'Employee')

    expect(companyDefinition).toBeDefined()
    expect(employeeDefinition).toBeDefined()

    expect(companyDefinition.columns).toEqual(expect.arrayContaining([
      expect.objectContaining({
        columnName: 'display_name',
        unique: true,
      }),
    ]))

    expect(companyDefinition.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        relationType: 'oneToMany',
        sourceEntity: 'company',
        targetEntity: 'employee',
        foreignKeyColumn: 'company_id',
      }),
    ]))

    expect(employeeDefinition.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        relationType: 'oneToOne',
        sourceEntity: 'employee',
        targetEntity: 'profile_card',
        foreignKeyColumn: 'profile_card_id',
      }),
    ]))
  })
})
