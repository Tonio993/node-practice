import { Knex } from 'knex'
import { toCamelCase, toSnakeCase } from '../utils/case.util'
import { omit, renameKeys } from '../utils/object.utils'
import {
    getEntityMetadata,
    getManyToOneRelations,
    getOneToManyRelations,
    getOneToOneRelations,
    hasEntityMetadata,
    Relation
} from './generic-entity.decorator'
import { repositoryRegistry } from './generic-entity.registry'
import { BaseEntity } from './generic-entity.type'

type DbEntity = Record<string, unknown>

export class GenericEntityRepository<T extends BaseEntity> {
    protected readonly relations: Relation[] = []
    protected readonly oneToManyRelations: Relation[] = []
    protected readonly manyToOneRelations: Relation[] = []
    protected readonly oneToOneRelations: Relation[] = []
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

        if (!hasEntityMetadata(entityClass)) {
            throw new Error(`Entity class ${entityClass.name} is missing @Entity decorator`)
        }

        this.oneToManyRelations = getOneToManyRelations(entityClass)
        this.manyToOneRelations = getManyToOneRelations(entityClass)
        this.oneToOneRelations = getOneToOneRelations(entityClass)
        this.relations = [
            ...this.oneToManyRelations,
            ...this.manyToOneRelations,
            ...this.oneToOneRelations,
        ]
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
        if (items.length === 0) {
            return items
        }

        let result = items.map(item => ({ ...item }))

        result = await this.loadOneToManyRelations(result, trx)
        result = await this.loadManyToOneRelations(result, trx)
        result = await this.loadOneToOneRelations(result, trx)

