import type { Knex } from 'knex'
import { toSnakeCase } from '../utils/case.util'
import {
  CanonicalSchemaColumnDefinition,
  CanonicalSchemaDefinition,
  CanonicalSchemaDefinitionAdapter,
  CanonicalSchemaRelationDefinition,
  CanonicalSchemaRelationType,
} from './canonical-schema-definition'

export class SchemaManagementService {
  constructor(private readonly db: Knex) {}

  async syncFromConfiguration(): Promise<void> {
    const definitions = await this.loadCanonicalDefinitionsFromConfiguration()
    await this.applyCanonicalDefinitions(definitions)
  }

  async syncFromDefinitions(definitions: CanonicalSchemaDefinition[]): Promise<void> {
    if (definitions.length === 0) {
      return
    }

    const normalizedDefinitions = CanonicalSchemaDefinitionAdapter.normalizeDefinitions(definitions)
    await this.applyCanonicalDefinitions(normalizedDefinitions)
  }

  private async applyCanonicalDefinitions(definitions: CanonicalSchemaDefinition[]): Promise<void> {
    const definitionsByTable = this.groupDefinitionsByTableName(definitions)

    for (const definition of definitions) {
      await this.ensureTable(definition)
    }

    for (const definition of definitions) {
      await this.ensureRelations(definition, definitionsByTable)
    }
  }

  private async loadCanonicalDefinitionsFromConfiguration(): Promise<CanonicalSchemaDefinition[]> {
    const conceptRows = await this.getTable('concept', 'concept_configuration').select('*')
    const fieldRows = await this.getTable('concept_field', 'concept_configuration').select('*')
    const relationRows = await this.getTable('concept_relation', 'concept_configuration').select('*')

    return this.mapRowsToCanonicalDefinitions(conceptRows, fieldRows, relationRows)
  }

  private mapRowsToCanonicalDefinitions(
    conceptRows: Array<Record<string, any>>,
    fieldRows: Array<Record<string, any>>,
    relationRows: Array<Record<string, any>>
  ): CanonicalSchemaDefinition[] {
    const conceptsById = new Map<number, Record<string, any>>()
    for (const row of conceptRows) {
      conceptsById.set(Number(row.id), row)
    }

    const columnsByConcept = this.groupColumnsByConcept(fieldRows)
    const relationRowsByConcept = this.groupRelationRowsByConcept(relationRows)

    const definitions: CanonicalSchemaDefinition[] = conceptRows.map((row) => {
      const conceptId = Number(row.id)
      const tableName = this.resolveTableName(row.table_name, row.name)
      const tableSchema = this.resolveSchemaName(row.table_schema)

      const relations = (relationRowsByConcept[conceptId] ?? [])
        .map((relationRow) => this.mapRelationRowToCanonical(relationRow, tableName, conceptsById))
        .filter((relation): relation is CanonicalSchemaRelationDefinition => relation !== null)

      return {
        logicalName: String(row.name),
        tableName,
        tableSchema,
        columns: columnsByConcept[conceptId] ?? [],
        tableConstraints: [],
        relations,
      }
    })

    return CanonicalSchemaDefinitionAdapter.normalizeDefinitions(definitions)
  }

  private groupColumnsByConcept(fieldRows: Array<Record<string, any>>): Record<number, CanonicalSchemaColumnDefinition[]> {
    return fieldRows.reduce<Record<number, CanonicalSchemaColumnDefinition[]>>((acc, row) => {
      const conceptId = Number(row.id_concept)
      acc[conceptId] ||= []
      acc[conceptId].push({
        columnName: this.resolveColumnName(row.column_name, row.name),
        dataType: String(row.type),
        nullable: row.nullable === undefined ? true : Boolean(row.nullable),
        unique: Boolean(row.unique),
        defaultValue: row.default_value ?? undefined,
        primaryKey: Boolean(row.primary_key),
        label: row.label ?? undefined,
        description: row.description ?? undefined,
        position: row.position !== undefined ? Number(row.position) : undefined,
      })

      return acc
    }, {})
  }

  private groupRelationRowsByConcept(relationRows: Array<Record<string, any>>): Record<number, Array<Record<string, any>>> {
    return relationRows.reduce<Record<number, Array<Record<string, any>>>>((acc, row) => {
      const conceptId = Number(row.id_concept_source)
      acc[conceptId] ||= []
      acc[conceptId].push(row)
      return acc
    }, {})
  }

  private mapRelationRowToCanonical(
    relationRow: Record<string, any>,
    sourceTableName: string,
    conceptsById: Map<number, Record<string, any>>
  ): CanonicalSchemaRelationDefinition | null {
    const targetConcept = conceptsById.get(Number(relationRow.id_concept_target))
    if (!targetConcept) {
      return null
    }

    const targetTableName = this.resolveTableName(targetConcept.table_name, targetConcept.name)
    const fallbackForeignKey = `${targetTableName}_id`

    return {
      relationType: this.normalizeRelationType(relationRow.relation_type),
      sourceEntity: sourceTableName,
      targetEntity: targetTableName,
      foreignKeyColumn: toSnakeCase(String(relationRow.foreign_key ?? fallbackForeignKey)),
      mappedBy: relationRow.mapped_by ?? undefined,
      sourceField: relationRow.source_field ?? undefined,
      targetField: relationRow.target_field ?? undefined,
    }
  }

