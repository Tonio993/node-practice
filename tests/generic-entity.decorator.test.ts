import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { Column, Entity, OneToMany, getEntityColumns, getRelations } from '../src/shared/generic-entity/generic-entity.decorator'

describe('generic entity decorator', () => {
  it('initializes relation arrays when a relation decorator is applied', () => {
    @Entity()
    class Parent {
      @OneToMany(() => Child, 'parent_id')
      children?: Child[]
    }

    @Entity()
    class Child {}

    expect(() => getRelations(Parent)).not.toThrow()
    expect(getRelations(Parent)).toHaveLength(1)
  })

  it('collects column metadata from decorated entity fields', () => {
    @Entity()
    class Product {
      @Column({ nullable: false, unique: true })
      code!: string

      @Column({ type: 'integer', defaultValue: 0, columnName: 'quantity' })
      quantity!: number
    }

    const columns = getEntityColumns(Product)
    const codeColumn = columns.find((column) => column.propertyKey === 'code')
    const quantityColumn = columns.find((column) => column.propertyKey === 'quantity')

    expect(columns).toHaveLength(2)
    expect(codeColumn?.type).toBe('string')
    expect(codeColumn?.nullable).toBe(false)
    expect(codeColumn?.unique).toBe(true)
    expect(codeColumn?.columnName).toBe('code')

    expect(quantityColumn?.type).toBe('integer')
    expect(quantityColumn?.defaultValue).toBe(0)
    expect(quantityColumn?.columnName).toBe('quantity')
  })

  it('derives snake_case column names automatically when no explicit override is provided', () => {
    @Entity()
    class AuditEvent {
      @Column({ nullable: false })
      tableName!: string

      @Column({ type: 'boolean', defaultValue: false })
      primaryKey!: boolean
    }

    const columns = getEntityColumns(AuditEvent)
    const tableNameColumn = columns.find((column) => column.propertyKey === 'tableName')
    const primaryKeyColumn = columns.find((column) => column.propertyKey === 'primaryKey')

    expect(tableNameColumn?.columnName).toBe('table_name')
    expect(primaryKeyColumn?.columnName).toBe('primary_key')
  })
})
