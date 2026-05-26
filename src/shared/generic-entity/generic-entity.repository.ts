import { Knex } from 'knex'
import { omit, renameKeys } from '../utils/object.utils'
import { toCamelCase, toSnakeCase } from '../utils/case.util'
import { getEntityMetadata, getRelations, RelationMetadata } from './generic-entity.decorator'
import { repositoryRegistry } from './generic-entity.registry'
import { BaseEntity } from './generic-entity.type'

type DbEntity = Record<string, unknown>

export class GenericEntityRepository<T extends BaseEntity> {
    protected readonly relations: RelationMetadata[] = []
    protected readonly _tableName: string
    protected readonly _tableSchema?: string

    get tableName() {
        return this._tableName
    }

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

    // PUBLIC API

    async findAll(trx?: Knex.Transaction): Promise<T[]> {
        const entities = await this._findAll(trx)
        return entities.map(this.mapDbEntity)
    }

    async findById(id: number, trx?: Knex.Transaction): Promise<T | undefined> {
        const entity = await this._findById(id, trx)
        return entity ? this.mapDbEntity(entity) : undefined
    }

    async findByExample(filters: Partial<T>, trx?: Knex.Transaction): Promise<T[]> {
        const dbFilters = this.mapToDbEntity(filters as DbEntity)
        const entities = await this._findByExample(dbFilters, trx)
        return entities.map(this.mapDbEntity)
    }

    async insert(entity: Omit<T, 'id'>, trx?: Knex.Transaction): Promise<T> {
        const dbEntity = this.preparePayload(entity)
        const created = await this._insert(dbEntity, entity, trx)
        return this.mapDbEntity(created)
    }

    async update(id: number, entity: Partial<Omit<T, 'id'>>, trx?: Knex.Transaction): Promise<T> {
        const dbEntity = this.preparePayload(entity)
        const updated = await this._update(id, dbEntity, entity, trx)
        return this.mapDbEntity(updated)
    }

    async delete(id: number, trx?: Knex.Transaction): Promise<boolean> {
        return this._delete(id, trx)
    }

    // INTERNAL CRUD PIPELINE

    private async _findAll(trx?: Knex.Transaction): Promise<DbEntity[]> {
        const items = await this.baseQuery(trx)
        return this.loadChildrenForMany(items, trx)
    }

    private async _findById(id: number, trx?: Knex.Transaction): Promise<DbEntity | undefined> {
        let entity: DbEntity | undefined

        await this.getTransaction(trx, async (transaction) => {
            entity = await this.baseQuery(transaction)
                .where({ id })
                .first()
        })

        return entity ? this.loadChildren(entity, trx) : undefined
    }

    private async _findByExample(filters: DbEntity, trx?: Knex.Transaction): Promise<DbEntity[]> {
        let items: DbEntity[] = []

        await this.getTransaction(trx, async (transaction) => {
            items = await this.baseQuery(transaction)
                .where(filters as object || {})
        })

        return this.loadChildrenForMany(items, trx)
    }

    private async _insert(entity: DbEntity, original: Omit<T, 'id'>, trx?: Knex.Transaction): Promise<DbEntity> {
        let created: DbEntity

        await this.getTransaction(trx, async (transaction) => {
            const [{ id }]: { id: number }[] = await this.baseQuery(transaction)
                .insert(entity)
                .returning('id')

            await this.insertChildren(original, id, transaction)

            created = await this._findById(id, transaction) as DbEntity
        })

        return created!
    }

    private async _update(id: number, entity: DbEntity, original: Partial<Omit<T, 'id'>>, trx?: Knex.Transaction): Promise<DbEntity> {
        let updated: DbEntity

        await this.getTransaction(trx, async (transaction) => {
            await this.baseQuery(transaction)
                .update({ ...entity, id, updated_at: new Date() })
                .where({ id })

            await this.updateChildren(id, original, transaction)

            updated = await this._findById(id, transaction) as DbEntity
        })

        return updated!
    }

    private async _delete(id: number, trx?: Knex.Transaction): Promise<boolean> {
        let affectedRows = 0

        await this.getTransaction(trx, async (transaction) => {
            await this.deleteChildren(id, transaction)

            const result: { affectedRows: number } = await this.baseQuery(transaction)
                .where({ id })
                .delete()

            affectedRows = result.affectedRows
        })

        return affectedRows > 0
    }

    // RELATION HANDLING

    private async loadChildren(item: DbEntity, trx?: Knex.Transaction): Promise<DbEntity> {
        const [result] = await this.loadChildrenForMany([item], trx)
        return result
    }

