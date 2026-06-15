const EVENT_FOR_STATUS: Record<string, string> = {
  processing: 'order.processing',
  completed: 'order.completed',
  failed: 'order.failed',
  refunded: 'order.refunded',
}

// Updates one order's status (+optional payment_status) and enqueues webhook deliveries
// for every active key of the order owner that subscribes to the event.
export async function setOrderStatus(
  orderId: string,
  newStatus: string,
  opts: { paymentStatus?: string },
  supabase: any
): Promise<void> {
  const { data: order } = await supabase
    .from('orders')
    .select('id, user_id, reference_code, status, payment_status')
    .eq('id', orderId)
    .single()
  if (!order) return

  const patch: any = { status: newStatus, updated_at: new Date().toISOString() }
  if (opts.paymentStatus) patch.payment_status = opts.paymentStatus
  await supabase.from('orders').update(patch).eq('id', orderId)

  if (order.status === newStatus) return // no real change

  const event = EVENT_FOR_STATUS[newStatus]
  if (!event) return

  const { data: keys } = await supabase
    .from('api_keys')
    .select('id, webhook_url, webhook_events')
    .eq('user_id', order.user_id)
    .eq('status', 'active')

  for (const k of keys || []) {
    if (!k.webhook_url || !(k.webhook_events || []).includes(event)) continue
    await supabase.from('api_webhook_deliveries').insert({
      api_key_id: k.id,
      event,
      order_id: orderId,
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
