import type {
  SchemaDestructivePolicy,
  SchemaDiffActionKind,
  SchemaDiffPlannedAction,
  SchemaSyncOptions,
} from './schema-management.service'

export function resolveDestructivePolicy(options: SchemaSyncOptions): SchemaDestructivePolicy {
  if (options.failOnDestructive !== undefined) {
    return options.failOnDestructive ? 'block' : 'signal'
  }

  return options.destructivePolicy ?? 'signal'
}

export function getBlockedDestructiveActions(
  destructiveActions: SchemaDiffPlannedAction[],
  allowDestructiveActions: SchemaDiffActionKind[] | undefined
): SchemaDiffPlannedAction[] {
  if (!allowDestructiveActions?.length) {
    return destructiveActions
  }

  const allowedKinds = new Set(allowDestructiveActions)
  return destructiveActions.filter((action) => !allowedKinds.has(action.kind))
}

export function hasValidApprovalToken(options: SchemaSyncOptions, expectedToken = process.env.SCHEMA_SYNC_APPROVAL_TOKEN): boolean {
  const providedToken = options.approvalToken?.trim()
  if (!expectedToken || !providedToken) {
    return false
  }

  return providedToken === expectedToken
}
