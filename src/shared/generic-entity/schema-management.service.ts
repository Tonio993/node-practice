import type { Knex } from 'knex'
import { toSnakeCase } from '../utils/case.util'
import {
  CanonicalSchemaColumnDefinition,
  CanonicalSchemaDefinition,
  CanonicalSchemaConstraintDefinition,
  CanonicalSchemaDefinitionAdapter,
  CanonicalSchemaRelationDefinition,
  CanonicalSchemaRelationType,
} from './canonical-schema-definition'

export interface SchemaColumnDiff {
  schemaName: string
  tableName: string
  columnName: string
  expectedType?: string
  actualType?: string
  expectedNullable?: boolean
  actualNullable?: boolean
}

export interface SchemaConstraintDiff {
  schemaName: string
  tableName: string
  constraintName?: string
  columns: string[]
}

export interface SchemaRelationDiff {
  ownerSchemaName: string
  ownerTableName: string
  reference: string
  columnName: string
  unique: boolean
}

export interface SchemaDiffReport {
  missingTables: Array<{ schemaName: string; tableName: string; logicalName: string }>
  missingColumns: SchemaColumnDiff[]
  columnTypeMismatches: SchemaColumnDiff[]
  columnNullabilityMismatches: SchemaColumnDiff[]
  missingUniqueConstraints: SchemaConstraintDiff[]
  missingRelationColumns: SchemaRelationDiff[]
  plan: SchemaDiffPlan
}

export type SchemaDiffActionKind =
  | 'createTable'
  | 'addColumn'
  | 'alterColumnType'
  | 'alterColumnNullability'
  | 'addUniqueConstraint'
  | 'addRelationColumn'

export type SchemaDiffRiskLevel = 'safe' | 'destructive'
export type SchemaDiffSeverity = 'info' | 'warning' | 'error'

export interface SchemaDiffPlannedAction {
  kind: SchemaDiffActionKind
  risk: SchemaDiffRiskLevel
  severity: SchemaDiffSeverity
  schemaName: string
  tableName: string
  target: string
  reason: string
}

export interface SchemaDiffPlan {
  safeActions: SchemaDiffPlannedAction[]
  destructiveActions: SchemaDiffPlannedAction[]
  summary: {
    totalActions: number
    safeActions: number
    destructiveActions: number
  }
}

export interface SchemaSyncOptions {
  dryRun?: boolean
  destructivePolicy?: SchemaDestructivePolicy
  allowDestructiveActions?: SchemaDiffActionKind[]
  requireApprovalToken?: boolean
  approvalToken?: string
  failOnDestructive?: boolean
}

export type SchemaDestructivePolicy = 'signal' | 'block'

export interface SchemaSyncExecutionResult {
  applied: boolean
  report: SchemaDiffReport
  destructivePolicy: SchemaDestructivePolicy
  blockedDestructiveActions: SchemaDiffPlannedAction[]
}

export class SchemaSyncGuardError extends Error {
  constructor(public readonly report: SchemaDiffReport) {
    super('Destructive schema changes detected. Sync aborted by guardrail policy.')
    this.name = 'SchemaSyncGuardError'
  }
}

export class SchemaSyncApprovalError extends Error {
  constructor(public readonly report: SchemaDiffReport) {
    super('Destructive schema changes require a valid approval token. Sync aborted by policy.')
    this.name = 'SchemaSyncApprovalError'
  }
}

export class SchemaManagementService {
  constructor(private readonly db: Knex) {}

  private hasValidApprovalToken(options: SchemaSyncOptions): boolean {
    const expectedToken = process.env.SCHEMA_SYNC_APPROVAL_TOKEN
    const providedToken = options.approvalToken?.trim()
    if (!expectedToken || !providedToken) {
      return false
    }

    return providedToken === expectedToken
  }

  private getBlockedDestructiveActions(
    destructiveActions: SchemaDiffPlannedAction[],
    allowDestructiveActions: SchemaDiffActionKind[] | undefined
  ): SchemaDiffPlannedAction[] {
    if (!allowDestructiveActions?.length) {
      return destructiveActions
    }

    const allowedKinds = new Set(allowDestructiveActions)
    return destructiveActions.filter((action) => !allowedKinds.has(action.kind))
  }

  private resolveDestructivePolicy(options: SchemaSyncOptions): SchemaDestructivePolicy {
    // Backward compatible path: explicit boolean option still wins if provided.
    if (options.failOnDestructive !== undefined) {
      return options.failOnDestructive ? 'block' : 'signal'
    }

    return options.destructivePolicy ?? 'signal'
  }

