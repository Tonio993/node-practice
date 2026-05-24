import { GenericEntityRepository } from './generic-entity.repository'
import { BaseEntity } from './generic-entity.type'

class RepositoryRegistry {
  private readonly repos = new Map<string, GenericEntityRepository<BaseEntity>>()

  register<T extends BaseEntity>(
    tableName: string,
    repo: GenericEntityRepository<T>
  ): void {
    this.repos.set(tableName, repo as GenericEntityRepository<BaseEntity>)
  }

  get<T extends BaseEntity>(tableName: string): GenericEntityRepository<T> | undefined {
    return this.repos.get(tableName) as GenericEntityRepository<T> | undefined
  }

  has(tableName: string): boolean {
    return this.repos.has(tableName)
  }
}

export const repositoryRegistry = new RepositoryRegistry()