import 'reflect-metadata'

const RELATIONS_KEY = 'entity:relations'

export interface EntityMetadata {
  tableName: string
  tableSchema?: string
}

export interface RelationMetadata {
  propertyKey: string
  targetTable: string
  foreignKey: string
}

export function Entity(entityMetadata?: EntityMetadata) {
  return function (constructor: Function) {
    Reflect.defineMetadata('entity', entityMetadata || {}, constructor)
  }
}

export function OneToMany(targetTable: string, foreignKey: string) {
  return function (target: object, propertyKey: string) {
    const existing: RelationMetadata[] =
      Reflect.getMetadata(RELATIONS_KEY, target.constructor) ?? []

    Reflect.defineMetadata(
      RELATIONS_KEY,
      [...existing, { propertyKey, targetTable, foreignKey }],
      target.constructor
    )
  }
}

export function getEntityMetadata(target: Function): EntityMetadata {
  return Reflect.getMetadata('entity', target)
}

export function getRelations(target: Function): RelationMetadata[] {
  return Reflect.getMetadata(RELATIONS_KEY, target) ?? []
}