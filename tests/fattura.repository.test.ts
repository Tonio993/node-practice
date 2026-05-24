import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import knex, { Knex } from 'knex'

let db: Knex

beforeAll(async () => {
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

describe('test', () => {
  it('test', async () => {

  })

})