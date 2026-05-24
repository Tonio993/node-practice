import { GenericEntityRepository } from './generic-entity.repository'
import type { BaseEntity } from './generic-entity.type'

export class GenericEntityService<T extends BaseEntity> {
  constructor(protected readonly repo: GenericEntityRepository<T>) {}

  getAll(): Promise<T[]> {
    return this.repo.findAll()
  }

  getById(id: number): Promise<T | undefined> {
    return this.repo.findById(id)
  }

  insert(entity: Omit<T, 'id'>): Promise<T> {
    return this.repo.insert(entity)
  }

  update(id: number, entity: Partial<Omit<T, 'id'>>): Promise<T> {
    return this.repo.update(id, entity)
  }

  delete(id: number): Promise<boolean> {
    return this.repo.delete(id)
  }
}