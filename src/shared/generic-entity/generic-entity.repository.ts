import { Knex } from 'knex'
import { BaseEntity } from './generic-entity.type'

export class GenericEntityRepository<T extends BaseEntity> {
    constructor(
        protected readonly knex: Knex,
        protected readonly tableName: string,
        protected readonly tableSchema: string
    ) {}

    findById(id: number): Promise<T> {
        return this.knex(this.tableName)
        .withSchema(this.tableSchema)
        .where({id})
        .first()
    }

    findAll(): Promise<T[]> {
        return this.knex(this.tableName)
        .withSchema(this.tableSchema)
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
        .update({...concept, id, updated_at: new Date()})
        .where({id})
        .returning('*')
        .then((res: T[]) => res[0])
    }

    delete(id: number): Promise<T> {
        return this.knex(this.tableName)
        .withSchema(this.tableSchema)
        .where({id})
        .delete('*')
        .then((res: T[]) => res[0])
    }
}