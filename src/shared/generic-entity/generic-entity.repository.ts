import { Knex } from 'knex'
import { getRelations, RelationMetadata } from './generic-entity.decorator'
import { repositoryRegistry } from './generic-entity.registry'
import { BaseEntity } from './generic-entity.type'

export class GenericEntityRepository<T extends BaseEntity> {
    protected relations: RelationMetadata[]

    constructor(
        protected readonly knex: Knex,
        protected readonly tableName: string,
        protected readonly tableSchema: string,
        private readonly entityClass?: Function
    ) {
        this.relations = entityClass ? getRelations(entityClass) : []
        repositoryRegistry.register(tableName, this)
    }

    async findAll(): Promise<T[]> {
        const result = await this.knex(this.tableName)
            .withSchema(this.tableSchema)

        return Promise.all(result.map(i => this.selectChildren(i)))
    }

    async findById(id: number): Promise<T | undefined> {
        const result = await this.knex(this.tableName)
            .withSchema(this.tableSchema)
            .where({ id })
            .first()

        return result ? this.selectChildren(result) : undefined
    }

    async findByExample(filters: Partial<T>): Promise<T[]> {
        const result = await this.knex(this.tableName)
            .withSchema(this.tableSchema)
            .where(filters as object)

        return Promise.all(result.map(i => this.selectChildren(i)))
    }

    async insert(entity: Omit<T, 'id'>): Promise<T> {
        const [{ id }]: { id: number }[] = await this.knex(this.tableName)
            .withSchema(this.tableSchema)
            .insert(this.omit(entity, this.relations.map(r => r.propertyKey)))
            .returning('id')

        await this.insertChildren(entity, id)
        return await this.findById(id) as T

    }

    update(id: number, concept: Partial<Omit<T, 'id'>>): Promise<T> {
        return this.knex(this.tableName)
            .withSchema(this.tableSchema)
            .update({ ...concept, id, updated_at: new Date() })
            .where({ id })
            .returning('*')
            .then((res: T[]) => res[0])
    }

    async delete(id: number): Promise<boolean> {
        await this.deleteChildren(id)

        const result: { affectedRows: number } = await this.knex(this.tableName)
            .withSchema(this.tableSchema)
            .where({ id })
            .delete();

        return result.affectedRows > 0
    }


    private async selectChildren(item: T): Promise<T> {
        if (this.relations.length === 0) return item

        const result: any = { ...item }

        for (const rel of this.relations) {
            const childRepo = repositoryRegistry.get(rel.targetTable)!

            result[rel.propertyKey] = await childRepo.findByExample(
                { [rel.foreignKey]: item.id } as any
            )
        }
        return result as T
    }

    private async insertChildren(item: Omit<T, 'id'>, id: number): Promise<void> {
        if (this.relations.length === 0) return

        for (const rel of this.relations) {
            const childRepo = repositoryRegistry.get(rel.targetTable)!

            if (!item[rel.propertyKey]) continue
            for await (const child of item[rel.propertyKey] as Array<any>) {
                await childRepo.insert({...child, [rel.foreignKey]: id})
            }
        }
    }

    private async deleteChildren(id: number): Promise<void> {
        if (this.relations.length === 0) return

        for (const rel of this.relations) {
            const childRepo = repositoryRegistry.get(rel.targetTable)!

            const children = await childRepo.findByExample({ [rel.foreignKey]: id })

            for (const child of children) {
                await childRepo.delete(child.id!)
            }
        }
    }

    private omit<T extends object>(obj: T, keys: string[]): Partial<T> {
        const result = { ...obj };
        keys.forEach(key => delete (result as any)[key]);
        return result;
    }
}
