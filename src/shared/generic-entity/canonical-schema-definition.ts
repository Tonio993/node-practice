import { toSnakeCase } from '../utils/case.util'
import type { EngineEntityDefinition } from './engine-entity-definition'
import {
  getEntityColumns,
  getEntityMetadata,
  getManyToOneRelations,
  getOneToManyRelations,
  getOneToOneRelations,
  hasEntityMetadata,
  Relation,
} from './generic-entity.decorator'

export type CanonicalSchemaRelationType = 'manyToOne' | 'oneToMany' | 'oneToOne' | 'unknown'

export interface CanonicalSchemaColumnDefinition {
  columnName: string
  dataType: string
  nullable?: boolean
  unique?: boolean
  defaultValue?: unknown
  primaryKey?: boolean
  label?: string
  description?: string
  position?: number
}

export interface CanonicalSchemaConstraintDefinition {
  type: 'unique' | 'primary' | 'foreignKey'
  columns: string[]
  name?: string
}

export interface CanonicalSchemaRelationDefinition {
  relationType: CanonicalSchemaRelationType
  sourceEntity: string
  targetEntity: string
  foreignKeyColumn: string
  mappedBy?: string
  sourceField?: string
  targetField?: string
}

export interface CanonicalSchemaDefinition {
  logicalName: string
  tableName: string
  tableSchema?: string
  columns: CanonicalSchemaColumnDefinition[]
  tableConstraints: CanonicalSchemaConstraintDefinition[]
  relations: CanonicalSchemaRelationDefinition[]
}

function normalizeRelationType(value: string): CanonicalSchemaRelationType {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'manytoone') {
    return 'manyToOne'
  }
  if (normalized === 'onetomany') {
    return 'oneToMany'
  }
  if (normalized === 'onetoone') {
    return 'oneToOne'
  }

  return 'unknown'
}

