const EVENT_FOR_STATUS: Record<string, string> = {
  processing: 'order.processing',
  completed: 'order.completed',
  failed: 'order.failed',
  refunded: 'order.refunded',
}

export interface SetOrderStatusOpts {
  paymentStatus?: string
  extra?: Record<string, any>   // extra columns merged into the SAME atomic update (e.g. { download_batch_id })
}

// Atomically updates one order (status + optional payment_status + extra columns) and,
// on a real status change, enqueues webhook deliveries for the owner's active subscribed keys.
// Throws on a DB error so callers surface a 500 (matches prior route behavior).
export async function setOrderStatus(
  orderId: string, newStatus: string, opts: SetOrderStatusOpts, supabase: any
): Promise<void> {
  const { data: order, error: fetchErr } = await supabase.from('orders')
    .select('id, user_id, reference_code, status, payment_status').eq('id', orderId).single()
  if (fetchErr) throw fetchErr
  if (!order) return

  const statusChanged = order.status !== newStatus
  const paymentChanged = !!opts.paymentStatus && opts.paymentStatus !== order.payment_status
  const hasExtra = !!opts.extra && Object.keys(opts.extra).length > 0
  if (!statusChanged && !paymentChanged && !hasExtra) return // nothing to write

  const patch: any = { status: newStatus, updated_at: new Date().toISOString(), ...(opts.extra || {}) }
  if (opts.paymentStatus) patch.payment_status = opts.paymentStatus
  const { error: updErr } = await supabase.from('orders').update(patch).eq('id', orderId)
  if (updErr) throw updErr

  if (!statusChanged) return // payment/extra-only update: no status-change webhook
  const event = EVENT_FOR_STATUS[newStatus]
  if (!event) return
  const { data: keys } = await supabase.from('api_keys')
    .select('id, webhook_url, webhook_events').eq('user_id', order.user_id).eq('status', 'active')
  for (const k of keys || []) {
    if (!k.webhook_url || !(k.webhook_events || []).includes(event)) continue
    await supabase.from('api_webhook_deliveries').insert({
      api_key_id: k.id, event, order_id: orderId,
      payload: {
        event,
        reference: order.reference_code,
        status: newStatus,
        payment_status: opts.paymentStatus ?? order.payment_status,
        timestamp: new Date().toISOString(),
      },
    })
  }
}