  private createEmptyPlan(): SchemaDiffPlan {
    return {
      safeActions: [],
      destructiveActions: [],
      summary: {
        totalActions: 0,
        safeActions: 0,
        destructiveActions: 0,
      },
    }
  }

  async compareFromConfiguration(): Promise<SchemaDiffReport> {
    const definitions = await this.loadCanonicalDefinitionsFromConfiguration()
    return this.compareDefinitions(definitions)
  }

  async syncFromConfigurationWithPlan(options: SchemaSyncOptions = {}): Promise<SchemaSyncExecutionResult> {
    const definitions = await this.loadCanonicalDefinitionsFromConfiguration()
    return this.syncCanonicalDefinitions(definitions, options)
  }

  async syncFromDefinitionsWithPlan(
    definitions: CanonicalSchemaDefinition[],
    options: SchemaSyncOptions = {}
  ): Promise<SchemaSyncExecutionResult> {
    return this.syncCanonicalDefinitions(definitions, options)
  }

  async compareDefinitions(definitions: CanonicalSchemaDefinition[]): Promise<SchemaDiffReport> {
    const report: SchemaDiffReport = {
      missingTables: [],
      missingColumns: [],
      columnTypeMismatches: [],
      columnNullabilityMismatches: [],
      missingUniqueConstraints: [],
      missingRelationColumns: [],
      plan: this.createEmptyPlan(),
    }

    if (definitions.length === 0) {
      return report
    }

    const normalizedDefinitions = CanonicalSchemaDefinitionAdapter.normalizeDefinitions(definitions)
    const definitionsByTable = this.groupDefinitionsByTableName(normalizedDefinitions)

    for (const definition of normalizedDefinitions) {
      const schemaName = this.resolveSchemaName(definition.tableSchema)
      const tableName = definition.tableName
      const schemaBuilder = this.getSchemaBuilder(schemaName)
      const exists = await schemaBuilder.hasTable(tableName)

      if (!exists) {
        report.missingTables.push({
          schemaName,
          tableName,
          logicalName: definition.logicalName,
        })
        continue
      }

      const existingColumns = await this.getExistingColumns(schemaName, tableName)
      for (const column of definition.columns) {
        const expectedType = this.normalizeExpectedType(column)
        const existingColumn = existingColumns.get(column.columnName.toLowerCase())

        if (!existingColumn) {
          report.missingColumns.push({
            schemaName,
            tableName,
            columnName: column.columnName,
            expectedType,
            expectedNullable: this.resolveExpectedNullable(column),
          })
          continue
        }

        if (expectedType !== existingColumn.normalizedType) {
          report.columnTypeMismatches.push({
            schemaName,
            tableName,
            columnName: column.columnName,
            expectedType,
            actualType: existingColumn.normalizedType,
          })
        }

        const expectedNullable = this.resolveExpectedNullable(column)
        if (expectedNullable !== existingColumn.nullable) {
          report.columnNullabilityMismatches.push({
            schemaName,
            tableName,
            columnName: column.columnName,
            expectedNullable,
            actualNullable: existingColumn.nullable,
          })
        }
      }

      const uniqueConstraints = this.getUniqueConstraints(definition.tableConstraints)
      for (const constraint of uniqueConstraints) {
        const alreadyExists = await this.hasUniqueConstraint(schemaName, tableName, constraint.columns, constraint.name)
        if (!alreadyExists) {
          report.missingUniqueConstraints.push({
            schemaName,
            tableName,
            constraintName: constraint.name,
            columns: [...constraint.columns],
          })
        }
      }
    }

    for (const definition of normalizedDefinitions) {
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
        if (!hasColumn) {
          report.missingRelationColumns.push({
            ownerSchemaName: relationContext.ownerSchemaName,
            ownerTableName: relationContext.ownerTableName,
            reference: relationContext.reference,
            columnName: relationContext.columnName,
            unique: relationContext.unique,
          })
          continue
        }

        if (relationContext.unique) {
          const uniqueExists = await this.hasUniqueConstraint(
            relationContext.ownerSchemaName,
            relationContext.ownerTableName,
            [relationContext.columnName]
          )
          if (!uniqueExists) {
            report.missingUniqueConstraints.push({
              schemaName: relationContext.ownerSchemaName,
              tableName: relationContext.ownerTableName,
              columns: [relationContext.columnName],
            })
          }
        }
      }
    }

