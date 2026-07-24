import { describe, expect, it } from 'vitest'
import {
  CanonicalSchemaDefinitionAdapter,
} from '../src/shared/generic-entity/canonical-schema-definition'
import { Column, Entity, ManyToOne, OneToMany, OneToOne } from '../src/shared/generic-entity/generic-entity.decorator'

describe('decorator to canonical adapter', () => {
  it('maps decorator metadata into canonical schema with normalized naming', () => {
    @Entity({ tableName: 'OrderLine', tableSchema: 'concept_configuration' })
    class Order {
      @Column({ nullable: false })
      tenantId!: string

      @Column({ type: 'integer', nullable: true })
      quantity?: number
    }

    @Entity({ tableName: 'UserAccount', tableSchema: 'concept_configuration' })
    class User {
      @Column({ nullable: false })
      username!: string

      @ManyToOne(() => Order, 'orderId')
      order?: Order
    }

    const definition = CanonicalSchemaDefinitionAdapter.fromDecoratedEntity(User)

    expect(definition.logicalName).toBe('User')
    expect(definition.tableName).toBe('user_account')
    expect(definition.tableSchema).toBe('concept_configuration')
    expect(definition.columns).toEqual(expect.arrayContaining([
      expect.objectContaining({
        columnName: 'username',
        dataType: 'string',
        nullable: false,
      }),
    ]))

    expect(definition.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        relationType: 'manyToOne',
        sourceEntity: 'user_account',
        targetEntity: 'order_line',
        foreignKeyColumn: 'order_id',
      }),
    ]))
  })

  it('maps oneToMany and oneToOne relations and normalizes composite unique constraints', () => {
    @Entity({ tableName: 'SessionLog', tableSchema: 'concept_configuration' })
    class SessionLog {
      @Column({ nullable: false })
      createdAt!: Date
    }

    @Entity({ tableName: 'AccountProfile', tableSchema: 'concept_configuration' })
    class AccountProfile {
      @Column({ nullable: false })
      profileCode!: string
    }

    @Entity({
      tableName: 'UserAccount',
      tableSchema: 'concept_configuration',
      tableConstraints: [
        {
          type: 'unique',
          columns: ['TenantId', 'ExternalCode'],
          name: 'user_account_tenant_external_unique',
        },
      ],
    })
    class User {
      @Column({ nullable: false })
      tenantId!: string

      @Column({ nullable: false })
      externalCode!: string

      @OneToMany(() => SessionLog, 'UserAccountId', { mappedBy: 'user' })
      sessions?: SessionLog[]

      @OneToOne(() => AccountProfile, 'ProfileId', { mappedBy: 'user' })
      profile?: AccountProfile
    }

    const definition = CanonicalSchemaDefinitionAdapter.fromDecoratedEntity(User)

    expect(definition.tableConstraints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'unique',
        columns: ['tenant_id', 'external_code'],
        name: 'user_account_tenant_external_unique',
      }),
    ]))

    expect(definition.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        relationType: 'oneToMany',
        sourceEntity: 'user_account',
        targetEntity: 'session_log',
        foreignKeyColumn: 'user_account_id',
      }),
      expect.objectContaining({
        relationType: 'oneToOne',
        sourceEntity: 'user_account',
        targetEntity: 'account_profile',
        foreignKeyColumn: 'profile_id',
      }),
    ]))
  })
})
