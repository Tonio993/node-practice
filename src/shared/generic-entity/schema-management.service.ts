import type { Knex } from 'knex'

export interface SchemaFieldDefinition {
  name: string
  type: string
  nullable?: boolean
  unique?: boolean
  defaultValue?: unknown
  primaryKey?: boolean
}

export interface SchemaConceptDefinition {
  id: number
  name: string
  tableName?: string | null
  tableSchema?: string | null
  fields: SchemaFieldDefinition[]
}

export class SchemaManagementService {
  constructor(private readonly db: Knex) {}

  async syncFromConfiguration(): Promise<void> {
    const concepts = await this.loadConceptDefinitions()

    for (const concept of concepts) {
      await this.ensureTable(concept)
    }
  }

  private async loadConceptDefinitions(): Promise<SchemaConceptDefinition[]> {
    const conceptRows = await this.getTable('concept', 'concept_configuration').select('*')
    const fieldRows = await this.getTable('concept_field', 'concept_configuration').select('*')

    const fieldsByConcept = fieldRows.reduce<Record<number, SchemaFieldDefinition[]>>((acc, row) => {
      const conceptId = Number(row.id_concept)
      acc[conceptId] ||= []
      acc[conceptId].push({
        name: row.name,
        type: row.type,
        nullable: row.nullable ?? true,
        unique: Boolean(row.unique),
        defaultValue: row.default_value ?? undefined,
        primaryKey: Boolean(row.primary_key),
      })
      return acc
    }, {})

    return conceptRows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      tableName: row.table_name ?? row.name,
      tableSchema: row.table_schema ?? 'concept_configuration',
      fields: fieldsByConcept[Number(row.id)] ?? [],
    }))
  }

  private async ensureTable(concept: SchemaConceptDefinition): Promise<void> {
    const schemaName = concept.tableSchema ?? 'concept_configuration'
    const tableName = String(concept.tableName ?? concept.name).toLowerCase()

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
