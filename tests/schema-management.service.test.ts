import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import knex, { Knex } from 'knex'
import {
  SchemaManagementService,
  SchemaSyncGuardError,
} from '../src/shared/generic-entity/schema-management.service'
import { CanonicalSchemaDefinition, CanonicalSchemaDefinitionAdapter } from '../src/shared/generic-entity/canonical-schema-definition'
import type { EngineEntityDefinition } from '../src/shared/generic-entity/engine-entity-definition'

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

  const hasUniqueIndexOnColumns = async (tableName: string, columnNames: string[]): Promise<boolean> => {
    const normalizedColumnNames = columnNames.map((columnName) => columnName.toLowerCase())
    const indexes = await db.raw(`PRAGMA index_list('${tableName}')`) as Array<{ name: string; unique: number }>

    for (const index of indexes) {
      if (!index.unique) {
        continue
      }

      const columns = await db.raw(`PRAGMA index_info('${index.name}')`) as Array<{ name: string }>
      const orderedColumns = columns.map((column) => String(column.name).toLowerCase())
      if (
        orderedColumns.length === normalizedColumnNames.length
        && normalizedColumnNames.every((columnName, idx) => orderedColumns[idx] === columnName)
      ) {
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

  it('maps raw configuration rows into canonical schema definitions', async () => {
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
    const definitions = await (service as any).loadCanonicalDefinitionsFromConfiguration()

    expect(definitions).toHaveLength(1)
    expect(definitions[0].logicalName).toBe('User')
    expect(definitions[0].tableName).toBe('user')
    expect(definitions[0].columns[0]).toMatchObject({
      columnName: 'username',
      dataType: 'string',
      nullable: false,
      unique: true,
    })
    expect(definitions[0].relations[0]).toMatchObject({
      relationType: 'manyToOne',
      sourceEntity: 'user',
      targetEntity: 'user',
      foreignKeyColumn: 'account_id',
    })
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

  it('syncs schema from in-memory engine definitions and keeps composite unique constraints idempotent', async () => {
    const definitions: EngineEntityDefinition[] = [
      {
        name: 'Order',
        tableName: 'order_table',
        tableSchema: 'concept_configuration',
        columns: [
          {
            propertyKey: 'tenantId',
            name: 'tenant_id',
            type: 'string',
            nullable: false,
          },
          {
            propertyKey: 'externalCode',
            name: 'external_code',
            type: 'string',
            nullable: false,
          },
        ],
        tableConstraints: [
          {
            type: 'unique',
            columns: ['tenant_id', 'external_code'],
            name: 'order_tenant_external_unique',
          },
        ],
        relations: {
          oneToMany: [],
          manyToOne: [],
          oneToOne: [],
        },
      },
    ]
    const canonicalDefinitions = CanonicalSchemaDefinitionAdapter.fromEngineDefinitions(definitions)

    const service = new SchemaManagementService(db)
    await service.syncFromDefinitions(canonicalDefinitions)
    await service.syncFromDefinitions(canonicalDefinitions)

    const hasOrderTable = await db.schema.hasTable('order_table')
    const hasTenantColumn = await db.schema.hasColumn('order_table', 'tenant_id')
    const hasExternalCodeColumn = await db.schema.hasColumn('order_table', 'external_code')
    const hasCompositeUnique = await hasUniqueIndexOnColumns('order_table', ['tenant_id', 'external_code'])

    expect(hasOrderTable).toBe(true)
    expect(hasTenantColumn).toBe(true)
    expect(hasExternalCodeColumn).toBe(true)
    expect(hasCompositeUnique).toBe(true)
  })

  it('syncs schema from canonical definitions with legacy compatibility path removed from caller', async () => {
    const legacyDefinitions: EngineEntityDefinition[] = [
      {
        name: 'Invoice',
        tableName: 'invoice_table',
        tableSchema: 'concept_configuration',
        columns: [
          {
            propertyKey: 'tenantId',
            name: 'tenant_id',
            type: 'string',
            nullable: false,
          },
          {
            propertyKey: 'invoiceNumber',
            name: 'invoice_number',
            type: 'string',
            nullable: false,
          },
        ],
        tableConstraints: [
          {
            type: 'unique',
            columns: ['tenant_id', 'invoice_number'],
            name: 'invoice_tenant_number_unique',
          },
        ],
        relations: {
          oneToMany: [],
          manyToOne: [],
          oneToOne: [],
        },
      },
    ]

    const canonicalDefinitions: CanonicalSchemaDefinition[] = CanonicalSchemaDefinitionAdapter.fromEngineDefinitions(legacyDefinitions)
    const service = new SchemaManagementService(db)

    await service.syncFromDefinitions(canonicalDefinitions)
    await service.syncFromDefinitions(canonicalDefinitions)

    const hasTable = await db.schema.hasTable('invoice_table')
    const hasTenantColumn = await db.schema.hasColumn('invoice_table', 'tenant_id')
    const hasInvoiceNumberColumn = await db.schema.hasColumn('invoice_table', 'invoice_number')
    const hasCompositeUnique = await hasUniqueIndexOnColumns('invoice_table', ['tenant_id', 'invoice_number'])

    expect(hasTable).toBe(true)
    expect(hasTenantColumn).toBe(true)
    expect(hasInvoiceNumberColumn).toBe(true)
    expect(hasCompositeUnique).toBe(true)
  })

  it('compares desired canonical schema with database and reports structural diffs', async () => {
    await db.schema.createTable('customer_table', (table) => {
      table.increments('id').notNullable()
      table.string('name').notNullable()
    })

    await db.schema.createTable('invoice_table', (table) => {
      table.increments('id').notNullable()
      table.integer('tenant_id').nullable()
    })

    const definitions: CanonicalSchemaDefinition[] = [
      {
        logicalName: 'Invoice',
        tableName: 'invoice_table',
        tableSchema: 'concept_configuration',
        columns: [
          {
            columnName: 'tenant_id',
            dataType: 'string',
            nullable: false,
          },
          {
            columnName: 'invoice_number',
            dataType: 'string',
            nullable: false,
          },
        ],
        tableConstraints: [
          {
            type: 'unique',
            columns: ['tenant_id', 'invoice_number'],
            name: 'invoice_tenant_number_unique',
          },
        ],
        relations: [
          {
            relationType: 'manyToOne',
            sourceEntity: 'invoice_table',
            targetEntity: 'customer_table',
            foreignKeyColumn: 'customer_id',
          },
        ],
      },
      {
        logicalName: 'MissingEntity',
        tableName: 'missing_table',
        tableSchema: 'concept_configuration',
        columns: [
          {
            columnName: 'name',
            dataType: 'string',
            nullable: false,
          },
        ],
        tableConstraints: [],
        relations: [],
      },
      {
        logicalName: 'Customer',
        tableName: 'customer_table',
        tableSchema: 'concept_configuration',
        columns: [
          {
            columnName: 'name',
            dataType: 'string',
            nullable: false,
          },
        ],
        tableConstraints: [],
        relations: [],
      },
    ]

    const service = new SchemaManagementService(db)
    const report = await service.compareDefinitions(definitions)

    expect(report.missingTables).toContainEqual({
      schemaName: 'concept_configuration',
      tableName: 'missing_table',
      logicalName: 'MissingEntity',
    })

    expect(report.missingColumns).toContainEqual(expect.objectContaining({
      schemaName: 'concept_configuration',
      tableName: 'invoice_table',
      columnName: 'invoice_number',
      expectedType: 'string',
      expectedNullable: false,
    }))

    expect(report.columnTypeMismatches).toContainEqual(expect.objectContaining({
      schemaName: 'concept_configuration',
      tableName: 'invoice_table',
      columnName: 'tenant_id',
      expectedType: 'string',
      actualType: 'integer',
    }))

    expect(report.columnNullabilityMismatches).toContainEqual(expect.objectContaining({
      schemaName: 'concept_configuration',
      tableName: 'invoice_table',
      columnName: 'tenant_id',
      expectedNullable: false,
      actualNullable: true,
    }))

    expect(report.missingUniqueConstraints).toContainEqual(expect.objectContaining({
      schemaName: 'concept_configuration',
      tableName: 'invoice_table',
      constraintName: 'invoice_tenant_number_unique',
      columns: ['tenant_id', 'invoice_number'],
    }))

    expect(report.missingRelationColumns).toContainEqual(expect.objectContaining({
      ownerSchemaName: 'concept_configuration',
      ownerTableName: 'invoice_table',
      reference: 'customer_table',
      columnName: 'customer_id',
      unique: false,
    }))

    expect(report.plan.safeActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'createTable',
        risk: 'safe',
        tableName: 'missing_table',
      }),
      expect.objectContaining({
        kind: 'addColumn',
        risk: 'safe',
        tableName: 'invoice_table',
        target: 'invoice_number',
      }),
      expect.objectContaining({
        kind: 'addRelationColumn',
        risk: 'safe',
        tableName: 'invoice_table',
        target: 'customer_id',
      }),
    ]))

    expect(report.plan.destructiveActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'alterColumnType',
        risk: 'destructive',
        tableName: 'invoice_table',
        target: 'tenant_id',
      }),
      expect.objectContaining({
        kind: 'alterColumnNullability',
        risk: 'destructive',
        tableName: 'invoice_table',
        target: 'tenant_id',
      }),
    ]))

    expect(report.plan.summary.totalActions).toBe(
      report.plan.summary.safeActions + report.plan.summary.destructiveActions
    )
    expect(report.plan.summary.destructiveActions).toBeGreaterThan(0)
  })

  it('supports dry-run sync without applying schema changes', async () => {
    const definitions: CanonicalSchemaDefinition[] = [
      {
        logicalName: 'DryRunEntity',
        tableName: 'dry_run_table',
        tableSchema: 'concept_configuration',
        columns: [
          {
            columnName: 'name',
            dataType: 'string',
            nullable: false,
          },
        ],
        tableConstraints: [],
        relations: [],
      },
    ]

    const service = new SchemaManagementService(db)
    const result = await service.syncFromDefinitionsWithPlan(definitions, { dryRun: true })

    const hasTable = await db.schema.hasTable('dry_run_table')
    expect(hasTable).toBe(false)
    expect(result.applied).toBe(false)
    expect(result.report.missingTables).toContainEqual(expect.objectContaining({
      tableName: 'dry_run_table',
    }))
  })

  it('blocks sync when destructive diffs are detected and guardrail is enabled', async () => {
    await db.schema.createTable('guarded_table', (table) => {
      table.increments('id').notNullable()
      table.integer('tenant_id').nullable()
    })

    const definitions: CanonicalSchemaDefinition[] = [
      {
        logicalName: 'Guarded',
        tableName: 'guarded_table',
        tableSchema: 'concept_configuration',
        columns: [
          {
            columnName: 'tenant_id',
            dataType: 'string',
            nullable: false,
          },
          {
            columnName: 'external_code',
            dataType: 'string',
            nullable: false,
          },
        ],
        tableConstraints: [],
        relations: [],
      },
    ]

    const service = new SchemaManagementService(db)

    await expect(service.syncFromDefinitionsWithPlan(definitions, { failOnDestructive: true }))
      .rejects
      .toBeInstanceOf(SchemaSyncGuardError)

    const hasExternalCodeColumn = await db.schema.hasColumn('guarded_table', 'external_code')
    expect(hasExternalCodeColumn).toBe(false)
  })
})
