import { describe, expect, it } from 'vitest'
import {
  CanonicalSchemaDefinition,
  CanonicalSchemaDefinitionAdapter,
} from '../src/shared/generic-entity/canonical-schema-definition'
import type { EngineEntityDefinition } from '../src/shared/generic-entity/engine-entity-definition'

describe('canonical schema definition adapter normalization', () => {
  it('normalizes and flattens engine relation metadata into canonical relations', () => {
    const engineDefinitions: EngineEntityDefinition[] = [
      {
        name: 'User',
        tableName: 'UserProfile',
        tableSchema: ' concept_configuration ',
        columns: [
          {
            propertyKey: 'tenantId',
            name: 'TenantId',
            type: 'string',
            nullable: false,
          },
        ],
        tableConstraints: [
          {
            type: 'unique',
            columns: ['TenantId'],
            name: 'tenant_unique',
          },
        ],
        relations: {
          oneToMany: [
            {
              propertyKey: 'orders',
              targetTableName: 'OrderTable',
              foreignKey: 'UserId',
              mappedBy: 'user',
            },
            {
              propertyKey: 'orders',
              targetTableName: 'OrderTable',
              foreignKey: 'UserId',
              mappedBy: 'user',
            },
          ],
          manyToOne: [],
          oneToOne: [],
        },
      },
    ]

    const definitions = CanonicalSchemaDefinitionAdapter.fromEngineDefinitions(engineDefinitions)

    expect(definitions).toHaveLength(1)
    const userDefinition = definitions[0]

    expect(userDefinition.tableName).toBe('user_profile')
    expect(userDefinition.tableSchema).toBe('concept_configuration')
    expect(userDefinition.columns[0].columnName).toBe('tenant_id')
    expect(userDefinition.tableConstraints[0].columns).toEqual(['tenant_id'])

    expect(userDefinition.relations).toHaveLength(1)
    expect(userDefinition.relations[0]).toMatchObject({
      relationType: 'oneToMany',
      sourceEntity: 'user_profile',
      targetEntity: 'order_table',
      foreignKeyColumn: 'user_id',
      mappedBy: 'user',
      sourceField: 'orders',
      targetField: 'user',
    })
  })

  it('normalizes canonical relationType and defaults sourceEntity when missing', () => {
    const definitions: CanonicalSchemaDefinition[] = [
      {
        logicalName: 'Invoice',
        tableName: 'invoice_table',
        tableSchema: 'concept_configuration',
        columns: [
          {
            columnName: 'invoice_number',
            dataType: 'string',
          },
        ],
        tableConstraints: [],
        relations: [
          {
            relationType: 'unknown',
            sourceEntity: '  ',
            targetEntity: 'ProfileEntity',
            foreignKeyColumn: '  ',
          },
          {
            relationType: 'manyToOne',
            sourceEntity: 'invoice_table',
            targetEntity: 'CustomerEntity',
            foreignKeyColumn: 'customerId',
          },
        ],
      },
    ]

    const normalized = CanonicalSchemaDefinitionAdapter.normalizeDefinitions(definitions)

    expect(normalized).toHaveLength(1)
    expect(normalized[0].relations).toHaveLength(2)
    expect(normalized[0].relations[0]).toMatchObject({
      relationType: 'unknown',
      sourceEntity: 'invoice_table',
      targetEntity: 'profile_entity',
      foreignKeyColumn: 'profile_entity_id',
    })
    expect(normalized[0].relations[1]).toMatchObject({
      relationType: 'manyToOne',
      sourceEntity: 'invoice_table',
      targetEntity: 'customer_entity',
      foreignKeyColumn: 'customer_id',
    })
  })
})