function toOptionalTrimmedValue(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function normalizeRelation(
  relation: CanonicalSchemaRelationDefinition,
  fallbackSourceEntity: string
): CanonicalSchemaRelationDefinition {
  const sourceEntity = toSnakeCase(String(toOptionalTrimmedValue(relation.sourceEntity) ?? fallbackSourceEntity))
  const targetEntity = toSnakeCase(String(toOptionalTrimmedValue(relation.targetEntity) ?? ''))
  const fallbackForeignKey = `${targetEntity}_id`

  return {
    relationType: normalizeRelationType(relation.relationType),
    sourceEntity,
    targetEntity,
    foreignKeyColumn: toSnakeCase(String(toOptionalTrimmedValue(relation.foreignKeyColumn) ?? fallbackForeignKey)),
    mappedBy: toOptionalTrimmedValue(relation.mappedBy),
    sourceField: toOptionalTrimmedValue(relation.sourceField),
    targetField: toOptionalTrimmedValue(relation.targetField),
  }
}

function normalizeDefinition(definition: CanonicalSchemaDefinition): CanonicalSchemaDefinition {
  const tableName = toSnakeCase(String(definition.tableName))
  const tableSchema = toOptionalTrimmedValue(definition.tableSchema)
  const relationMap = new Map<string, CanonicalSchemaRelationDefinition>()

  for (const relation of definition.relations) {
    const normalizedRelation = normalizeRelation(relation, tableName)
    const relationKey = [
      normalizedRelation.relationType,
      normalizedRelation.sourceEntity,
      normalizedRelation.targetEntity,
      normalizedRelation.foreignKeyColumn,
      normalizedRelation.mappedBy ?? '',
      normalizedRelation.sourceField ?? '',
      normalizedRelation.targetField ?? '',
    ].join('|')

    relationMap.set(relationKey, normalizedRelation)
  }

  return {
    logicalName: definition.logicalName,
    tableName,
    tableSchema,
    columns: definition.columns.map((column) => ({
      ...column,
      columnName: toSnakeCase(String(column.columnName)),
    })),
    tableConstraints: definition.tableConstraints.map((constraint) => ({
      ...constraint,
      columns: constraint.columns.map((column) => toSnakeCase(String(column))),
    })),
    relations: [...relationMap.values()],
  }
}

export class CanonicalSchemaDefinitionAdapter {
  static normalizeDefinitions(definitions: CanonicalSchemaDefinition[]): CanonicalSchemaDefinition[] {
    return definitions.map((definition) => normalizeDefinition(definition))
  }

  static fromDecoratedEntity(entityClass: Function): CanonicalSchemaDefinition {
    if (!hasEntityMetadata(entityClass)) {
      throw new Error(`Entity class ${entityClass.name} is missing @Entity decorator`)
    }

    const entityMetadata = getEntityMetadata(entityClass)
    const tableName = String(entityMetadata?.tableName ?? toSnakeCase(entityClass.name))

    return normalizeDefinition({
      logicalName: entityClass.name,
      tableName,
      tableSchema: entityMetadata?.tableSchema,
      columns: getEntityColumns(entityClass).map((column) => ({
        columnName: column.columnName ?? toSnakeCase(column.propertyKey),
        dataType: column.type,
        nullable: column.nullable,
        unique: column.unique,
        defaultValue: column.defaultValue,
        primaryKey: column.primaryKey,
        label: column.label,
        description: column.description,
        position: column.position,
      })),
      tableConstraints: (entityMetadata?.tableConstraints ?? []).map((constraint) => ({
        type: constraint.type,
        columns: [...constraint.columns],
        name: constraint.name,
      })),
      relations: this.fromDecoratedEntityRelations(entityClass, tableName),
    })
  }

  static fromDecoratedEntities(entityClasses: Function[]): CanonicalSchemaDefinition[] {
    return entityClasses.map((entityClass) => this.fromDecoratedEntity(entityClass))
  }

  static fromEngineDefinitions(definitions: EngineEntityDefinition[]): CanonicalSchemaDefinition[] {
    return this.normalizeDefinitions(definitions.map((definition) => ({
      logicalName: definition.name,
      tableName: definition.tableName,
      tableSchema: definition.tableSchema,
      columns: definition.columns.map((column) => ({
        columnName: column.name,
        dataType: column.type,
        nullable: column.nullable,
        unique: column.unique,
        defaultValue: column.defaultValue,
        primaryKey: column.primaryKey,
        label: column.label,
        description: column.description,
        position: column.position,
      })),
      tableConstraints: definition.tableConstraints.map((constraint) => ({
        type: constraint.type,
        columns: [...constraint.columns],
        name: constraint.name,
      })),
      relations: [
        ...this.fromEngineRelations(definition.tableName, 'oneToMany', definition.relations.oneToMany),
        ...this.fromEngineRelations(definition.tableName, 'manyToOne', definition.relations.manyToOne),
        ...this.fromEngineRelations(definition.tableName, 'oneToOne', definition.relations.oneToOne),
      ],
    })))
  }

  private static fromDecoratedEntityRelations(entityClass: Function, sourceTableName: string): CanonicalSchemaRelationDefinition[] {
    return [
      ...this.fromDecoratorRelations(sourceTableName, 'oneToMany', getOneToManyRelations(entityClass)),
      ...this.fromDecoratorRelations(sourceTableName, 'manyToOne', getManyToOneRelations(entityClass)),
      ...this.fromDecoratorRelations(sourceTableName, 'oneToOne', getOneToOneRelations(entityClass)),
    ]
  }

  private static fromDecoratorRelations(
    sourceTableName: string,
    relationType: CanonicalSchemaRelationType,
    relations: Relation[]
  ): CanonicalSchemaRelationDefinition[] {
    return relations.map((relation) => {
      const targetEntity = relation.targetEntity()
      const targetEntityMetadata = getEntityMetadata(targetEntity)
      if (!targetEntityMetadata?.tableName) {
        throw new Error(`Target entity ${targetEntity.name} is missing @Entity metadata`)
      }

      return {
        relationType,
        sourceEntity: sourceTableName,
        targetEntity: targetEntityMetadata.tableName,
        foreignKeyColumn: toSnakeCase(relation.foreignKey),
        mappedBy: relation.mappedBy,
        sourceField: relation.propertyKey,
        targetField: relation.mappedBy,
      }
    })
  }

  private static fromEngineRelations(
    sourceTableName: string,
    relationType: CanonicalSchemaRelationType,
    relations: Array<{ targetTableName: string; foreignKey: string; mappedBy?: string; propertyKey: string }>
  ): CanonicalSchemaRelationDefinition[] {
    return relations.map((relation) => ({
      relationType,
      sourceEntity: sourceTableName,
      targetEntity: relation.targetTableName,
      foreignKeyColumn: toSnakeCase(relation.foreignKey),
      mappedBy: relation.mappedBy,
      sourceField: relation.propertyKey,
      targetField: relation.mappedBy,
    }))
  }
}
