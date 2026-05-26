import { Knex } from 'knex'
import { omit, renameKeys } from '../utils/object.utils'
import { toCamelCase, toSnakeCase } from '../utils/case.util'
import { getEntityMetadata, getRelations, RelationMetadata } from './generic-entity.decorator'
import { repositoryRegistry } from './generic-entity.registry'
import { BaseEntity } from './generic-entity.type'

export class GenericEntityRepository<T extends BaseEntity> {
    protected relations: RelationMetadata[]

    protected _tableName: string

    get tableName() {
        return this._tableName
    }

    protected _tableSchema: string | undefined

    get tableSchema(): string | undefined {
        return this._tableSchema
    }

    constructor(
        protected readonly knex: Knex,
        entityClass: Function
    ) {
        const entityMetadata = getEntityMetadata(entityClass)

        if (!entityMetadata) {
            throw new Error(`Entity class ${entityClass.name} is missing @Entity decorator`)
        }

        this.relations = getRelations(entityClass)
        this._tableName = entityMetadata.tableName || entityClass.name.toLowerCase()
        this._tableSchema = entityMetadata.tableSchema
        repositoryRegistry.register(this.tableName, this)
    }


    // SELECT

    async findAll(trx?: Knex.Transaction): Promise<T[]> {
        const result = await this._findAll(trx)
        return result.map(i => this.mapDbEntity(i))
    }

    async findById(id: number, trx?: Knex.Transaction): Promise<T | undefined> {
        const result = await this._findById(id, trx)
        return result ? this.mapDbEntity(result) : undefined
    }

    async findByExample(filters: Partial<T>, trx?: Knex.Transaction): Promise<T[]> {
        const dbFilters = this.mapToDbEntity(filters as Record<string, unknown>)
        const result = await this._findByExample(dbFilters, trx)
        return result.map(i => this.mapDbEntity(i))
    }

    private async _findAll(trx?: Knex.Transaction): Promise<any[]> {
        const result = await this.baseQuery(trx)
        return Promise.all(result.map(i => this.selectChildren(i, trx)))
    }

    private async _findById(id: number, trx?: Knex.Transaction): Promise<any | undefined> {
        let result = undefined

        await this.getTransaction(trx, async (transaction) => {
            result = await this.baseQuery(transaction)
                .where({ id })
                .first()
        })

        return result ? await this.selectChildren(result, trx) : undefined
    }

    private async _findByExample(filters: Record<string, unknown>, trx?: Knex.Transaction): Promise<any[]> {
        let result: any[] = []

        await this.getTransaction(trx, async (transaction) => {
            result = await this.baseQuery(transaction)
                .where(filters as object || {})
        })

        return Promise.all(result.map(i => this.selectChildren(i, trx)))
    }

    private async selectChildren(item: any, trx?: Knex.Transaction): Promise<any> {
        if (this.relations.length === 0) return item
        
        let result: any = { ...item }

        await this.getTransaction(trx, async (transaction) => {
            for (const rel of this.relations) {
                const childRepo = this.getChildRepo(rel)

                result[rel.propertyKey] = await childRepo.findByExample(
                    { [rel.foreignKey]: item.id } as any,
                    transaction
                )
            }
        })

        return result
    }


    // INSERT

    async insert(entity: Omit<T, 'id'>, trx?: Knex.Transaction): Promise<T> {
        const dbEntity = this.mapToDbEntity(omit(entity as object, this.relations.map(r => r.propertyKey)) as Record<string, unknown>)
        const result = await this._insert(dbEntity, entity, trx)
        return this.mapDbEntity(result)
    }

    private async _insert(entity: Record<string, unknown>, original: Omit<T, 'id'>, trx?: Knex.Transaction): Promise<any> {
        let result: any

        await this.getTransaction(trx, async (transaction) => {
            const [{ id }]: { id: number }[] = await this.baseQuery(transaction)
                .insert(entity)
                .returning('id')
    
            await this.insertChildren(original, id, transaction)
            
            result = await this._findById(id, transaction)
        })

        return result!
    }

    private async insertChildren(item: Omit<T, 'id'>, id: number, trx?: Knex.Transaction): Promise<void> {
        if (this.relations.length === 0) return

        await this.getTransaction(trx, async (transaction) => {
            for (const rel of this.relations) {
                const childRepo = this.getChildRepo(rel)

                if (!item[rel.propertyKey]) continue
                for await (const child of item[rel.propertyKey] as Array<any>) {
                    await childRepo.insert({ ...child, [rel.foreignKey]: id }, transaction)
                }
            }
        })

    }


    // UPDATE

