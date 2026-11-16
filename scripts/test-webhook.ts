/**
 * Send a signed fake Paystack `charge.success` webhook to the webhook route.
 *
 * Usage:
 *   npx tsx scripts/test-webhook.ts --reference <ref> --amount <ghs> \
 *       [--url <webhook url>] [--secret-env NAME] [--allow-remote]
 *
 *   --reference     payment reference (e.g. DBY-..., GST-..., WAL-...)
 *   --amount        amount in GHS (converted to pesewas)
 *   --url           default http://localhost:3000/api/webhooks/paystack
 *   --secret-env    name of env var holding the secret (default PAYSTACK_SECRET_KEY).
 *                   The secret is never taken on the command line and never printed.
 *   --allow-remote  required for any host other than localhost / 127.0.0.1
 *
 * WARNING: the secret in your environment may be a LIVE key and the target
 * database receives a REAL state change (a payment row is marked paid).
 */
import { signPaystackBody, buildChargeSuccessEvent } from '../lib/pay/webhook-signing'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
function die(msg: string): never {
  console.error(`ERROR: ${msg}`)
  process.exit(1)
}

async function main() {
  const reference = arg('reference')
  const amountGhs = Number(arg('amount'))
  const url = arg('url') ?? 'http://localhost:3000/api/webhooks/paystack'
  const secretEnv = arg('secret-env') ?? 'PAYSTACK_SECRET_KEY'
  const allowRemote = process.argv.includes('--allow-remote')

  if (!reference) die('--reference is required')
  if (!Number.isFinite(amountGhs) || amountGhs <= 0) die('--amount must be a positive number (GHS)')
  const secret = process.env[secretEnv]
  if (!secret) die(`environment variable ${secretEnv} is not set`)

  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    die(`invalid --url: ${url}`)
  }
  if (!['localhost', '127.0.0.1'].includes(host) && !allowRemote) {
    die(`refusing to send to non-local host "${host}" without --allow-remote`)
  }

  console.warn('!!! WARNING: the secret in the environment may be a LIVE key, and the')
  console.warn('!!! target database will receive a REAL state change (payment marked paid).')
  console.warn(`Target: ${url}  reference: ${reference}  amount: GHS ${amountGhs}`)

  const { body } = buildChargeSuccessEvent({ reference, amountKobo: Math.round(amountGhs * 100) })
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-paystack-signature': signPaystackBody(body, secret) },
    body,
  })
  const text = await res.text()
  let json: unknown = text
  try { json = JSON.parse(text) } catch {}
  console.log(`HTTP ${res.status}`)
  console.log(JSON.stringify(json, null, 2))
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)))