        return result
    }

    private async loadOneToManyRelations(items: DbEntity[], trx?: Knex.Transaction): Promise<DbEntity[]> {
        if (this.oneToManyRelations.length === 0 || items.length === 0) {
            return items
        }

        const parentIds = items
            .map(item => item.id)
            .filter((id): id is number => typeof id === 'number')

        if (parentIds.length === 0) {
            return items
        }

        const result = items.map(item => ({ ...item }))

        for (const rel of this.oneToManyRelations) {
            const childRepo = this.getRelationRepository(rel)
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

    private async loadManyToOneRelations(items: DbEntity[], trx?: Knex.Transaction): Promise<DbEntity[]> {
        if (this.manyToOneRelations.length === 0 || items.length === 0) {
            return items
        }

        // Many-to-one relations are loaded by querying the parent table
        // using the local foreign key stored on each child entity.
        const result = items.map(item => ({ ...item }))

        for (const rel of this.manyToOneRelations) {
            const parentIds = result
                .map(item => item[rel.foreignKey])
                .filter((id): id is number => typeof id === 'number')

            if (parentIds.length === 0) {
                continue
            }

            const parentRepo = this.getRelationRepository(rel)
            const parentRows = await parentRepo.baseQuery(trx)
                .whereIn('id', parentIds)

            const parentById = new Map<number, DbEntity>()
            for (const parent of parentRows) {
                const parentId = parent.id
                if (typeof parentId !== 'number') continue
                parentById.set(parentId, renameKeys(parent, toCamelCase))
            }

            for (const item of result) {
                const parentId = item[rel.foreignKey]
                item[rel.propertyKey] = parentId !== undefined ? parentById.get(parentId as number) : undefined
            }
        }

        return result
    }

    private async loadOneToOneRelations(items: DbEntity[], trx?: Knex.Transaction): Promise<DbEntity[]> {
        if (this.oneToOneRelations.length === 0 || items.length === 0) {
            return items
        }

        // One-to-one relations are treated as a single parent object referenced by a local foreign key.
        // The decorated property is assumed to be the owning side of the relation.
        const result = items.map(item => ({ ...item }))

        for (const rel of this.oneToOneRelations) {
            const parentIds = result
                .map(item => item[rel.foreignKey])
                .filter((id): id is number => typeof id === 'number')

            if (parentIds.length === 0) {
                continue
            }

            const parentRepo = this.getRelationRepository(rel)
            const parentRows = await parentRepo.baseQuery(trx)
                .whereIn('id', parentIds)

            const parentById = new Map<number, DbEntity>()
            for (const parent of parentRows) {
                const parentId = parent.id
                if (typeof parentId !== 'number') continue
                parentById.set(parentId, renameKeys(parent, toCamelCase))
            }

            for (const item of result) {
                const parentId = item[rel.foreignKey]
                item[rel.propertyKey] = parentId !== undefined ? parentById.get(parentId as number) : undefined
            }
        }

        return result
    }

    private async insertChildren(item: Omit<T, 'id'>, id: number, trx?: Knex.Transaction): Promise<void> {
        await this.getTransaction(trx, async (transaction) => {
            await this.insertOneToManyChildren(item, id, transaction)
            await this.insertManyToOneRelations(item, id, transaction)
            await this.insertOneToOneRelations(item, id, transaction)
        })
    }

    private async insertOneToManyChildren(item: Omit<T, 'id'>, id: number, trx?: Knex.Transaction): Promise<void> {
        if (this.oneToManyRelations.length === 0) return

        for (const rel of this.oneToManyRelations) {
            const childRepo = this.getRelationRepository(rel)
            const children = this.getChildrenArray(item[rel.propertyKey])

            if (children.length === 0) continue

            const dbChildren = children.map(child => this.mapToDbEntity({
                ...child,
                [rel.foreignKey]: id,
            }))

            for (const dbChild of dbChildren) {
                await childRepo._insert(dbChild, dbChild as any, trx)
            }
        }
    }

    private async insertManyToOneRelations(item: Omit<T, 'id'>, id: number, trx?: Knex.Transaction): Promise<void> {
        // For many-to-one, the foreign key is stored on this entity rather than on a child entity.
        // The preparation of the payload already maps any provided parent id to the local foreign key.
        // Therefore there is no separate child insertion step for this relation type.
        return
    }

    private async insertOneToOneRelations(item: Omit<T, 'id'>, id: number, trx?: Knex.Transaction): Promise<void> {
        // One-to-one properties use a local foreign key when this side is the owning side.
        // The foreign key is already written by preparePayload, so no separate insert action is required.
        return
    }

    private async updateChildren(id: number, item: Partial<Omit<T, 'id'>>, trx?: Knex.Transaction): Promise<void> {
        await this.getTransaction(trx, async (transaction) => {
            const existing = await this._findById(id, transaction)
            if (!existing) {
                throw new Error(`Entity ${this.tableName} with id ${id} was not found`)
            }

            await this.updateOneToManyChildren(id, item, existing, transaction)
            await this.updateManyToOneRelations(id, item, existing, transaction)
            await this.updateOneToOneRelations(id, item, existing, transaction)
        })
    }

    private async updateOneToManyChildren(id: number, item: Partial<Omit<T, 'id'>>, existing: DbEntity, trx: Knex.Transaction): Promise<void> {
        if (this.oneToManyRelations.length === 0) return

        for (const rel of this.oneToManyRelations) {
            const childRepo = this.getRelationRepository(rel)
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
                await childRepo._delete(child.id!, trx)
            }

            for (const child of toInsert) {
                const dbChild = this.mapToDbEntity({
                    ...child,
                    [rel.foreignKey]: id,
                })
                await childRepo._insert(dbChild, child, trx)
            }

            for (const child of toUpdate) {
                const dbChild = this.mapToDbEntity(omit(child, ['id']))
                await childRepo._update(child.id!, dbChild, omit(child, ['id']), trx)
            }
        }
    }

    private async updateManyToOneRelations(id: number, item: Partial<Omit<T, 'id'>>, existing: DbEntity, trx: Knex.Transaction): Promise<void> {
        // Many-to-one updates are represented by changes to the local foreign key on this entity.
        // Since preparePayload already captures parent ids from nested objects, no separate update step is required.
        return
    }

    private async updateOneToOneRelations(id: number, item: Partial<Omit<T, 'id'>>, existing: DbEntity, trx: Knex.Transaction): Promise<void> {
        // One-to-one updates are handled through the local foreign key on this entity.
        // Any change to the associated object id is already reflected by preparePayload.
        return
    }

    private async deleteChildren(id: number, trx?: Knex.Transaction): Promise<void> {
        await this.getTransaction(trx, async (transaction) => {
            await this.deleteOneToManyChildren(id, transaction)
            await this.deleteManyToOneRelations(id, transaction)
            await this.deleteOneToOneRelations(id, transaction)
        })
    }

    private async deleteOneToManyChildren(id: number, trx: Knex.Transaction): Promise<void> {
        if (this.oneToManyRelations.length === 0) return

        for (const rel of this.oneToManyRelations) {
            const childRepo = this.getRelationRepository(rel)
            const childRows = await childRepo.baseQuery(trx)
                .where({ [rel.foreignKey]: id })

            for (const child of childRows) {
                await childRepo._delete(child.id! as number, trx)
            }
        }
    }

    private async deleteManyToOneRelations(id: number, trx: Knex.Transaction): Promise<void> {
        // Many-to-one relations generally do not require deleting related entities.
        return
    }

    private async deleteOneToOneRelations(id: number, trx: Knex.Transaction): Promise<void> {
        // If this entity owns the one-to-one foreign key, deleting it does not automatically delete the related record.
        // Parent cleanup should be handled explicitly if required by the domain.
        return
    }

    // HELPERS

    private preparePayload(entity: Partial<Omit<T, 'id'>>): DbEntity {
        const relationPropertyKeys = this.relations.map(r => r.propertyKey)
        const payload = omit(entity as object, relationPropertyKeys) as DbEntity

        const relationTypesWithLocalForeignKey = [
            ...this.manyToOneRelations,
            ...this.oneToOneRelations,
        ]

        for (const rel of relationTypesWithLocalForeignKey) {
            const relationValue = entity[rel.propertyKey]
            if (relationValue && typeof relationValue === 'object' && !Array.isArray(relationValue)) {
                const relationObject = relationValue as Record<string, unknown>
                const relationId = relationObject.id

                if (typeof relationId === 'number') {
                    // Convert the nested parent object into its foreign key value.
                    // This allows a client to pass { related: { id: 5 } } and persist id_related = 5.
                    payload[rel.foreignKey] = relationId
                } else if (Object.keys(relationObject).length > 0) {
                    // We cannot automatically persist a related entity when only partial data is provided.
                    // This keeps the relation handling simple and avoids unexpected cascade persistence.
                    throw new Error(
                        `Cannot persist relation '${rel.propertyKey}' for ${this.tableName} without an id on ${rel.targetEntity().name}`
                    )
                }
            }
        }

        return this.mapToDbEntity(payload)
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

    private getRelationRepository(rel: Relation): GenericEntityRepository<any> {
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
