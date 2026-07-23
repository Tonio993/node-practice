import type { Knex } from 'knex'
import { toSnakeCase } from '../utils/case.util'
import { SchemaConceptDefinition, SchemaFieldDefinition, SchemaRelationDefinition } from './schema-definition'

export class SchemaManagementService {
  constructor(private readonly db: Knex) {}

  async syncFromConfiguration(): Promise<void> {
    const concepts = await this.loadConceptDefinitions()
    await this.applyConceptDefinitions(concepts)
  }

  private async applyConceptDefinitions(concepts: SchemaConceptDefinition[]): Promise<void> {
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

    return this.mapRowsToConceptDefinitions(conceptRows, fieldRows, relationRows)
  }

  private mapRowsToConceptDefinitions(
    conceptRows: Array<Record<string, any>>,
    fieldRows: Array<Record<string, any>>,
    relationRows: Array<Record<string, any>>
  ): SchemaConceptDefinition[] {

    const fieldsByConcept = this.groupFieldsByConcept(fieldRows)
    const relationsByConcept = this.groupRelationsByConcept(relationRows)

    return conceptRows.map((row) => new SchemaConceptDefinition(
      Number(row.id),
      row.name,
      row.table_name ?? row.name,
      row.table_schema ?? 'concept_configuration',
      fieldsByConcept[Number(row.id)] ?? [],
      relationsByConcept[Number(row.id)] ?? []
    ))
  }

  private groupFieldsByConcept(fieldRows: Array<Record<string, any>>): Record<number, SchemaFieldDefinition[]> {
    return fieldRows.reduce<Record<number, SchemaFieldDefinition[]>>((acc, row) => {
      const conceptId = Number(row.id_concept)
      acc[conceptId] ||= []
      acc[conceptId].push(new SchemaFieldDefinition(row.name, row.type, {
        nullable: row.nullable ?? true,
        unique: Boolean(row.unique),
        defaultValue: row.default_value ?? undefined,
        primaryKey: Boolean(row.primary_key),
        columnName: row.column_name ?? undefined,
        label: row.label ?? undefined,
        description: row.description ?? undefined,
        position: row.position !== undefined ? Number(row.position) : undefined,
      }))
      return acc
    }, {})
  }

  private groupRelationsByConcept(relationRows: Array<Record<string, any>>): Record<number, SchemaRelationDefinition[]> {
    return relationRows.reduce<Record<number, SchemaRelationDefinition[]>>((acc, row) => {
      const conceptId = Number(row.id_concept_source)
      acc[conceptId] ||= []
      acc[conceptId].push(new SchemaRelationDefinition(
        Number(row.id),
        conceptId,
        Number(row.id_concept_target),
        row.relation_type,
        row.foreign_key,
        row.mapped_by ?? undefined,
        row.source_field ?? undefined,
        row.target_field ?? undefined
      ))
      return acc
    }, {})
  }

  private async ensureTable(concept: SchemaConceptDefinition): Promise<void> {
    const schemaName = concept.getResolvedTableSchema()
    const tableName = concept.getResolvedTableName()

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
    for (const relation of concept.relations) {
      const relationContext = this.resolveRelationContext(relation, concept, conceptsById)
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
    relation: SchemaRelationDefinition,
    sourceConcept: SchemaConceptDefinition,
    conceptsById: Map<number, SchemaConceptDefinition>
  ): {
    ownerSchemaName: string
    ownerTableName: string
    reference: string
    columnName: string
    unique: boolean
  } | null {
    const targetConcept = conceptsById.get(relation.targetConceptId)
    if (!targetConcept) {
      return null
    }

    const sourceSchemaName = sourceConcept.getResolvedTableSchema()
    const sourceTableName = sourceConcept.getResolvedTableName()
    const targetSchemaName = targetConcept.getResolvedTableSchema()
    const targetTableName = targetConcept.getResolvedTableName()

    if (relation.isManyToOne() || relation.isOneToOne()) {
      return {
        ownerSchemaName: sourceSchemaName,
        ownerTableName: sourceTableName,
        reference: this.buildReferenceName(targetSchemaName, targetTableName),
        columnName: this.resolveForeignKeyColumnName(relation, targetConcept),
        unique: relation.requiresUniqueForeignKey(),
      }
    }

    if (relation.isOneToMany()) {
      return {
        ownerSchemaName: targetSchemaName,
        ownerTableName: targetTableName,
        reference: this.buildReferenceName(sourceSchemaName, sourceTableName),
        columnName: this.resolveForeignKeyColumnName(relation, sourceConcept),
        unique: false,
      }
    }

    return null
  }

  private resolveForeignKeyColumnName(relation: SchemaRelationDefinition, defaultTargetConcept: SchemaConceptDefinition): string {
    const rawName = relation.foreignKey || relation.targetField || `${toSnakeCase(defaultTargetConcept.name)}_id`
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