    private async loadChildrenForMany(items: DbEntity[], trx?: Knex.Transaction): Promise<DbEntity[]> {
        if (this.relations.length === 0 || items.length === 0) {
            return items
        }

        const parentIds = items
            .map(item => item.id)
            .filter((id): id is number => typeof id === 'number')

        if (parentIds.length === 0) {
            return items
        }

        const result = items.map(item => ({ ...item }))

        for (const rel of this.relations) {
            const childRepo = this.getChildRepo(rel)
            const childRows = await childRepo.baseQuery(trx)
                .whereIn(rel.foreignKey, parentIds)

            const childrenByParent = new Map<number, DbEntity[]>()

            for (const child of childRows) {
                const parentId = child[rel.foreignKey]
                if (typeof parentId !== 'number') continue

                const group = childrenByParent.get(parentId) ?? []
                group.push(omit(child, [rel.foreignKey]))
                childrenByParent.set(parentId, group)
            }

            for (const item of result) {
                const parentId = item.id as number
                item[rel.propertyKey] = childrenByParent.get(parentId) ?? []
            }
        }

        return result
    }

    private async insertChildren(item: Omit<T, 'id'>, id: number, trx?: Knex.Transaction): Promise<void> {
        if (this.relations.length === 0) return

        await this.getTransaction(trx, async (transaction) => {
            for (const rel of this.relations) {
                const childRepo = this.getChildRepo(rel)
                const children = this.getChildrenArray(item[rel.propertyKey])

                if (children.length === 0) continue

                const dbChildren = children.map(child => this.mapToDbEntity({
                    ...child,
                    [rel.foreignKey]: id,
                }))

                for await (const dbChild of dbChildren) {
                    await childRepo._insert(dbChild, dbChild as any, transaction)
                }
            }
        })
    }

    private async updateChildren(id: number, item: Partial<Omit<T, 'id'>>, trx?: Knex.Transaction): Promise<void> {
        if (this.relations.length === 0) return

        await this.getTransaction(trx, async (transaction) => {
            const existing = await this._findById(id, transaction)
            if (!existing) {
                throw new Error(`Entity ${this.tableName} with id ${id} was not found`) 
            }

            for (const rel of this.relations) {
                const childRepo = this.getChildRepo(rel)
                const children = this.getChildrenArray(item[rel.propertyKey])
                const existingChildren = this.getChildrenArray(existing[rel.propertyKey])

                const existingIds = new Set(existingChildren.map(child => child.id).filter((value): value is number => typeof value === 'number'))
                const updatingIds = new Set(children.map(child => child.id).filter((value): value is number => typeof value === 'number'))

                const toDelete = existingChildren.filter(child => child.id !== undefined && !updatingIds.has(child.id))
                const toInsert = children.filter(child => child.id === undefined)
                const toUpdate = children.filter(child => child.id !== undefined)
                const toUpdateMissing = toUpdate.filter(child => child.id !== undefined && !existingIds.has(child.id))

                if (toUpdateMissing.length > 0) {
                    throw new Error(`Trying to update entity ${this.tableName} with id ${id} but related entity ${rel.targetEntity().name} was not found for ids ${toUpdateMissing.map(child => child.id).join(', ')}`)
                }

                for (const child of toDelete) {
                    await childRepo._delete(child.id!, transaction)
                }

                for (const child of toInsert) {
                    const dbChild = this.mapToDbEntity({
                        ...child,
                        [rel.foreignKey]: id,
                    })
                    await childRepo._insert(dbChild, child, transaction)
                }

                for (const child of toUpdate) {
                    const dbChild = this.mapToDbEntity(omit(child, ['id']))
                    await childRepo._update(child.id!, dbChild, omit(child, ['id']), transaction)
                }
            }
        })
    }

    private async deleteChildren(id: number, trx?: Knex.Transaction): Promise<void> {
        if (this.relations.length === 0) return

        await this.getTransaction(trx, async (transaction) => {
            for (const rel of this.relations) {
                const childRepo = this.getChildRepo(rel)
                const childRows = await childRepo.baseQuery(transaction)
                    .where({ [rel.foreignKey]: id })

                for (const child of childRows) {
                    await childRepo._delete(child.id! as number, transaction)
                }
            }
        })
    }

    // HELPERS

    private preparePayload(entity: Partial<Omit<T, 'id'>>): DbEntity {
        return this.mapToDbEntity(omit(entity as object, this.relations.map(r => r.propertyKey)) as DbEntity)
    }

    private getChildrenArray(value: unknown): Array<any> {
        return Array.isArray(value) ? value : []
    }

    private mapDbEntity(item: DbEntity): T {
        return renameKeys(item, toCamelCase) as T
    }

    private mapToDbEntity(item: DbEntity): DbEntity {
        return renameKeys(item, toSnakeCase)
    }

    private baseQuery(trx?: Knex.Transaction) {
        let baseQuery = trx ? trx(this.tableName) : this.knex(this.tableName)
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
        const repo = repositoryRegistry.get(targetTable)
        if (!repo) {
            throw new Error(`Repository for target table ${targetTable} is not registered`)
        }

        return repo
    }
}
