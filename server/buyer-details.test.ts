import { describe, expect, test } from 'bun:test'
import { emptyBuyer, loadBuyer, saveBuyer } from '../src/buyer-details'

const memoryStore = (initial?: string) => {
  const values = new Map<string, string>(initial === undefined ? [] : [['palianytsia-checkout', initial]])
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

const buyer = { email: 'olena@example.com', phone: '(424) 408-0552', name: 'Olena K', street: '1 Main St', city: 'Costa Mesa', state: 'CA', zip: '92626' }

describe('remembered buyer details', () => {
  test('are restored exactly as they were saved', () => {
    const store = memoryStore()
    saveBuyer(buyer, store)
    expect(loadBuyer(store)).toEqual(buyer)
  })

  test('start empty when nothing was saved or there is no storage', () => {
    expect(loadBuyer(memoryStore())).toEqual(emptyBuyer())
    expect(loadBuyer(null)).toEqual(emptyBuyer())
  })

  test('ignore unreadable or unexpected saved data', () => {
    for (const saved of ['{not json', 'null', '[]', '"text"', '42', '{"email": 5, "phone": null, "name": {}, "zip": ["92626"]}']) {
      expect(loadBuyer(memoryStore(saved))).toEqual(emptyBuyer())
    }
  })

  test('keep the valid fields when others are damaged', () => {
    const result = loadBuyer(memoryStore(JSON.stringify({ ...buyer, phone: 12345, city: ['x'] })))
    expect(result).toEqual({ ...buyer, phone: '', city: '' })
  })

  test('drop a saved state that is not one we ship to', () => {
    for (const state of ['AK', 'HI', 'California', 'ca', 'DC', '']) {
      expect(loadBuyer(memoryStore(JSON.stringify({ ...buyer, state }))).state).toBe('')
    }
    expect(loadBuyer(memoryStore(JSON.stringify({ ...buyer, state: 'WY' }))).state).toBe('WY')
  })

  test('cut over-long saved values down to what the form allows', () => {
    const result = loadBuyer(memoryStore(JSON.stringify({ ...buyer, name: 'x'.repeat(5000), zip: '9'.repeat(99) })))
    expect(result.name).toHaveLength(100)
    expect(result.zip).toHaveLength(10)
  })

  test('never throw when storage refuses to read or write', () => {
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('full') } }
    expect(loadBuyer(broken)).toEqual(emptyBuyer())
    expect(() => saveBuyer(buyer, broken)).not.toThrow()
  })

  test('save only the buyer fields, nothing about the cart', () => {
    const store = memoryStore()
    saveBuyer(buyer, store)
    expect(Object.keys(JSON.parse(store.values.get('palianytsia-checkout')!)).sort())
      .toEqual(['city', 'email', 'name', 'phone', 'state', 'street', 'zip'])
  })
})