    async update(id: number, entity: Partial<Omit<T, 'id'>>, trx?: Knex.Transaction): Promise<T> {
        const dbEntity = this.mapToDbEntity(omit(entity as object, this.relations.map(r => r.propertyKey)) as Record<string, unknown>)
        const result = await this._update(id, dbEntity, entity, trx)
        return this.mapDbEntity(result)
    }

    private async _update(id: number, entity: Record<string, unknown>, item: Partial<Omit<T, 'id'>>, trx?: Knex.Transaction): Promise<any> {
        let result: any

        await this.getTransaction(trx, async (transaction) => {
            await this.baseQuery(transaction)
                .update({ ...entity, id, updated_at: new Date() })
                .where({ id })
            
            await this.updateChildren(id, item, transaction)

            result = await this._findById(id, transaction)
        })

        return result!
    }

    private async updateChildren(id: number, item: Partial<Omit<T, 'id'>>, trx?: Knex.Transaction): Promise<void> {
        if (this.relations.length === 0) return

        await this.getTransaction(trx, async (transaction) => {
            const existing = await this._findById(id, transaction)
            
            for (const rel of this.relations) {
                const childRepo = this.getChildRepo(rel)

                if (item[rel.propertyKey] === undefined) continue
                
                const existingChildren = new Set(existing![rel.propertyKey].map((c: T) => c.id))
                const updatingChildren = new Set(item[rel.propertyKey]!.map((c: T) => c.id).filter((id: number) => id !== undefined))

                const toDelete = existing![rel.propertyKey].filter((c: T) => !updatingChildren.has(c.id))
                const toInsert = item[rel.propertyKey]!.filter((child: T) => child.id === undefined)
                
                const toUpdate = item[rel.propertyKey]!.filter((c: T) => c.id) || []
                const toUpdateMissing = toUpdate.filter((c : T) => !(existingChildren).has(c.id))
                if (toUpdateMissing.length > 0) {
                    throw new Error(`Trying to update entity ${this.tableName} with id ${id} but related entity ${rel.targetEntity().name} was not found for ids ${toUpdateMissing.join(', ')}`)
                }

                for (const child of toDelete) {
                    await childRepo.delete(child.id!, transaction)
                }
                for await (const child of toInsert) {
                    await childRepo.insert({ ...child, [rel.foreignKey]: id }, transaction)
                }
                for await (const child of toUpdate) {
                    await childRepo.update(child.id!, omit(child, ['id']), transaction)
                }

            }
        })
    }


    // DELETE

    async delete(id: number, trx?: Knex.Transaction): Promise<boolean> {
        return await this._delete(id, trx)
    }

    private async _delete(id: number, trx?: Knex.Transaction): Promise<boolean> {
        let affectedRows = 0

        await this.getTransaction(trx, async (transaction) => {
            await this.deleteChildren(id, transaction)
    
            const result: { affectedRows: number } = await this.baseQuery(transaction)
                .where({ id })
                .delete();
    
            affectedRows = result.affectedRows
            })

        return affectedRows > 0
    }

    private async deleteChildren(id: number, trx?: Knex.Transaction): Promise<void> {
        if (this.relations.length === 0) return

        await this.getTransaction(trx, async (transaction) => {
            for (const rel of this.relations) {
                const childRepo = this.getChildRepo(rel)

                const children = await childRepo.findByExample({ [rel.foreignKey]: id }, transaction)
    
                for (const child of children) {
                    await childRepo.delete(child.id!, transaction)
                }
            }
        })
    }


    // UTILITIES

    private mapDbEntity(item: Record<string, unknown>): T {
        return renameKeys(item, toCamelCase) as T
    }

    private mapToDbEntity(item: Record<string, unknown>): Record<string, unknown> {
        return renameKeys(item, toSnakeCase)
    }

    private baseQuery(trx?: Knex.Transaction) {
        let baseQuery = trx ? trx(this.tableName) : this.knex(this.tableName);
        if (this.tableSchema) {
            baseQuery = baseQuery.withSchema(this.tableSchema)
        }
        return baseQuery
    }

    private async getTransaction<R>(trx: Knex.Transaction | undefined, callback: (trx: Knex.Transaction) => Promise<R>): Promise<R> {
        if (trx) {
            return callback(trx)
        }
        return this.knex.transaction(callback)
    }

    private getChildRepo(rel: RelationMetadata): GenericEntityRepository<any> {
        const targetEntity = rel.targetEntity()
        const targetEntityMetadata = getEntityMetadata(targetEntity)
        if (!targetEntityMetadata) {
            throw new Error(`Target entity ${targetEntity.name} is missing @Entity decorator`)
        }
        const targetTable = targetEntityMetadata.tableName!
        return repositoryRegistry.get(targetTable)!
    }

}
