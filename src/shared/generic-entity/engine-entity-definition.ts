import { toCamelCase, toSnakeCase } from '../utils/case.util'
import { SchemaConceptDefinition, SchemaRelationDefinition } from './schema-definition'
import {
  getEntityMetadata,
  getManyToOneRelations,
  getOneToManyRelations,
  getOneToOneRelations,
  hasEntityMetadata,
  Relation,
} from './generic-entity.decorator'

export interface EngineRelationDefinition {
  propertyKey: string
  targetTableName: string
  foreignKey: string
  mappedBy?: string
}

export interface EngineEntityRelationsDefinition {
  oneToMany: EngineRelationDefinition[]
  manyToOne: EngineRelationDefinition[]
  oneToOne: EngineRelationDefinition[]
}

export interface EngineEntityDefinition {
  name: string
  tableName: string
  tableSchema?: string
  relations: EngineEntityRelationsDefinition
}

export class EngineEntityDefinitionAdapter {
  static fromDecoratedEntity(entityClass: Function): EngineEntityDefinition {
    if (!hasEntityMetadata(entityClass)) {
      throw new Error(`Entity class ${entityClass.name} is missing @Entity decorator`)
    }

    const entityMetadata = getEntityMetadata(entityClass)
    const oneToMany = this.fromDecoratorRelations(getOneToManyRelations(entityClass))
    const manyToOne = this.fromDecoratorRelations(getManyToOneRelations(entityClass))
    const oneToOne = this.fromDecoratorRelations(getOneToOneRelations(entityClass))

    return {
      name: entityClass.name,
      tableName: String(entityMetadata?.tableName ?? toSnakeCase(entityClass.name)),
      tableSchema: entityMetadata?.tableSchema,
      relations: {
        oneToMany,
        manyToOne,
        oneToOne,
      },
    }
  }

  static fromConcepts(concepts: SchemaConceptDefinition[]): EngineEntityDefinition[] {
    const conceptsById = new Map<number, SchemaConceptDefinition>(concepts.map((concept) => [concept.id, concept]))
    return concepts.map((concept) => this.fromConcept(concept, conceptsById))
  }

  static fromConcept(
    concept: SchemaConceptDefinition,
    conceptsById: Map<number, SchemaConceptDefinition>
  ): EngineEntityDefinition {
    const oneToMany: EngineRelationDefinition[] = []
    const manyToOne: EngineRelationDefinition[] = []
    const oneToOne: EngineRelationDefinition[] = []

    for (const relation of concept.relations) {
      const engineRelation = this.toEngineRelation(concept, relation, conceptsById)
      if (!engineRelation) {
        continue
      }

      if (relation.isOneToMany()) {
        oneToMany.push(engineRelation)
        continue
      }
      if (relation.isManyToOne()) {
        manyToOne.push(engineRelation)
        continue
      }
      if (relation.isOneToOne()) {
        oneToOne.push(engineRelation)
      }
    }

    return {
      name: concept.name,
      tableName: concept.getResolvedTableName(),
      tableSchema: concept.getResolvedTableSchema(),
      relations: {
        oneToMany,
        manyToOne,
        oneToOne,
      },
    }
  }

  private static fromDecoratorRelations(relations: Relation[]): EngineRelationDefinition[] {
    return relations.map((relation) => {
      const targetEntity = relation.targetEntity()
      const targetEntityMetadata = getEntityMetadata(targetEntity)
      if (!targetEntityMetadata?.tableName) {
        throw new Error(`Target entity ${targetEntity.name} is missing @Entity metadata`)
      }

      return {
        propertyKey: relation.propertyKey,
        foreignKey: toSnakeCase(relation.foreignKey),
        mappedBy: relation.mappedBy,
        targetTableName: targetEntityMetadata.tableName,
      }
    })
  }

  private static toEngineRelation(
    sourceConcept: SchemaConceptDefinition,
    relation: SchemaRelationDefinition,
    conceptsById: Map<number, SchemaConceptDefinition>
  ): EngineRelationDefinition | null {
    const targetConcept = conceptsById.get(relation.targetConceptId)
    if (!targetConcept) {
      return null
    }

    const fallbackPropertyKey = relation.isOneToMany()
      ? this.toCollectionPropertyName(targetConcept.name)
      : toCamelCase(targetConcept.name)

    const propertyKey = this.toPropertyKey(relation.sourceField, fallbackPropertyKey)
    const mappedBy = this.toOptionalPropertyKey(relation.mappedBy ?? relation.targetField)
    const foreignKey = this.toForeignKeyName(relation.foreignKey, targetConcept.name)

    return {
      propertyKey,
      mappedBy,
      foreignKey,
      targetTableName: targetConcept.getResolvedTableName(),
    }
  }

  private static toPropertyKey(value: string | undefined, fallback: string): string {
    if (!value || !value.trim()) {
      return fallback
    }

    return toCamelCase(value.trim())
  }

  private static toOptionalPropertyKey(value: string | undefined): string | undefined {
    if (!value || !value.trim()) {
      return undefined
    }

    return toCamelCase(value.trim())
  }

  private static toForeignKeyName(value: string | undefined, targetName: string): string {
    const fallback = `${toSnakeCase(targetName)}_id`
    return toSnakeCase(String(value && value.trim() ? value : fallback))
  }

  private static toCollectionPropertyName(value: string): string {
    const base = toCamelCase(value)
    return base.endsWith('s') ? base : `${base}s`
  }
}
