/**
 * Stateful in-memory stand-in for the subset of the Supabase query builder
 * used by the payment completion code. Rows live in `tables`, updates really
 * mutate them (so conditional `.eq('status','pending')` updates are
 * idempotent like Postgres), and every rpc call is recorded.
 */
export type Row = Record<string, any>

export function fakeDb(
  tables: Record<string, Row[]>,
  rpcImpl?: (name: string, args: any) => any,
  // Return an error object to make an update on `table` fail (nothing is mutated).
  updateError?: (table: string, patch: Row) => any,
) {
  const rpcCalls: { name: string; args: any }[] = []
  const inserts: { table: string; row: Row }[] = []

  const sb: any = {
    from(table: string) {
      const rows = (tables[table] ??= [])
      const filters: [string, any][] = []
      let patch: Row | null = null
      const match = () => rows.filter(r => filters.every(([c, v]) => r[c] === v))
      const failed = () => (patch && updateError ? updateError(table, patch) ?? null : null)
      const one = () => {
        if (patch) {
          const hit = match()
          hit.forEach(r => Object.assign(r, patch))
          return hit[0] ?? null
        }
        return match()[0] ?? null
      }
      const api: any = {
        select: () => api,
        limit: () => api,
        eq: (c: string, v: any) => { filters.push([c, v]); return api },
        single: async () => {
          const err = failed(); if (err) return { data: null, error: err }
          const r = one(); return { data: r, error: r ? null : { code: 'PGRST116' } }
        },
        maybeSingle: async () => { const err = failed(); return err ? { data: null, error: err } : { data: one(), error: null } },
        then: (res: any, rej: any) => {
          const err = failed()
          return Promise.resolve(err ? { data: null, error: err } : { data: patch ? (one(), match()) : match(), error: null }).then(res, rej)
        },
        update: (p: Row) => { patch = p; return api },
        insert: (row: Row) => {
          inserts.push({ table, row })
          const stored = { id: `${table}-${rows.length + 1}`, ...row }
          rows.push(stored)
          const r: any = { select: () => r, single: async () => ({ data: stored, error: null }), then: (res: any, rej: any) => Promise.resolve({ error: null }).then(res, rej) }
          return r
        },
      }
      return api
    },
    rpc(name: string, args: any) {
      rpcCalls.push({ name, args })
      // rpcImpl may return a promise (to hold a call mid-flight) or null (rpc failure).
      const result = Promise.resolve(rpcImpl ? rpcImpl(name, args) : { balance: 0 })
        .then(data => (data == null ? { data: null, error: { code: 'XX000', message: 'rpc failed' } } : { data, error: null }))
      const r: any = { single: () => result, then: (res: any, rej: any) => result.then(res, rej) }
      return r
    },
  }
  return { sb, tables, rpcCalls, inserts }
}
