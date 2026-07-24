import type { Knex } from 'knex'
import { toSnakeCase } from '../utils/case.util'
import type {
  CanonicalSchemaColumnDefinition,
  CanonicalSchemaConstraintDefinition,
  CanonicalSchemaDefinition,
  CanonicalSchemaRelationDefinition,
} from './canonical-schema-definition'
import { SchemaIntrospectionRepository } from './schema-introspection.repository'

export class SchemaApplyExecutor {
  constructor(
    private readonly introspection: SchemaIntrospectionRepository,
    private readonly resolveSchemaName: (schemaName: unknown) => string
  ) {}

  async applyCanonicalDefinitions(definitions: CanonicalSchemaDefinition[]): Promise<void> {
    const definitionsByTable = this.groupDefinitionsByTableName(definitions)

    for (const definition of definitions) {
      await this.ensureTable(definition)
    }

    for (const definition of definitions) {
      await this.ensureRelations(definition, definitionsByTable)
    }
  }

  private groupDefinitionsByTableName(definitions: CanonicalSchemaDefinition[]): Map<string, CanonicalSchemaDefinition[]> {
    const grouped = new Map<string, CanonicalSchemaDefinition[]>()
    for (const definition of definitions) {
      const bucket = grouped.get(definition.tableName) ?? []
      bucket.push(definition)
      grouped.set(definition.tableName, bucket)
    }

    return grouped
  }

  private findRelatedDefinition(
    relation: CanonicalSchemaRelationDefinition,
    sourceDefinition: CanonicalSchemaDefinition,
    definitionsByTable: Map<string, CanonicalSchemaDefinition[]>
  ): CanonicalSchemaDefinition | null {
    const candidates = definitionsByTable.get(relation.targetEntity) ?? []
    if (candidates.length === 0) {
      return null
    }

    if (candidates.length === 1) {
      return candidates[0]
    }

    const sourceSchema = this.resolveSchemaName(sourceDefinition.tableSchema)
    return candidates.find((candidate) => this.resolveSchemaName(candidate.tableSchema) === sourceSchema) ?? candidates[0]
  }

  private resolveRelationContext(
    relation: CanonicalSchemaRelationDefinition,
    sourceDefinition: CanonicalSchemaDefinition,
    definitionsByTable: Map<string, CanonicalSchemaDefinition[]>
  ): {
    ownerSchemaName: string
    ownerTableName: string
    reference: string
    columnName: string
    unique: boolean
  } | null {
    const targetDefinition = this.findRelatedDefinition(relation, sourceDefinition, definitionsByTable)
    if (!targetDefinition) {
      return null
    }

    const sourceSchemaName = this.resolveSchemaName(sourceDefinition.tableSchema)
    const sourceTableName = sourceDefinition.tableName
    const targetSchemaName = this.resolveSchemaName(targetDefinition.tableSchema)
    const targetTableName = targetDefinition.tableName

    if (relation.relationType === 'manyToOne' || relation.relationType === 'oneToOne') {
      return {
        ownerSchemaName: sourceSchemaName,
        ownerTableName: sourceTableName,
        reference: this.introspection.buildReferenceName(targetSchemaName, targetTableName),
        columnName: this.resolveForeignKeyColumnName(relation, targetTableName),
        unique: relation.relationType === 'oneToOne',
      }
    }

    if (relation.relationType === 'oneToMany') {
      return {
        ownerSchemaName: targetSchemaName,
        ownerTableName: targetTableName,
        reference: this.introspection.buildReferenceName(sourceSchemaName, sourceTableName),
        columnName: this.resolveForeignKeyColumnName(relation, sourceTableName),
        unique: false,
      }
    }

    return null
  }

  private resolveForeignKeyColumnName(relation: CanonicalSchemaRelationDefinition, fallbackTargetTable: string): string {
    const rawName = relation.foreignKeyColumn || relation.targetField || `${toSnakeCase(fallbackTargetTable)}_id`
    return toSnakeCase(String(rawName))
  }

