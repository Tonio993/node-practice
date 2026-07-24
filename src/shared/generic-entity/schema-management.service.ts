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
import { SchemaIntrospectionRepository } from './schema-introspection.repository'
import {
  getBlockedDestructiveActions,
  hasValidApprovalToken,
  resolveDestructivePolicy,
} from './schema-policy.guard'
import {
  buildDiffPlan,
  createEmptyReport,
} from './schema-diff.builder'
import { SchemaApplyExecutor } from './schema-apply.executor'

const DEFAULT_SCHEMA_NAME = 'concept_configuration'

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
  private readonly applyExecutor: SchemaApplyExecutor

  constructor(
    private readonly db: Knex,
    private readonly introspection = new SchemaIntrospectionRepository(db)
  ) {
    this.applyExecutor = new SchemaApplyExecutor(
      this.introspection,
      (schemaName) => this.resolveSchemaName(schemaName)
    )
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
    const report = createEmptyReport()

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

    report.plan = buildDiffPlan(report)
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
    const destructivePolicy = resolveDestructivePolicy(options)

    if (definitions.length === 0) {
      return {
        applied: false,
        destructivePolicy,
        blockedDestructiveActions: [],
        report: createEmptyReport(),
      }
    }

    const normalizedDefinitions = CanonicalSchemaDefinitionAdapter.normalizeDefinitions(definitions)
    const report = await this.compareDefinitions(normalizedDefinitions)
    const blockedDestructiveActions = getBlockedDestructiveActions(
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
    if (options.requireApprovalToken && hasDestructiveDiffs && !hasValidApprovalToken(options)) {
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
    await this.applyExecutor.applyCanonicalDefinitions(definitions)
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
    return String(schemaName ?? DEFAULT_SCHEMA_NAME)
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
    return this.introspection.getSchemaBuilder(schemaName)
  }

  private getTable(tableName: string, schemaName?: string) {
    return this.introspection.getTable(tableName, schemaName)
  }

  private buildReferenceName(schemaName: string, tableName: string): string {
    return this.introspection.buildReferenceName(schemaName, tableName)
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

  private getUniqueConstraints(constraints: CanonicalSchemaConstraintDefinition[]): CanonicalSchemaConstraintDefinition[] {
    return constraints.filter((constraint) => constraint.type === 'unique' && constraint.columns.length > 0)
  }

  private async getExistingColumns(
    schemaName: string,
    tableName: string
  ): Promise<Map<string, { normalizedType: string; nullable: boolean }>> {
    return this.introspection.getExistingColumns(schemaName, tableName)
  }

  private async hasUniqueConstraint(
    schemaName: string,
    tableName: string,
    columns: string[],
    constraintName?: string
  ): Promise<boolean> {
    return this.introspection.hasUniqueConstraint(schemaName, tableName, columns, constraintName)
  }
}
