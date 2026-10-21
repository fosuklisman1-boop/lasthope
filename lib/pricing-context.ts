import { emptyPricingContext, type PricingContext } from '@/lib/pricing'

/**
 * Load the prices that apply to one customer: their role's price table and their own
 * per-package prices. Throws when the database cannot be read, so callers that charge
 * money fail closed instead of quietly charging the wrong price.
 *
 * Uses only `select().eq()` chains so it works with the simple fakes used in tests.
 */
export async function loadPricingContext(supabase: any, userId: string, knownRole?: string | null): Promise<PricingContext> {
  let role = knownRole ?? null
  if (role === null) {
    const { data, error } = await supabase.from('users').select('role').eq('id', userId).maybeSingle()
    if (error) throw new Error(`pricing: could not read the customer (${error.message})`)
    role = data?.role ?? null
  }

  const ctx = emptyPricingContext(role)

  if (role) {
    const { data: roleRow, error: roleError } = await supabase.from('roles').select('price_table_id').eq('slug', role).maybeSingle()
    if (roleError) throw new Error(`pricing: could not read the role (${roleError.message})`)
    ctx.tableId = roleRow?.price_table_id ?? null
  }

  if (ctx.tableId) {
    const { data, error } = await supabase.from('price_table_items').select('package_id, price').eq('price_table_id', ctx.tableId)
    if (error) throw new Error(`pricing: could not read the price table (${error.message})`)
    for (const row of data ?? []) ctx.tableItems.set(row.package_id, Number(row.price))
  }

  const { data: own, error: ownError } = await supabase.from('customer_prices').select('package_id, price').eq('user_id', userId)
  if (ownError) throw new Error(`pricing: could not read customer prices (${ownError.message})`)
  for (const row of own ?? []) ctx.overrides.set(row.package_id, Number(row.price))

  return ctx
}