    report.plan = this.buildDiffPlan(report)
    return report
  }

  async syncFromConfiguration(): Promise<void> {
    await this.syncFromConfigurationWithPlan()
  }

  async syncFromDefinitions(definitions: CanonicalSchemaDefinition[]): Promise<void> {
    await this.syncFromDefinitionsWithPlan(definitions)
  }

  private async syncCanonicalDefinitions(
    definitions: CanonicalSchemaDefinition[],
    options: SchemaSyncOptions = {}
  ): Promise<SchemaSyncExecutionResult> {
    const destructivePolicy = this.resolveDestructivePolicy(options)

    if (definitions.length === 0) {
      return {
        applied: false,
        destructivePolicy,
        blockedDestructiveActions: [],
        report: {
          missingTables: [],
          missingColumns: [],
          columnTypeMismatches: [],
          columnNullabilityMismatches: [],
          missingUniqueConstraints: [],
          missingRelationColumns: [],
          plan: this.createEmptyPlan(),
        },
      }
    }

    const normalizedDefinitions = CanonicalSchemaDefinitionAdapter.normalizeDefinitions(definitions)
    const report = await this.compareDefinitions(normalizedDefinitions)
    const blockedDestructiveActions = this.getBlockedDestructiveActions(
      report.plan.destructiveActions,
      options.allowDestructiveActions
    )

    if (destructivePolicy === 'block' && blockedDestructiveActions.length > 0) {
      throw new SchemaSyncGuardError(report)
    }

    if (destructivePolicy === 'signal' && blockedDestructiveActions.length > 0) {
      return {
        applied: false,
        destructivePolicy,
        blockedDestructiveActions,
        report,
      }
    }

    const hasDestructiveDiffs = report.plan.destructiveActions.length > 0
    if (options.requireApprovalToken && hasDestructiveDiffs && !this.hasValidApprovalToken(options)) {
      throw new SchemaSyncApprovalError(report)
    }

    if (options.dryRun) {
      return {
        applied: false,
        destructivePolicy,
        blockedDestructiveActions,
        report,
      }
    }

    await this.applyCanonicalDefinitions(normalizedDefinitions)
    return {
      applied: true,
      destructivePolicy,
      blockedDestructiveActions,
      report,
    }
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

  private normalizeExpectedType(column: CanonicalSchemaColumnDefinition): string {
    const normalized = String(column.dataType || '').trim().toLowerCase()
    if (normalized === 'string' || normalized === 'varchar' || normalized === 'text' || normalized === 'character varying') {
      return 'string'
    }
    if (normalized === 'integer' || normalized === 'int' || normalized === 'int4' || normalized === 'bigint' || normalized === 'int8') {
      return 'integer'
    }
    if (normalized === 'boolean' || normalized === 'bool') {
      return 'boolean'
    }
    if (normalized === 'date') {
      return 'date'
    }
    if (normalized === 'datetime' || normalized === 'timestamp' || normalized === 'timestamp without time zone') {
      return 'datetime'
    }
    if (normalized === 'json' || normalized === 'jsonb') {
      return 'json'
    }
    if (normalized === 'decimal' || normalized === 'float' || normalized === 'number' || normalized === 'real' || normalized === 'numeric') {
      return 'float'
    }

    return normalized || 'string'
  }

  private resolveExpectedNullable(column: CanonicalSchemaColumnDefinition): boolean {
    if (column.primaryKey) {
      return false
    }

    return column.nullable !== false
  }

  private normalizeActualType(value: unknown): string {
    const normalized = String(value || '').trim().toLowerCase()
    if (normalized.includes('char') || normalized.includes('text')) {
      return 'string'
    }
    if (normalized === 'integer' || normalized === 'int' || normalized === 'int4' || normalized === 'bigint' || normalized === 'int8') {
      return 'integer'
    }
    if (normalized === 'boolean' || normalized === 'bool') {
      return 'boolean'
    }
    if (normalized === 'date') {
      return 'date'
    }
    if (normalized.includes('timestamp') || normalized.includes('datetime')) {
      return 'datetime'
    }
    if (normalized === 'json' || normalized === 'jsonb') {
      return 'json'
    }
    if (normalized === 'real' || normalized === 'numeric' || normalized === 'decimal' || normalized === 'float' || normalized === 'double precision') {
      return 'float'
    }

    return normalized || 'string'
  }

  private getUniqueConstraints(constraints: CanonicalSchemaConstraintDefinition[]): CanonicalSchemaConstraintDefinition[] {
    return constraints.filter((constraint) => constraint.type === 'unique' && constraint.columns.length > 0)
  }

  private async getExistingColumns(
    schemaName: string,
    tableName: string
  ): Promise<Map<string, { normalizedType: string; nullable: boolean }>> {
    const client = String(this.db.client.config.client || '').toLowerCase()
    const columns = new Map<string, { normalizedType: string; nullable: boolean }>()

    if (client.includes('sqlite')) {
      const rows = await this.db.raw(`PRAGMA table_info('${tableName}')`) as Array<{
        name: string
        type: string
        notnull: number
      }>

      for (const row of rows) {
        columns.set(String(row.name).toLowerCase(), {
          normalizedType: this.normalizeActualType(row.type),
          nullable: Number(row.notnull) === 0,
        })
      }

      return columns
    }

    const rows = await this.db
      .select('column_name as columnName', 'data_type as dataType', 'is_nullable as isNullable')
      .from('information_schema.columns')
      .where('table_schema', schemaName)
      .andWhere('table_name', tableName)

    for (const row of rows as Array<{ columnName: string; dataType: string; isNullable: string }>) {
      columns.set(String(row.columnName).toLowerCase(), {
        normalizedType: this.normalizeActualType(row.dataType),
        nullable: String(row.isNullable).toUpperCase() === 'YES',
      })
    }

    return columns
  }

  private buildDiffPlan(report: SchemaDiffReport): SchemaDiffPlan {
    const safeActions: SchemaDiffPlannedAction[] = []
    const destructiveActions: SchemaDiffPlannedAction[] = []

    for (const table of report.missingTables) {
      safeActions.push({
        kind: 'createTable',
        risk: 'safe',
        severity: 'warning',
        schemaName: table.schemaName,
        tableName: table.tableName,
        target: table.tableName,
        reason: `Table ${table.tableName} is missing and should be created`,
      })
    }

    for (const column of report.missingColumns) {
      safeActions.push({
        kind: 'addColumn',
        risk: 'safe',
        severity: 'warning',
        schemaName: column.schemaName,
        tableName: column.tableName,
        target: column.columnName,
        reason: `Column ${column.columnName} is missing`,
      })
    }

    for (const constraint of report.missingUniqueConstraints) {
      safeActions.push({
        kind: 'addUniqueConstraint',
        risk: 'safe',
        severity: 'warning',
        schemaName: constraint.schemaName,
        tableName: constraint.tableName,
        target: constraint.constraintName ?? constraint.columns.join(','),
        reason: `Unique constraint on columns ${constraint.columns.join(', ')} is missing`,
      })
    }

    for (const relation of report.missingRelationColumns) {
      safeActions.push({
        kind: 'addRelationColumn',
        risk: 'safe',
        severity: 'warning',
        schemaName: relation.ownerSchemaName,
        tableName: relation.ownerTableName,
        target: relation.columnName,
        reason: `Relation foreign key column ${relation.columnName} is missing`,
      })
    }

    for (const mismatch of report.columnTypeMismatches) {
      destructiveActions.push({
        kind: 'alterColumnType',
        risk: 'destructive',
        severity: 'error',
        schemaName: mismatch.schemaName,
        tableName: mismatch.tableName,
        target: mismatch.columnName,
        reason: `Column type mismatch (${mismatch.actualType} -> ${mismatch.expectedType}) may require destructive migration`,
      })
    }

    for (const mismatch of report.columnNullabilityMismatches) {
      const shouldTightenNullability = mismatch.expectedNullable === false && mismatch.actualNullable === true
      const action: SchemaDiffPlannedAction = {
        kind: 'alterColumnNullability',
        risk: shouldTightenNullability ? 'destructive' : 'safe',
        severity: shouldTightenNullability ? 'error' : 'warning',
        schemaName: mismatch.schemaName,
        tableName: mismatch.tableName,
        target: mismatch.columnName,
        reason: shouldTightenNullability
          ? `Making column ${mismatch.columnName} NOT NULL may fail if null rows exist`
          : `Column ${mismatch.columnName} can be relaxed to nullable`,
      }

      if (shouldTightenNullability) {
        destructiveActions.push(action)
      } else {
        safeActions.push(action)
      }
    }

    return {
      safeActions,
      destructiveActions,
      summary: {
        totalActions: safeActions.length + destructiveActions.length,
        safeActions: safeActions.length,
        destructiveActions: destructiveActions.length,
      },
    }
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
