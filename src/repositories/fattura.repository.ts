import { db } from '../db/knex'
import type { Knex } from 'knex'

export interface Fattura {
  id?: number
  numero: string
  data_ora: Date | string
  nave: string
  stato: string
  created_at?: string
  updated_at?: string
}

export class FatturaRepository {
  constructor(private readonly knex: Knex = db) {}

  async findAll(): Promise<Fattura[]> {
    return this.knex('fatture').withSchema('concept').select('*')
  }

  async findById(id: number): Promise<Fattura | undefined> {
    return this.knex('fatture').withSchema('concept').where({ id }).first()
  }

  async findByStato(stato: string): Promise<Fattura[]> {
    return this.knex('fatture').withSchema('concept').where({ stato })
  }

  async insert(fattura: Omit<Fattura, 'id' | 'created_at' | 'updated_at'>): Promise<number> {
    const [{ id }] = await this.knex('fatture').withSchema('concept').insert(fattura, 'id')
    console.log(id);
    return id;
  }

  async updateStato(id: number, stato: string): Promise<void> {
    await this.knex('fatture').withSchema('concept').where({ id }).update({ stato })
  }

  async delete(id: number): Promise<void> {
    await this.knex('fatture').withSchema('concept').where({ id }).delete()
  }
}