  private normalizeRelationType(value: unknown): CanonicalSchemaRelationType {
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

  private resolveTableName(rawTableName: unknown, fallbackName: unknown): string {
    return toSnakeCase(String(rawTableName ?? fallbackName))
  }

  private resolveSchemaName(schemaName: unknown): string {
    return String(schemaName ?? 'concept_configuration')
  }

  private resolveColumnName(rawColumnName: unknown, fallbackName: unknown): string {
    return toSnakeCase(String(rawColumnName ?? fallbackName))
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

  private async ensureTable(definition: CanonicalSchemaDefinition): Promise<void> {
    const schemaName = this.resolveSchemaName(definition.tableSchema)
    const tableName = definition.tableName

    const schemaBuilder = this.getSchemaBuilder(schemaName)
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

      const ownerSchemaBuilder = this.getSchemaBuilder(relationContext.ownerSchemaName)
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
        reference: this.buildReferenceName(targetSchemaName, targetTableName),
        columnName: this.resolveForeignKeyColumnName(relation, targetTableName),
        unique: relation.relationType === 'oneToOne',
      }
    }

    if (relation.relationType === 'oneToMany') {
      return {
        ownerSchemaName: targetSchemaName,
        ownerTableName: targetTableName,
        reference: this.buildReferenceName(sourceSchemaName, sourceTableName),
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

  private getSchemaBuilder(schemaName: string) {
    const client = String(this.db.client.config.client || '').toLowerCase()
    if (schemaName && schemaName !== 'public' && !client.includes('sqlite')) {
      return this.db.schema.withSchema(schemaName)
    }

    return this.db.schema
  }

  private getTable(tableName: string, schemaName?: string) {
    const client = String(this.db.client.config.client || '').toLowerCase()
    if (schemaName && schemaName !== 'public' && !client.includes('sqlite')) {
      return this.db(`${schemaName}.${tableName}`)
    }

    return this.db(tableName)
  }

  private buildReferenceName(schemaName: string, tableName: string): string {
    const client = String(this.db.client.config.client || '').toLowerCase()
    if (schemaName && schemaName !== 'public' && !client.includes('sqlite')) {
      return `${schemaName}.${tableName}`
    }

    return tableName
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
    const uniqueConstraints = definition.tableConstraints.filter((constraint) => constraint.type === 'unique' && constraint.columns.length > 0)
    if (uniqueConstraints.length === 0) {
      return
    }

    const schemaName = this.resolveSchemaName(definition.tableSchema)
    const schemaBuilder = this.getSchemaBuilder(schemaName)
    const tableName = definition.tableName

    for (const constraint of uniqueConstraints) {
      const alreadyExists = await this.hasUniqueConstraint(schemaName, tableName, constraint.columns, constraint.name)
      if (alreadyExists) {
        continue
      }

      await schemaBuilder.alterTable(tableName, (table) => {
        table.unique(constraint.columns, constraint.name)
      })
    }
  }

  private async hasUniqueConstraint(
    schemaName: string,
    tableName: string,
    columns: string[],
    constraintName?: string
  ): Promise<boolean> {
    const client = String(this.db.client.config.client || '').toLowerCase()
    const normalizedColumns = columns.map((column) => column.toLowerCase())

    if (client.includes('sqlite')) {
      const indexes = await this.db.raw(`PRAGMA index_list('${tableName}')`) as Array<{ name: string; unique: number }>
      for (const index of indexes) {
        if (!index.unique) {
          continue
        }
        if (constraintName && index.name === constraintName) {
          return true
        }

        const indexColumns = await this.db.raw(`PRAGMA index_info('${index.name}')`) as Array<{ name: string }>
        const normalizedIndexColumns = indexColumns.map((column) => String(column.name).toLowerCase())
        if (
          normalizedIndexColumns.length === normalizedColumns.length
          && normalizedColumns.every((column, idx) => normalizedIndexColumns[idx] === column)
        ) {
          return true
        }
      }

      return false
    }

    const rows = await this.db
      .select(
        'tc.constraint_name as constraintName',
        'kcu.column_name as columnName',
        'kcu.ordinal_position as ordinalPosition'
      )
      .from('information_schema.table_constraints as tc')
      .join('information_schema.key_column_usage as kcu', function () {
        this.on('tc.constraint_name', '=', 'kcu.constraint_name')
          .andOn('tc.table_schema', '=', 'kcu.table_schema')
          .andOn('tc.table_name', '=', 'kcu.table_name')
      })
      .where('tc.constraint_type', 'UNIQUE')
      .andWhere('tc.table_schema', schemaName)
      .andWhere('tc.table_name', tableName)

    const columnsByConstraint = new Map<string, Array<{ name: string; position: number }>>()
    for (const row of rows as Array<{ constraintName: string; columnName: string; ordinalPosition: number }>) {
      const constraintColumns = columnsByConstraint.get(row.constraintName) ?? []
      constraintColumns.push({
        name: String(row.columnName).toLowerCase(),
        position: Number(row.ordinalPosition),
      })
      columnsByConstraint.set(row.constraintName, constraintColumns)
    }

    for (const [name, constraintColumns] of columnsByConstraint.entries()) {
      if (constraintName && name !== constraintName) {
        continue
      }

      const orderedColumns = constraintColumns
        .sort((a, b) => a.position - b.position)
        .map((column) => column.name)

      if (
        orderedColumns.length === normalizedColumns.length
        && normalizedColumns.every((column, idx) => orderedColumns[idx] === column)
      ) {
        return true
      }
    }

    return false
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
