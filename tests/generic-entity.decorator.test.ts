import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { Entity, OneToMany, getRelations } from '../src/shared/generic-entity/generic-entity.decorator'

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
})