  private async ensureTable(definition: CanonicalSchemaDefinition): Promise<void> {
    const schemaName = this.resolveSchemaName(definition.tableSchema)
    const tableName = definition.tableName

    const schemaBuilder = this.introspection.getSchemaBuilder(schemaName)
    const exists = await schemaBuilder.hasTable(tableName)
    if (!exists) {
      await schemaBuilder.createTable(tableName, (table) => {
        this.applyColumns(table, definition.columns)
        this.applyCreateTableConstraints(table, definition)
      })
      return
    }

    const existingColumns = new Set<string>()
    for (const column of definition.columns) {
      const hasColumn = await schemaBuilder.hasColumn(tableName, column.columnName)
      if (hasColumn) {
        existingColumns.add(column.columnName)
      }
    }

    const missingColumns = definition.columns.filter((column) => !existingColumns.has(column.columnName))

    if (missingColumns.length > 0) {
      await schemaBuilder.alterTable(tableName, (table) => {
        for (const column of missingColumns) {
          this.applyColumn(table, column)
        }
      })
    }

    await this.ensureUniqueConstraints(definition)
  }

  private async ensureRelations(
    definition: CanonicalSchemaDefinition,
    definitionsByTable: Map<string, CanonicalSchemaDefinition[]>
  ): Promise<void> {
    for (const relation of definition.relations) {
      if (relation.sourceEntity !== definition.tableName) {
        continue
      }

      const relationContext = this.resolveRelationContext(relation, definition, definitionsByTable)
      if (!relationContext) {
        continue
      }

      const ownerSchemaBuilder = this.introspection.getSchemaBuilder(relationContext.ownerSchemaName)
      const hasColumn = await ownerSchemaBuilder.hasColumn(relationContext.ownerTableName, relationContext.columnName)
      if (hasColumn) {
        continue
      }

      await ownerSchemaBuilder.alterTable(relationContext.ownerTableName, (table) => {
        const relationColumn = table.integer(relationContext.columnName).unsigned().references('id').inTable(relationContext.reference)
        if (relationContext.unique) {
          relationColumn.unique()
        }
      })
    }
  }

  private getUniqueConstraints(constraints: CanonicalSchemaConstraintDefinition[]): CanonicalSchemaConstraintDefinition[] {
    return constraints.filter((constraint) => constraint.type === 'unique' && constraint.columns.length > 0)
  }

  private applyColumns(table: Knex.CreateTableBuilder, columns: CanonicalSchemaColumnDefinition[]): void {
    table.increments('id').notNullable()

    for (const column of columns) {
      this.applyColumn(table, column)
    }
  }

  private applyCreateTableConstraints(table: Knex.CreateTableBuilder, definition: CanonicalSchemaDefinition): void {
    for (const constraint of definition.tableConstraints) {
      if (constraint.type !== 'unique' || !constraint.columns.length) {
        continue
      }

      table.unique(constraint.columns, constraint.name)
    }
  }

  private async ensureUniqueConstraints(definition: CanonicalSchemaDefinition): Promise<void> {
    const uniqueConstraints = this.getUniqueConstraints(definition.tableConstraints)
    if (uniqueConstraints.length === 0) {
      return
    }

    const schemaName = this.resolveSchemaName(definition.tableSchema)
    const schemaBuilder = this.introspection.getSchemaBuilder(schemaName)
    const tableName = definition.tableName

    for (const constraint of uniqueConstraints) {
      const alreadyExists = await this.introspection.hasUniqueConstraint(schemaName, tableName, constraint.columns, constraint.name)
      if (alreadyExists) {
        continue
      }

      await schemaBuilder.alterTable(tableName, (table) => {
        table.unique(constraint.columns, constraint.name)
      })
    }
  }

  private applyColumn(table: Knex.CreateTableBuilder | Knex.AlterTableBuilder, column: CanonicalSchemaColumnDefinition): void {
    const columnBuilder = this.createColumnBuilder(table, column)

    if (column.primaryKey) {
      columnBuilder.primary()
    }

    if (column.unique) {
      columnBuilder.unique()
    }

    if (column.nullable === false) {
      columnBuilder.notNullable()
    }

    if (column.defaultValue !== undefined) {
      columnBuilder.defaultTo(column.defaultValue as any)
    }
  }

  private createColumnBuilder(table: Knex.CreateTableBuilder | Knex.AlterTableBuilder, column: CanonicalSchemaColumnDefinition) {
    const columnName = column.columnName

    switch (column.dataType.toLowerCase()) {
      case 'string':
      case 'varchar':
      case 'text':
        return table.string(columnName)
      case 'integer':
      case 'int':
        return table.integer(columnName)
      case 'boolean':
      case 'bool':
        return table.boolean(columnName)
      case 'date':
        return table.date(columnName)
      case 'datetime':
      case 'timestamp':
        return table.datetime(columnName)
      case 'json':
        return table.json(columnName)
      case 'decimal':
      case 'float':
      case 'number':
        return table.float(columnName)
      default:
        return table.string(columnName)
    }
  }
}
