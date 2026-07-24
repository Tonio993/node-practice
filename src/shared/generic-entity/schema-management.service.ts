import type { Knex } from 'knex'
import { toSnakeCase } from '../utils/case.util'
import type { EngineEntityDefinition } from './engine-entity-definition'
import { SchemaConceptDefinition, SchemaFieldDefinition, SchemaRelationDefinition } from './schema-definition'

export class SchemaManagementService {
  constructor(private readonly db: Knex) {}

  async syncFromConfiguration(): Promise<void> {
    const concepts = await this.loadConceptDefinitions()
    await this.applyConceptDefinitions(concepts)
  }

  async syncFromDefinitions(definitions: EngineEntityDefinition[]): Promise<void> {
    const concepts = this.mapEngineDefinitionsToConceptDefinitions(definitions)
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
        this.applyCreateTableConstraints(table, concept)
      })
      return
    }

    const existingColumns = new Set<string>()
    for (const field of concept.fields) {
      const hasColumn = await schemaBuilder.hasColumn(tableName, this.resolveFieldColumnName(field))
      if (hasColumn) {
        existingColumns.add(this.resolveFieldColumnName(field))
      }
    }

    const missingColumns = concept.fields.filter((field) => !existingColumns.has(this.resolveFieldColumnName(field)))

    if (missingColumns.length > 0) {
      await schemaBuilder.alterTable(tableName, (table) => {
        for (const field of missingColumns) {
          this.applyColumn(table, field)
        }
      })
    }

    await this.ensureUniqueConstraints(concept)
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

  private applyCreateTableConstraints(table: Knex.CreateTableBuilder, concept: SchemaConceptDefinition): void {
    for (const constraint of concept.tableConstraints) {
      if (constraint.type !== 'unique' || !constraint.columns.length) {
        continue
      }

      table.unique(constraint.columns, constraint.name)
    }
  }

  private async ensureUniqueConstraints(concept: SchemaConceptDefinition): Promise<void> {
    const uniqueConstraints = concept.tableConstraints.filter((constraint) => constraint.type === 'unique' && constraint.columns.length > 0)
    if (uniqueConstraints.length === 0) {
      return
    }

    const schemaBuilder = this.getSchemaBuilder(concept.getResolvedTableSchema())
    const tableName = concept.getResolvedTableName()

    for (const constraint of uniqueConstraints) {
      const alreadyExists = await this.hasUniqueConstraint(concept.getResolvedTableSchema(), tableName, constraint.columns, constraint.name)
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
    const columnName = this.resolveFieldColumnName(field)

    switch (field.type.toLowerCase()) {
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

  private resolveFieldColumnName(field: SchemaFieldDefinition): string {
    return toSnakeCase(String(field.columnName ?? field.name))
  }

  private mapEngineDefinitionsToConceptDefinitions(definitions: EngineEntityDefinition[]): SchemaConceptDefinition[] {
    const conceptsByTableName = new Map<string, { id: number; definition: EngineEntityDefinition }>()
    const concepts = definitions.map((definition, index) => {
      const conceptId = index + 1
      conceptsByTableName.set(definition.tableName, { id: conceptId, definition })

      const fields = definition.columns.map((column) => new SchemaFieldDefinition(
        column.name,
        column.type,
        {
          nullable: column.nullable,
          unique: column.unique,
          defaultValue: column.defaultValue,
          primaryKey: column.primaryKey,
          columnName: column.name,
          label: column.label,
          description: column.description,
          position: column.position,
        }
      ))

      return new SchemaConceptDefinition(
        conceptId,
        definition.name,
        definition.tableName,
        definition.tableSchema,
        fields,
        [],
        definition.tableConstraints.map((constraint) => ({ ...constraint }))
      )
    })

    let relationId = 1
    for (const concept of concepts) {
      const sourceDefinition = definitions.find((definition) => definition.tableName === concept.getResolvedTableName())
      if (!sourceDefinition) {
        continue
      }

      const appendRelation = (
        relationType: 'oneToMany' | 'manyToOne' | 'oneToOne',
        relation: { targetTableName: string; foreignKey: string; mappedBy?: string; propertyKey: string }
      ) => {
        const target = conceptsByTableName.get(relation.targetTableName)
        if (!target) {
          return
        }

        concept.relations.push(new SchemaRelationDefinition(
          relationId++,
          concept.id,
          target.id,
          relationType,
          relation.foreignKey,
          relation.mappedBy,
          relation.propertyKey,
          relation.mappedBy
        ))
      }

      for (const relation of sourceDefinition.relations.oneToMany) {
        appendRelation('oneToMany', relation)
      }
      for (const relation of sourceDefinition.relations.manyToOne) {
        appendRelation('manyToOne', relation)
      }
      for (const relation of sourceDefinition.relations.oneToOne) {
        appendRelation('oneToOne', relation)
      }
    }

    return concepts
  }
}
