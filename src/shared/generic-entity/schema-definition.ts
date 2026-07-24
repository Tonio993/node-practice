import { toSnakeCase } from '../utils/case.util'

export type SchemaRelationType = 'manyToOne' | 'oneToMany' | 'oneToOne' | 'unknown'

function normalizeRelationType(value: string): SchemaRelationType {
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

export interface SchemaFieldOptions {
  nullable?: boolean
  unique?: boolean
  defaultValue?: unknown
  primaryKey?: boolean
  columnName?: string
  label?: string
  description?: string
  position?: number
}

export interface SchemaTableConstraintDefinition {
  type: 'unique' | 'primary' | 'foreignKey'
  columns: string[]
  name?: string
}

export class SchemaFieldDefinition {
  readonly nullable: boolean
  readonly unique: boolean
  readonly defaultValue?: unknown
  readonly primaryKey: boolean
  readonly columnName?: string
  readonly label?: string
  readonly description?: string
  readonly position?: number

  constructor(
    public readonly name: string,
    public readonly type: string,
    options: SchemaFieldOptions = {}
  ) {
    this.nullable = options.nullable ?? true
    this.unique = options.unique ?? false
    this.defaultValue = options.defaultValue
    this.primaryKey = options.primaryKey ?? false
    this.columnName = options.columnName
    this.label = options.label
    this.description = options.description
    this.position = options.position
  }
}

export class SchemaRelationDefinition {
  readonly relationType: SchemaRelationType

  constructor(
    public readonly id: number,
    public readonly sourceConceptId: number,
    public readonly targetConceptId: number,
    relationType: string,
    public readonly foreignKey: string,
    public readonly mappedBy?: string,
    public readonly sourceField?: string,
    public readonly targetField?: string
  ) {
    this.relationType = normalizeRelationType(relationType)
  }

  isManyToOne(): boolean {
    return this.relationType === 'manyToOne'
  }

  isOneToMany(): boolean {
    return this.relationType === 'oneToMany'
  }

  isOneToOne(): boolean {
    return this.relationType === 'oneToOne'
  }

  requiresUniqueForeignKey(): boolean {
    return this.isOneToOne()
  }
}

/**
 * @deprecated Keep this model as persisted configuration representation.
 * Use canonical schema definitions as the DDL operational model.
 */
export class SchemaConceptDefinition {
  constructor(
    public readonly id: number,
    public readonly name: string,
    public readonly tableName?: string | null,
    public readonly tableSchema?: string | null,
    public readonly fields: SchemaFieldDefinition[] = [],
    public readonly relations: SchemaRelationDefinition[] = [],
    public readonly tableConstraints: SchemaTableConstraintDefinition[] = []
  ) {}

  getResolvedTableName(): string {
    return toSnakeCase(String(this.tableName ?? this.name))
  }

  getResolvedTableSchema(): string {
    return this.tableSchema ?? 'concept_configuration'
  }
}
