# Canonical DDL Model - Step 1 Specification

## Scope
This document defines the perimeter of the canonical model used by the DDL engine.
The model represents desired schema state independently from the source of metadata.

Input sources are intentionally external to this model:
- static metadata from decorators
- runtime configuration rows from concept catalog tables

## Canonical Unit
The canonical model is a list of entity definitions.

Each entity definition describes:
- logicalName: logical entity name used for diagnostics and traceability
- tableName: physical table name
- tableSchema: optional schema name, default managed by engine policy
- columns: set of physical columns
- tableConstraints: table-level constraints
- relations: relation definitions sufficient to derive foreign key operations

## Canonical Fields

### Entity Fields
- logicalName: string (required)
- tableName: string (required)
- tableSchema: string | undefined (optional)
- columns: CanonicalColumnDefinition[] (required, can be empty)
- tableConstraints: CanonicalTableConstraintDefinition[] (required, can be empty)
- relations: CanonicalRelationDefinition[] (required, can be empty)

### Column Fields
- columnName: string (required)
- dataType: string (required)
- nullable: boolean | undefined (optional)
- unique: boolean | undefined (optional)
- defaultValue: unknown | undefined (optional)
- primaryKey: boolean | undefined (optional)
- label: string | undefined (optional, documentation metadata)
- description: string | undefined (optional, documentation metadata)
- position: number | undefined (optional, presentation/order metadata)

### Table Constraint Fields
- type: 'unique' | 'primary' | 'foreignKey' (required)
- columns: string[] (required, ordered)
- name: string | undefined (optional)

### Relation Fields
- relationType: 'manyToOne' | 'oneToMany' | 'oneToOne' | 'unknown' (required)
- sourceEntity: string (required, tableName reference)
- targetEntity: string (required, tableName reference)
- foreignKeyColumn: string (required)
- mappedBy: string | undefined (optional)
- sourceField: string | undefined (optional)
- targetField: string | undefined (optional)

## Out Of Scope Fields
The following fields are explicitly excluded from canonical DDL model:
- catalog persistence identifiers (for example concept.id)
- relation catalog identifiers (for example concept_relation.id)
- sourceConceptId and targetConceptId
- repository-only object mapping keys when not required by DDL execution
- ORM/runtime behavior flags unrelated to physical schema

## Invariants
1. tableName must be unique within the same tableSchema scope.
2. columnName must be unique within an entity.
3. each relation must reference existing sourceEntity and targetEntity.
4. foreignKeyColumn must be expressed as physical column name.
5. constraint columns must reference existing columns in the same entity.
6. column and constraint matching is case-insensitive in compare phase.
7. unknown relationType is non-fatal and must not emit DDL until normalized.

## DDL Responsibilities Expected From Canonical Model
- create missing tables
- create missing columns
- apply table constraints idempotently
- apply relation foreign keys according to normalized relation semantics
- expose stable input for compare and synchronization planning

## Adapter Contract (Step 1 Baseline)
Adapter implementations are not defined in this step, but their contract is fixed:
- decorator adapter must output canonical entities without leaking decorator internals
- configuration adapter must output canonical entities without leaking catalog ids
- both adapters must normalize naming into physical table and column names

## Open Decisions Deferred To Step 2
- reuse existing EngineEntityDefinition as canonical model, or introduce dedicated type
- keep relation shape flat or grouped after canonical normalization
- define where runtime-only fields are projected for repository usage

## Step 2 Proposal

### Decision
Introduce a dedicated canonical DDL model and keep EngineEntityDefinition as runtime model.

Suggested naming:
- CanonicalSchemaDefinition (entity)
- CanonicalSchemaColumnDefinition
- CanonicalSchemaConstraintDefinition
- CanonicalSchemaRelationDefinition

### Why this option
1. EngineEntityDefinition currently mixes DDL-relevant data with repository-oriented data.
2. propertyKey and grouped relations are useful for CRUD mapping, but they are not the ideal primary shape for DDL planning.
3. A dedicated canonical DDL model avoids coupling DDL evolution to repository runtime concerns.
4. Compare/diff planning and destructive-operation policies become easier to implement on a flat, source-agnostic model.

### Trade-off vs reusing EngineEntityDefinition
Benefits:
- clearer boundary between schema engine and repository runtime
- fewer semantic leaks from object model into physical schema planning
- lower long-term risk of dual-canon ambiguity

Costs:
- one additional adapter layer (canonical <-> runtime, where needed)
- short-term refactor effort in schema-management service

### Transitional compatibility policy
During migration, support both inputs at service boundary:
- canonical model (preferred)
- EngineEntityDefinition (legacy-compatible via explicit adapter)

Current status after Step 6:
- service boundary is canonical-only (`syncFromDefinitions(definitions: CanonicalSchemaDefinition[])`)
- legacy EngineEntityDefinition conversion is externalized to adapter boundaries

Deprecation target:
- once consumers are migrated, keep EngineEntityDefinition for repository runtime only
- remove internal DDL dependence on SchemaConceptDefinition and EngineEntityDefinition

### Minimal type-level contract for implementation
Canonical entity must expose:
- logicalName
- tableName
- tableSchema
- columns[]
- tableConstraints[]
- relations[] (flat)

Runtime model keeps repository-specific fields:
- propertyKey
- relation bucket grouping for runtime navigation

### Acceptance criteria for Step 2 completion
1. Decision recorded and approved in docs.
2. Dedicated canonical type names finalized.
3. Mapping ownership defined:
	- decorator -> canonical
	- configuration rows -> canonical
	- optional canonical -> runtime projection
4. SchemaManagementService target signature agreed for next step:
	- syncFromConfiguration() -> canonical pipeline
	- syncFromDefinitions(...) accepts canonical input only