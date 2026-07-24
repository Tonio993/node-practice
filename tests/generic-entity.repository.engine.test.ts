import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import knex, { Knex } from 'knex'
import { GenericEntityRepository } from '../src/shared/generic-entity/generic-entity.repository'
import { EngineEntityDefinitionAdapter } from '../src/shared/generic-entity/engine-entity-definition'
import { Column, Entity } from '../src/shared/generic-entity/generic-entity.decorator'
import { SchemaConceptDefinition, SchemaRelationDefinition } from '../src/shared/generic-entity/schema-definition'

describe('generic entity repository engine integration', () => {
  let db: Knex

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    })

    await db.schema.createTable('company', (table) => {
      table.increments('id').notNullable()
      table.string('name').notNullable()
      table.timestamps(true, true)
    })

    await db.schema.createTable('employee', (table) => {
      table.increments('id').notNullable()
      table.string('name').notNullable()
      table.integer('company_id').unsigned().references('id').inTable('company')
      table.timestamps(true, true)
    })
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('loads one-to-many and many-to-one relations from engine model metadata', async () => {
    const [companyAId] = await db('company').insert({ name: 'Company A' }) as number[]
    const [companyBId] = await db('company').insert({ name: 'Company B' }) as number[]

    await db('employee').insert([
      { name: 'Alice', company_id: companyAId },
      { name: 'Bob', company_id: companyAId },
      { name: 'Carla', company_id: companyBId },
    ])

    const concepts = buildCompanyEmployeeConcepts()
    const engineDefinitions = EngineEntityDefinitionAdapter.fromConcepts(concepts)

    const companyDefinition = engineDefinitions.find((definition) => definition.tableName === 'company')
    const employeeDefinition = engineDefinitions.find((definition) => definition.tableName === 'employee')

    expect(companyDefinition).toBeDefined()
    expect(employeeDefinition).toBeDefined()

    const companyRepo = new GenericEntityRepository<any>(db, companyDefinition!)
    const employeeRepo = new GenericEntityRepository<any>(db, employeeDefinition!)

    const companies = await companyRepo.findAll()
    const employees = await employeeRepo.findAll()

    const companyA = companies.find((company) => company.id === companyAId)
    const companyB = companies.find((company) => company.id === companyBId)

    expect(companyA?.employees).toHaveLength(2)
    expect(companyB?.employees).toHaveLength(1)

    const alice = employees.find((employee) => employee.name === 'Alice')
    const carla = employees.find((employee) => employee.name === 'Carla')

    expect(alice?.company?.name).toBe('Company A')
    expect(carla?.company?.name).toBe('Company B')
  })

  it('persists many-to-one relation payload using engine metadata', async () => {
    const [companyId] = await db('company').insert({ name: 'Company A' }) as number[]

    const concepts = buildCompanyEmployeeConcepts()
    const engineDefinitions = EngineEntityDefinitionAdapter.fromConcepts(concepts)
    const employeeDefinition = engineDefinitions.find((definition) => definition.tableName === 'employee')

    expect(employeeDefinition).toBeDefined()

    new GenericEntityRepository<any>(db, engineDefinitions.find((definition) => definition.tableName === 'company')!)
    const employeeRepo = new GenericEntityRepository<any>(db, employeeDefinition!)

    const created = await employeeRepo.insert({
      name: 'Diana',
      company: { id: companyId },
    })

    expect(created.company?.id).toBe(companyId)

    const saved = await db('employee').where({ id: created.id }).first()
    expect(saved.company_id).toBe(companyId)
  })

  it('maps decorated entity columns and table constraints into the engine definition', () => {
    @Entity({
      tableName: 'audit_event',
      tableConstraints: [{
        type: 'unique',
        columns: ['tenant_id', 'event_type'],
        name: 'audit_event_tenant_event_unique',
      }],
    })
    class AuditEvent {
      @Column({ nullable: false })
      tenantId!: string

      @Column({ nullable: false })
      eventType!: string
    }

    const definition = EngineEntityDefinitionAdapter.fromDecoratedEntity(AuditEvent)

    expect(definition.columns).toHaveLength(2)
    expect(definition.columns[0]).toMatchObject({
      propertyKey: 'tenantId',
      name: 'tenant_id',
      nullable: false,
      type: 'string',
    })
    expect(definition.columns[1]).toMatchObject({
      propertyKey: 'eventType',
      name: 'event_type',
      nullable: false,
      type: 'string',
    })
    expect(definition.tableConstraints).toEqual([
      {
        type: 'unique',
        columns: ['tenant_id', 'event_type'],
        name: 'audit_event_tenant_event_unique',
      },
    ])
  })
})

function buildCompanyEmployeeConcepts(): SchemaConceptDefinition[] {
  const companyConcept = new SchemaConceptDefinition(
    1,
    'Company',
    'company',
    null,
    [],
    [
      new SchemaRelationDefinition(
        1,
        1,
        2,
        'oneToMany',
        'company_id',
        'company',
        'employees',
        'company'
      ),
    ]
  )

  const employeeConcept = new SchemaConceptDefinition(
    2,
    'Employee',
    'employee',
    null,
    [],
    [
      new SchemaRelationDefinition(
        2,
        2,
        1,
        'manyToOne',
        'company_id',
        'employees',
        'company',
        'employees'
      ),
    ]
  )

  return [companyConcept, employeeConcept]
}
