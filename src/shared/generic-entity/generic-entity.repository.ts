import { Knex } from 'knex'
import { BaseEntity } from './generic-entity.type'
import { getRelations, RelationMetadata } from './generic-entity.decorator'
import { repositoryRegistry } from './generic-entity.registry'

export class GenericEntityRepository<T extends BaseEntity> {
    protected relations: RelationMetadata[]

    constructor(
        protected readonly knex: Knex,
        protected readonly tableName: string,
        protected readonly tableSchema: string,
        private readonly entityClass?: Function
    ) {
        this.relations = entityClass ? getRelations(entityClass) : []
        console.log(this.relations)
    }

    async findAll(): Promise<T[]> {
        const result = await this.knex(this.tableName)
            .withSchema(this.tableSchema)

        return Promise.all(result.map(i => this.loadChildren(i)))
    }
    
    async findById(id: number): Promise<T> {
        const result = await this.knex(this.tableName)
            .withSchema(this.tableSchema)
            .where({ id })
            .first()
        
        return this.loadChildren(result)
    }

    async findByExample(filters: Partial<T>): Promise<T[]> {
        const result = await this.knex(this.tableName)
            .withSchema(this.tableSchema)
            .where(filters as object)
        
        return Promise.all(result.map(i => this.loadChildren(i)))
    }

    insert(entity: Omit<T, 'id'>): Promise<T> {
        return this.knex(this.tableName)
            .withSchema(this.tableSchema)
            .insert(entity)
            .returning('*')
            .then((res: T[]) => res[0])

    }

    update(id: number, concept: Partial<Omit<T, 'id'>>): Promise<T> {
        return this.knex(this.tableName)
            .withSchema(this.tableSchema)
            .update({ ...concept, id, updated_at: new Date() })
            .where({ id })
            .returning('*')
            .then((res: T[]) => res[0])
    }

    delete(id: number): Promise<T> {
        return this.knex(this.tableName)
            .withSchema(this.tableSchema)
            .where({ id })
            .delete('*')
            .then((res: T[]) => res[0])
    }


    private async loadChildren(item: T): Promise<T> {
        if (this.relations.length === 0) return item

        const result = { ...item } as Record<string, unknown>

        for (const rel of this.relations) {
            const childRepo = repositoryRegistry.get(rel.targetTable)!

            result[rel.propertyKey] = await childRepo.findByExample(
                { [rel.foreignKey]: item.id } as any
            )
        }
        return result as T
    }

    private async persistChildren(item: T): Promise<void> {
        if (this.relations.length === 0) return

        for (const rel of this.relations) {
            const childRepo = repositoryRegistry.get(rel.targetTable)!

            const children = await childRepo.findByExample(
                { [rel.foreignKey]: item.id } as any
            )
            

        }
    }
}
