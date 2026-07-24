import type { Knex } from 'knex'

const PUBLIC_SCHEMA_NAME = 'public'
const SQLITE_CLIENT_TOKEN = 'sqlite'

export class SchemaIntrospectionRepository {
  constructor(private readonly db: Knex) {}

  getSchemaBuilder(schemaName: string) {
    if (this.useSchemaQualification(schemaName)) {
      return this.db.schema.withSchema(schemaName)
    }

    return this.db.schema
  }

  getTable(tableName: string, schemaName?: string) {
    if (this.useSchemaQualification(schemaName)) {
      return this.db(`${schemaName}.${tableName}`)
    }

    return this.db(tableName)
  }

  buildReferenceName(schemaName: string, tableName: string): string {
    if (this.useSchemaQualification(schemaName)) {
      return `${schemaName}.${tableName}`
    }

    return tableName
  }

  async getExistingColumns(
    schemaName: string,
    tableName: string
  ): Promise<Map<string, { normalizedType: string; nullable: boolean }>> {
    const columns = new Map<string, { normalizedType: string; nullable: boolean }>()

    if (this.isSqliteClient()) {
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

  async hasUniqueConstraint(
    schemaName: string,
    tableName: string,
    columns: string[],
    constraintName?: string
  ): Promise<boolean> {
    const normalizedColumns = columns.map((column) => column.toLowerCase())

    if (this.isSqliteClient()) {
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

  private getClientName(): string {
    return String(this.db.client.config.client || '').toLowerCase()
  }

  private isSqliteClient(): boolean {
    return this.getClientName().includes(SQLITE_CLIENT_TOKEN)
  }

  private useSchemaQualification(schemaName: string | undefined): boolean {
    return Boolean(schemaName && schemaName !== PUBLIC_SCHEMA_NAME && !this.isSqliteClient())
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
}
