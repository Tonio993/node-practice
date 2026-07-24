import type {
  SchemaDiffPlan,
  SchemaDiffPlannedAction,
  SchemaDiffReport,
} from './schema-management.service'

export function createEmptyPlan(): SchemaDiffPlan {
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

export function createEmptyReport(): SchemaDiffReport {
  return {
    missingTables: [],
    missingColumns: [],
    columnTypeMismatches: [],
    columnNullabilityMismatches: [],
    missingUniqueConstraints: [],
    missingRelationColumns: [],
    plan: createEmptyPlan(),
  }
}

export function buildDiffPlan(report: SchemaDiffReport): SchemaDiffPlan {
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
