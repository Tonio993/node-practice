import { initDb } from './db/knex'
import { FatturaRepository } from './repositories/fattura.repository'
 
async function main() {
  // Inizializza DB e crea tabelle se non esistono
  await initDb()
 
  const repo = new FatturaRepository()
 
  // INSERT
  const id = await repo.insert({
    numero: '001',
    data_ora: new Date().toISOString(),
    nave: 'Diciannove',
    stato: 'APERTA'
  })
  console.log(`Fattura inserita con id: ${id}`)
 
  // SELECT per stato
  const aperte = await repo.findByStato('APERTA')
  console.log('Fatture aperte:', aperte)
 
  // UPDATE
  await repo.updateStato(id, 'PAGATA')
  console.log(`Fattura ${id} aggiornata a PAGATA`)
 
  // Verifica
  const fattura = await repo.findById(id)
  console.log('Fattura aggiornata:', fattura)
}
 
main().catch(console.error)