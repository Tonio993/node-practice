import { toCamelCase, toSnakeCase } from '../utils/case.util'
import {
  CanonicalSchemaDefinition,
  CanonicalSchemaDefinitionAdapter,
  CanonicalSchemaRelationDefinition,
} from './canonical-schema-definition'
import { SchemaConceptDefinition } from './schema-definition'
import {
  getEntityColumns,
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

export interface EngineColumnDefinition {
  propertyKey: string
  name: string
  type: string
  nullable?: boolean
  unique?: boolean
  defaultValue?: unknown
  primaryKey?: boolean
  label?: string
  description?: string
  position?: number
}

export interface EngineTableConstraintDefinition {
  type: 'unique' | 'primary' | 'foreignKey'
  columns: string[]
  name?: string
}

export interface EngineEntityDefinition {
  name: string
  tableName: string
  tableSchema?: string
  relations: EngineEntityRelationsDefinition
  columns: EngineColumnDefinition[]
  tableConstraints: EngineTableConstraintDefinition[]
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
      columns: this.fromDecoratorColumns(entityClass),
      tableConstraints: (entityMetadata?.tableConstraints ?? []).map((constraint) => ({ ...constraint })),
    }
  }

  static fromConcepts(concepts: SchemaConceptDefinition[]): EngineEntityDefinition[] {
    const canonicalDefinitions = CanonicalSchemaDefinitionAdapter.fromConcepts(concepts)
    return this.fromCanonicalDefinitions(canonicalDefinitions)
  }

  static fromCanonicalDefinitions(definitions: CanonicalSchemaDefinition[]): EngineEntityDefinition[] {
    return definitions.map((definition) => this.fromCanonicalDefinition(definition))
  }

  static fromCanonicalDefinition(definition: CanonicalSchemaDefinition): EngineEntityDefinition {
    const oneToMany: EngineRelationDefinition[] = []
    const manyToOne: EngineRelationDefinition[] = []
    const oneToOne: EngineRelationDefinition[] = []

    for (const relation of definition.relations) {
      if (relation.sourceEntity !== definition.tableName) {
        continue
      }

      const engineRelation = this.toEngineRelationFromCanonical(relation)
      if (!engineRelation) {
        continue
      }

      if (relation.relationType === 'oneToMany') {
        oneToMany.push(engineRelation)
        continue
      }
      if (relation.relationType === 'manyToOne') {
        manyToOne.push(engineRelation)
        continue
      }
      if (relation.relationType === 'oneToOne') {
        oneToOne.push(engineRelation)
      }
    }

    return {
      name: definition.logicalName,
      tableName: definition.tableName,
      tableSchema: definition.tableSchema,
      relations: {
        oneToMany,
        manyToOne,
        oneToOne,
      },
      columns: definition.columns.map((column) => ({
        propertyKey: toCamelCase(column.columnName),
        name: column.columnName,
        type: column.dataType,
        nullable: column.nullable,
        unique: column.unique,
        defaultValue: column.defaultValue,
        primaryKey: column.primaryKey,
        label: column.label,
        description: column.description,
        position: column.position,
      })),
      tableConstraints: definition.tableConstraints.map((constraint) => ({ ...constraint })),
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

  private static fromDecoratorColumns(entityClass: Function): EngineColumnDefinition[] {
    return getEntityColumns(entityClass).map((column) => ({
      propertyKey: column.propertyKey,
      name: column.columnName ?? toSnakeCase(column.propertyKey),
      type: column.type,
      nullable: column.nullable,
      unique: column.unique,
      defaultValue: column.defaultValue,
      primaryKey: column.primaryKey,
      label: column.label,
      description: column.description,
      position: column.position,
    }))
  }

  private static toEngineRelationFromCanonical(
    relation: CanonicalSchemaRelationDefinition
  ): EngineRelationDefinition | null {
    if (relation.relationType === 'unknown') {
      return null
    }

    const fallbackPropertyKey = relation.relationType === 'oneToMany'
      ? this.toCollectionPropertyName(relation.targetEntity)
      : toCamelCase(relation.targetEntity)

    const propertyKey = this.toPropertyKey(relation.sourceField, fallbackPropertyKey)
    const mappedBy = this.toOptionalPropertyKey(relation.mappedBy ?? relation.targetField)
    const foreignKey = this.toForeignKeyName(relation.foreignKeyColumn, relation.targetEntity)

    return {
      propertyKey,
      mappedBy,
      foreignKey,
      targetTableName: relation.targetEntity,
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
