import { GenericEntityRepository } from './generic-entity.repository'
import type { BaseEntity } from './generic-entity.type'

export class GenericEntityService<T extends BaseEntity> {
  constructor(protected readonly repo: GenericEntityRepository<T>) {}

  async getAll(): Promise<T[]> {
    return await this.repo.findAll()
  }

  async getById(id: number): Promise<T | undefined> {
    return await this.repo.findById(id)
  }

  async getByExample(example: Partial<T>): Promise<T[]> {
    return await this.repo.findByExample(example)
  }

  async insert(entity: Omit<T, 'id'>): Promise<T> {
    return await this.repo.insert(entity)
  }

  async update(id: number, entity: Partial<Omit<T, 'id'>>): Promise<T> {
    return await this.repo.update(id, entity)
  }

  async delete(id: number): Promise<boolean> {
    return await this.repo.delete(id)
  }
}