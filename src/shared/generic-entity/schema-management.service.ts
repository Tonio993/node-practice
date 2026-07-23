import type { Knex } from 'knex'
import { toSnakeCase } from '../utils/case.util'

export interface SchemaFieldDefinition {
  name: string
  type: string
  nullable?: boolean
  unique?: boolean
  defaultValue?: unknown
  primaryKey?: boolean
  columnName?: string
  label?: string
  description?: string
  position?: number
}

export interface SchemaRelationDefinition {
  id: number
  sourceConceptId: number
  targetConceptId: number
  relationType: string
  foreignKey: string
  mappedBy?: string
  sourceField?: string
  targetField?: string
}

export interface SchemaConceptDefinition {
  id: number
  name: string
  tableName?: string | null
  tableSchema?: string | null
  fields: SchemaFieldDefinition[]
  relations: SchemaRelationDefinition[]
}

export class SchemaManagementService {
  constructor(private readonly db: Knex) {}

  async syncFromConfiguration(): Promise<void> {
    const concepts = await this.loadConceptDefinitions()
    const conceptsById = new Map(concepts.map((concept) => [concept.id, concept]))

    for (const concept of concepts) {
      await this.ensureTable(concept)
    }

    for (const concept of concepts) {
      await this.ensureRelations(concept, conceptsById)
    }
  }

  private async loadConceptDefinitions(): Promise<SchemaConceptDefinition[]> {
    const conceptRows = await this.getTable('concept', 'concept_configuration').select('*')
    const fieldRows = await this.getTable('concept_field', 'concept_configuration').select('*')
    const relationRows = await this.getTable('concept_relation', 'concept_configuration').select('*')

    const fieldsByConcept = this.groupFieldsByConcept(fieldRows)
    const relationsByConcept = this.groupRelationsByConcept(relationRows)

    return conceptRows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      tableName: row.table_name ?? row.name,
      tableSchema: row.table_schema ?? 'concept_configuration',
      fields: fieldsByConcept[Number(row.id)] ?? [],
      relations: relationsByConcept[Number(row.id)] ?? [],
    }))
  }

  private groupFieldsByConcept(fieldRows: Array<Record<string, any>>): Record<number, SchemaFieldDefinition[]> {
    return fieldRows.reduce<Record<number, SchemaFieldDefinition[]>>((acc, row) => {
      const conceptId = Number(row.id_concept)
      acc[conceptId] ||= []
      acc[conceptId].push({
        name: row.name,
        type: row.type,
        nullable: row.nullable ?? true,
        unique: Boolean(row.unique),
        defaultValue: row.default_value ?? undefined,
        primaryKey: Boolean(row.primary_key),
        columnName: row.column_name ?? undefined,
        label: row.label ?? undefined,
        description: row.description ?? undefined,
        position: row.position !== undefined ? Number(row.position) : undefined,
      })
      return acc
    }, {})
  }

  private groupRelationsByConcept(relationRows: Array<Record<string, any>>): Record<number, SchemaRelationDefinition[]> {
    return relationRows.reduce<Record<number, SchemaRelationDefinition[]>>((acc, row) => {
      const conceptId = Number(row.id_concept_source)
      acc[conceptId] ||= []
      acc[conceptId].push({
        id: Number(row.id),
        sourceConceptId: conceptId,
        targetConceptId: Number(row.id_concept_target),
        relationType: row.relation_type,
        foreignKey: row.foreign_key,
        mappedBy: row.mapped_by ?? undefined,
        sourceField: row.source_field ?? undefined,
        targetField: row.target_field ?? undefined,
      })
      return acc
    }, {})
  }

  private async ensureTable(concept: SchemaConceptDefinition): Promise<void> {
    const schemaName = concept.tableSchema ?? 'concept_configuration'
    const tableName = toSnakeCase(String(concept.tableName ?? concept.name))

    const schemaBuilder = this.getSchemaBuilder(schemaName)
    const exists = await schemaBuilder.hasTable(tableName)
    if (!exists) {
      await schemaBuilder.createTable(tableName, (table) => {
        this.applyColumns(table, concept.fields)
      })
      return
    }

    const existingColumns = new Set<string>()
    for (const field of concept.fields) {
      const hasColumn = await schemaBuilder.hasColumn(tableName, field.name)
      if (hasColumn) {
        existingColumns.add(field.name)
      }
    }

    const missingColumns = concept.fields.filter((field) => !existingColumns.has(field.name))

    if (missingColumns.length > 0) {
      await schemaBuilder.alterTable(tableName, (table) => {
        for (const field of missingColumns) {
          this.applyColumn(table, field)
        }
      })
    }
  }

  private async ensureRelations(concept: SchemaConceptDefinition, conceptsById: Map<number, SchemaConceptDefinition>): Promise<void> {
    const schemaName = concept.tableSchema ?? 'concept_configuration'
    const tableName = toSnakeCase(String(concept.tableName ?? concept.name))
    const schemaBuilder = this.getSchemaBuilder(schemaName)

    for (const relation of concept.relations) {
      const targetConcept = conceptsById.get(relation.targetConceptId)
      if (!targetConcept) {
        continue
      }

      const targetSchemaName = targetConcept.tableSchema ?? 'concept_configuration'
      const targetTableName = toSnakeCase(String(targetConcept.tableName ?? targetConcept.name))
      const columnName = relation.foreignKey || relation.targetField || `${toSnakeCase(targetConcept.name)}_id`
      const reference = this.buildReferenceName(targetSchemaName, targetTableName)

      const hasColumn = await schemaBuilder.hasColumn(tableName, columnName)
      if (hasColumn) {
        continue
      }

      await schemaBuilder.alterTable(tableName, (table) => {
        table.integer(columnName).unsigned().references('id').inTable(reference)
      })
    }
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

  private applyColumns(table: Knex.CreateTableBuilder, fields: SchemaFieldDefinition[]): void {
    table.increments('id').notNullable()

    for (const field of fields) {
      this.applyColumn(table, field)
    }
  }

  private applyColumn(table: Knex.CreateTableBuilder | Knex.AlterTableBuilder, field: SchemaFieldDefinition): void {
    const columnBuilder = this.createColumnBuilder(table, field)

    if (field.primaryKey) {
      columnBuilder.primary()
    }

    if (field.unique) {
      columnBuilder.unique()
    }

    if (field.nullable === false) {
      columnBuilder.notNullable()
    }

    if (field.defaultValue !== undefined) {
      columnBuilder.defaultTo(field.defaultValue as any)
    }
  }

  private createColumnBuilder(table: Knex.CreateTableBuilder | Knex.AlterTableBuilder, field: SchemaFieldDefinition) {
    switch (field.type.toLowerCase()) {
      case 'string':
      case 'varchar':
      case 'text':
        return table.string(field.name)
      case 'integer':
      case 'int':
        return table.integer(field.name)
      case 'boolean':
      case 'bool':
        return table.boolean(field.name)
      case 'date':
        return table.date(field.name)
      case 'datetime':
      case 'timestamp':
        return table.datetime(field.name)
      case 'json':
        return table.json(field.name)
      case 'decimal':
      case 'float':
      case 'number':
        return table.float(field.name)
      default:
        return table.string(field.name)
    }
  }
}
