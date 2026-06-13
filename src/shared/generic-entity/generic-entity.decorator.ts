import 'reflect-metadata'
import { toSnakeCase } from '../utils/case.util'

const ENTITY_METADATA_KEY = 'entity'

export interface EntityInfo {
  tableName?: string
  tableSchema?: string
}

export interface Relation {
  propertyKey: string
  targetEntity: () => Function
  foreignKey: string
}

export interface Relations {
  oneToMany: Relation[]
  manyToOne: Relation[]
  oneToOne: Relation[]
}

export class EntityMetadata {
  entity: EntityInfo | undefined
  relations: Relations | undefined
}

function getStructuredMetadata(target: Function): EntityMetadata {
  const stored = Reflect.getMetadata(ENTITY_METADATA_KEY, target) as EntityMetadata | undefined

  return stored || new EntityMetadata()

}

function saveStructuredMetadata(target: Function, metadata: EntityMetadata) {
  Reflect.defineMetadata(ENTITY_METADATA_KEY, metadata, target)
}

function addRelation(
  target: object,
  propertyKey: string,
  targetEntity: () => Function,
  foreignKey: string,
  relationType: keyof Relations
) {
  const constructor = target.constructor as Function
  const metadata = getStructuredMetadata(constructor)

  metadata.relations[relationType] = [
    ...metadata.relations[relationType],
    { propertyKey, targetEntity, foreignKey },
  ]

  saveStructuredMetadata(constructor, metadata)
}

export function Entity(entityMetadata?: EntityInfo) {
  return function (constructor: Function) {
    const metadata = getStructuredMetadata(constructor)

    if (!entityMetadata) {
      entityMetadata = {}
    }
    if (!entityMetadata.tableName) {
      entityMetadata.tableName = toSnakeCase(constructor.name)
    }

    metadata.entity = entityMetadata
    saveStructuredMetadata(constructor, metadata)
  }
}

export function OneToMany(targetEntity: () => Function, foreignKey: string) {
  return function (target: object, propertyKey: string) {
    addRelation(target, propertyKey, targetEntity, foreignKey, 'oneToMany')
  }
}

export function ManyToOne(targetEntity: () => Function, foreignKey: string) {
  return function (target: object, propertyKey: string) {
    addRelation(target, propertyKey, targetEntity, foreignKey, 'manyToOne')
  }
}

export function OneToOne(targetEntity: () => Function, foreignKey: string) {
  return function (target: object, propertyKey: string) {
    addRelation(target, propertyKey, targetEntity, foreignKey, 'oneToOne')
  }
}

export function getEntityMetadata(target: Function): EntityInfo {
  return getStructuredMetadata(target).entity
}

export function getOneToManyRelations(target: Function): Relation[] {
  return getStructuredMetadata(target).relations.oneToMany
}

export function getManyToOneRelations(target: Function): Relation[] {
  return getStructuredMetadata(target).relations.manyToOne
}

export function getOneToOneRelations(target: Function): Relation[] {
  return getStructuredMetadata(target).relations.oneToOne
}

export function getRelations(target: Function): Relation[] {
  const relations = getStructuredMetadata(target).relations
  return [
    ...relations.oneToMany,
    ...relations.manyToOne,
    ...relations.oneToOne,
  ]
}
