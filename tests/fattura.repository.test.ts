import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import knex, { Knex } from 'knex'
import { FatturaRepository } from '../src/repositories/fattura.repository'

let db: Knex

beforeAll(async () => {
  // DB in memoria isolato — non tocca il file reale
  db = knex({
    client: 'better-sqlite3',
    connection: ':memory:',
    useNullAsDefault: true
  })

  await db.schema.createTable('fatture', (t) => {
    t.increments('id')
    t.string('numero').notNullable()
    t.datetime('data_ora').notNullable()
    t.text('nave').notNullable()
    t.text('stato').notNullable()
    t.timestamps(true, true)
  })
})

afterAll(async () => {
  await db.destroy()
})

beforeEach(async () => {
  await db('fatture').truncate()
})

describe('FatturaRepository', () => {
  it('inserisce una fattura e la recupera per id', async () => {
    const repo = new FatturaRepository(db)

    const id = await repo.insert({
      numero: '001',
      data_ora: new Date().toISOString(),
      nave: 'MSC Roma',
      stato: 'APERTA'
    })

    const fattura = await repo.findById(id)
    expect(fattura).toBeDefined()
    expect(fattura?.numero).toBe('001')
    expect(fattura?.nave).toBe('MSC Roma')
  })

  it('recupera tutte le fatture aperte', async () => {
    const repo = new FatturaRepository(db)

    await repo.insert({ numero: '001', data_ora: new Date().toISOString(), nave: 'MSC Roma', stato: 'APERTA' })
    await repo.insert({ numero: '002', data_ora: new Date().toISOString(), nave: 'Costa Firenze', stato: 'PAGATA' })
    await repo.insert({ numero: '003', data_ora: new Date().toISOString(), nave: 'Grimaldi', stato: 'APERTA' })

    const aperte = await repo.findByStato('APERTA')
    expect(aperte).toHaveLength(2)
    expect(aperte.every(f => f.stato === 'APERTA')).toBe(true)
  })

  it('aggiorna lo stato di una fattura', async () => {
    const repo = new FatturaRepository(db)

    const id = await repo.insert({
      numero: '001',
      data_ora: new Date().toISOString(),
      nave: 'MSC Roma',
      stato: 'APERTA'
    })

    await repo.updateStato(id, 'PAGATA')

    const fattura = await repo.findById(id)
    expect(fattura?.stato).toBe('PAGATA')
  })

  it('elimina una fattura', async () => {
    const repo = new FatturaRepository(db)

    const id = await repo.insert({
      numero: '001',
      data_ora: new Date().toISOString(),
      nave: 'MSC Roma',
      stato: 'APERTA'
    })

    await repo.delete(id)

    const fattura = await repo.findById(id)
    expect(fattura).toBeUndefined()
  })
})