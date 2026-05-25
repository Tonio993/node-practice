import { toCamelCase } from '../utils/case.util'
import { renameKeys } from '../utils/object.utils'
import { GenericEntityRepository } from './generic-entity.repository'
import type { BaseEntity } from './generic-entity.type'

export class GenericEntityService<T extends BaseEntity> {
  constructor(protected readonly repo: GenericEntityRepository<T>) {}

  async getAll(): Promise<T[]> {
    const result = await this.repo.findAll()
    return result.map(i => renameKeys(i, toCamelCase)) as T[]
  }

  async getById(id: number): Promise<T | undefined> {
    const result = await this.repo.findById(id)
    return result ? renameKeys(result, toCamelCase) as T : undefined
  }

  async getByExample(example: Partial<T>): Promise<T[]> {
    const result = await this.repo.findByExample(example)
    return result.map(i => renameKeys(i, toCamelCase)) as T[]
  }

  async insert(entity: Omit<T, 'id'>): Promise<T> {
    const result = await this.repo.insert(entity)
    return renameKeys(result, toCamelCase) as T
  }

  async update(id: number, entity: Partial<Omit<T, 'id'>>): Promise<T> {
    const result = await this.repo.update(id, entity)
    return renameKeys(result, toCamelCase) as T
  }

  async delete(id: number): Promise<boolean> {
    return await this.repo.delete(id)
  }
}