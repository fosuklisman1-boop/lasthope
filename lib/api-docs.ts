// NOTE: This is the canonical in-app copy of the LASTHOPE Developer API docs.
// The repo copy at docs/api/README.md points here.
// Update both if the content changes.

export const API_DOCS_MARKDOWN = `# LASTHOPE Developer API — Integrator Reference

This document covers everything you need to integrate the LASTHOPE data-bundle purchasing API into your own application. All requests are billed to your LASTHOPE wallet at your account's tier price.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Getting a Key](#2-getting-a-key)
3. [Authentication](#3-authentication)
4. [Base URL & Versioning](#4-base-url--versioning)
5. [Rate Limits](#5-rate-limits)
6. [Endpoints](#6-endpoints)
   - [GET /api/v1/packages](#get-apiv1packages)
   - [POST /api/v1/orders](#post-apiv1orders)
   - [GET /api/v1/orders/{reference}](#get-apiv1ordersreference)
   - [GET /api/v1/wallet](#get-apiv1wallet)
7. [Error Format](#7-error-format)
8. [Webhooks](#8-webhooks)
9. [Funding Your Wallet](#9-funding-your-wallet)

---

## 1. Overview

The LASTHOPE Developer API lets account holders purchase data bundles programmatically and embed that capability into their own websites or backend services. Each successful order is charged directly to the caller's LASTHOPE wallet at the price tier associated with their account role (agent, dealer, etc.). You can query available packages, place orders, check order status, and monitor wallet balance — all over HTTPS with a bearer token.

---

## 2. Getting a Key

1. Log in to your LASTHOPE dashboard and open the **Developer** page.
2. Click **Create API Key**, give it a label, and optionally set a webhook URL and subscribed events.
3. An admin must **approve** your key before it becomes active. A newly created key has status \`pending\` and all requests return \`401\` until approval.
4. **The raw key (\`lh_live_...\`) and the webhook secret (\`whsec_...\`) are shown exactly once** — at the moment of creation (or rotation). Copy them to a secure secret store immediately; they cannot be retrieved again.

To rotate a key: revoke the old one and create a new one. There is no in-place rotation — your old key stops working as soon as it is revoked, so rotate during a low-traffic window.

---

## 3. Authentication

Send your API key as a Bearer token in the \`Authorization\` header on every request:

\`\`\`http
Authorization: Bearer lh_live_...
\`\`\`

**Keys in the query string are rejected.** Never include a key in a URL — URLs are logged in server access logs, browser history, and referrer headers.

Keys are secret server-side credentials. Do not ship them in client-side JavaScript or mobile app binaries. If a key is compromised, revoke it immediately from the Developer dashboard and issue a new one.

---

## 4. Base URL & Versioning

All v1 endpoints are rooted at:

\`\`\`
https://<your-lasthope-domain>/api/v1
\`\`\`

The \`v1\` prefix is part of the path. Breaking changes will be introduced under a new version prefix (\`/api/v2\`, etc.) with advance notice. Additive changes (new optional fields, new endpoints) may be made to v1 without versioning.

---

## 5. Rate Limits

Each API key has a per-minute request limit configured by the admin (default: **60 requests per minute**). When you exceed the limit the API responds with:

\`\`\`
HTTP 429 Too Many Requests
Retry-After: <seconds>
\`\`\`

Honour the \`Retry-After\` value before retrying. Bursting beyond the limit repeatedly may result in key suspension.

---

## 6. Endpoints

### GET /api/v1/packages

Returns the list of currently available data packages. Prices reflect **your account's tier** — the same prices you would pay when ordering.

**Request**

\`\`\`http
GET /api/v1/packages HTTP/1.1
Authorization: Bearer lh_live_...
\`\`\`

**Response \`200\`**

\`\`\`json
{
  "data": [
    {
      "id": "pkg_mtn_1gb",
      "network": "MTN",
      "size": "1GB",
      "description": "MTN 1GB — 30 days",
      "price": 7.50,
      "currency": "GHS"
    },
    {
      "id": "pkg_at_2gb",
      "network": "AirtelTigo",
      "size": "2GB",
      "description": "AirtelTigo 2GB — 7 days",
      "price": 9.00,
      "currency": "GHS"
    }
  ]
}
\`\`\`

**Error codes**

| Status | \`code\`         | Meaning                     |
|--------|----------------|-----------------------------|
| 401    | \`unauthorized\` | Missing, invalid, or pending key |
| 429    | \`rate_limited\` | Per-minute limit exceeded   |
| 500    | \`server_error\` | Failed to load packages     |

---

### POST /api/v1/orders

Place a data-bundle order. The cost is deducted from your wallet immediately. Orders are fulfilled manually and start in \`pending\` status.

**Request**

\`\`\`http
POST /api/v1/orders HTTP/1.1
Authorization: Bearer lh_live_...
Content-Type: application/json

{
  "package_id": "pkg_mtn_1gb",
  "phone_number": "0241234567",
  "idempotency_key": "your-unique-request-id-abc123"
}
\`\`\`

| Field             | Type   | Required | Notes                                                                                                      |
|-------------------|--------|----------|------------------------------------------------------------------------------------------------------------|
| \`package_id\`      | string | Yes      | ID from \`GET /api/v1/packages\`                                                                             |
| \`phone_number\`    | string | Yes      | Ghana mobile number (e.g. \`024XXXXXXX\` or \`+233 24XXXXXXX\`)                                               |
| \`idempotency_key\` | string | Yes      | A unique string you generate per logical request. Retrying with the same key returns the original order instead of creating a duplicate. Use a UUID or similar. |

**Response \`201\`**

\`\`\`json
{
  "reference": "LH-20260614-00042",
  "status": "pending",
  "price": 7.50,
  "network": "MTN",
  "size": "1GB",
  "currency": "GHS"
}
\`\`\`

**Error codes**

| Status | \`code\`              | Meaning                                              |
|--------|---------------------|------------------------------------------------------|
| 400    | \`bad_content_type\`  | \`Content-Type\` must be \`application/json\`            |
| 400    | \`bad_body\`          | Request body is not valid JSON                       |
| 400    | \`validation_error\`  | Missing or invalid field (e.g. bad phone number)     |
| 401    | \`unauthorized\`      | Missing, invalid, or pending key                     |
| 402    | \`insufficient_funds\`| Wallet balance is too low to cover the package price |
| 404    | \`not_found\`         | \`package_id\` does not exist or is unavailable        |
| 429    | \`rate_limited\`      | Per-minute limit exceeded                            |
| 500    | \`server_error\`      | Internal error placing order                         |

---

### GET /api/v1/orders/{reference}

Retrieve the current status of a specific order.

**Request**

\`\`\`http
GET /api/v1/orders/LH-20260614-00042 HTTP/1.1
Authorization: Bearer lh_live_...
\`\`\`

**Response \`200\`**

\`\`\`json
{
  "reference": "LH-20260614-00042",
  "status": "completed",
  "payment_status": "paid",
  "network": "MTN",
  "size": "1GB",
  "phone_number": "0241234567",
  "price": 7.50,
  "created_at": "2026-06-14T10:23:45.000Z"
}
\`\`\`

**Order lifecycle**

\`\`\`
pending → processing → completed
                    ↘ failed
                      refunded
\`\`\`

| \`status\`     | Meaning                                                   |
|--------------|-----------------------------------------------------------|
| \`pending\`    | Order received, awaiting fulfilment                       |
| \`processing\` | Fulfilment in progress                                    |
| \`completed\`  | Data bundle delivered to the recipient's phone            |
| \`failed\`     | Fulfilment failed; a refund may follow                    |
| \`refunded\`   | Order failed and the charge was returned to your wallet   |

> **Note:** Order history is retained for approximately **14 days**. After that, \`GET /api/v1/orders/{reference}\` returns \`404\`. Archive references on your side if you need a longer audit trail.

**Error codes**

| Status | \`code\`         | Meaning                           |
|--------|----------------|-----------------------------------|
| 401    | \`unauthorized\` | Missing, invalid, or pending key  |
| 404    | \`not_found\`    | Order not found (or not yours)    |
| 429    | \`rate_limited\` | Per-minute limit exceeded         |
| 500    | \`server_error\` | Lookup failed                     |

---

### GET /api/v1/wallet

Returns the current balance of your LASTHOPE wallet.

**Request**

\`\`\`http
GET /api/v1/wallet HTTP/1.1
Authorization: Bearer lh_live_...
\`\`\`

**Response \`200\`**

\`\`\`json
{
  "balance": 142.50,
  "currency": "GHS"
}
\`\`\`

**Error codes**

| Status | \`code\`         | Meaning                          |
|--------|----------------|----------------------------------|
| 401    | \`unauthorized\` | Missing, invalid, or pending key |
| 429    | \`rate_limited\` | Per-minute limit exceeded        |

---

## 7. Error Format

All error responses share the same JSON shape, regardless of status code:

\`\`\`json
{
  "error": "Human-readable description of what went wrong",
  "code": "machine_readable_code"
}
\`\`\`

Standard HTTP status codes are used throughout:

| Status | Meaning            |
|--------|--------------------|
| 400    | Validation / bad request |
| 401    | Authentication failed or key not approved |
| 402    | Insufficient wallet funds |
| 404    | Resource not found |
| 429    | Rate limit exceeded |
| 5xx    | Server-side error  |

Your code should handle \`5xx\` responses with exponential back-off and retry.

---

## 8. Webhooks

Instead of polling \`GET /api/v1/orders/{reference}\`, you can receive push notifications when order status changes.

### Configuration

When creating (or editing) your API key on the Developer dashboard, supply:

- **\`webhook_url\`** — A publicly reachable \`https://\` URL on your server. Private addresses (loopback, RFC-1918 ranges, link-local, cloud metadata endpoints) are **rejected** at save time and again at delivery time (DNS-rebinding protection).
- **Subscribed events** — Choose any subset of:
  - \`order.processing\`
  - \`order.completed\`
  - \`order.failed\`
  - \`order.refunded\`

### Delivery

When a subscribed event fires, LASTHOPE sends a \`POST\` to your \`webhook_url\`:

\`\`\`http
POST /your/webhook/path HTTP/1.1
Content-Type: application/json
X-LASTHOPE-Signature: <hex string>
X-LASTHOPE-Timestamp: <unix seconds>

{
  "event": "order.completed",
  "reference": "LH-20260614-00042",
  "status": "completed",
  "payment_status": "paid",
  "timestamp": "2026-06-14T10:30:00.000Z"
}
\`\`\`

Your endpoint must return a \`2xx\` response within **5 seconds**. Non-2xx responses and network errors are retried with exponential back-off. If all retries are exhausted the delivery is abandoned — fall back to polling \`GET /api/v1/orders/{reference}\` for critical workflows.

### Verifying the Signature

The \`webhook_secret\` (\`whsec_...\`) for your key is shown **once**, at key creation. Use it to verify that deliveries genuinely come from LASTHOPE and have not been tampered with.

The signature covers the **raw request body** (before any JSON parsing), not the parsed object. Always verify on the raw bytes.

**Algorithm:** \`HMAC-SHA512\` of \`"\${timestamp}.\${rawBody}"\` using your \`webhook_secret\`, hex-encoded.

**Node.js verification snippet**

\`\`\`js
import crypto from 'crypto'

/**
 * Returns true if the webhook delivery is authentic and recent.
 *
 * @param {string} rawBody       - The raw request body string (before JSON.parse)
 * @param {string} signature     - Value of the X-LASTHOPE-Signature header
 * @param {string} timestamp     - Value of the X-LASTHOPE-Timestamp header (unix seconds)
 * @param {string} secret        - Your key's webhook_secret (whsec_...)
 */
function verifyWebhook(rawBody, signature, timestamp, secret) {
  // Reject deliveries older than 5 minutes (replay-attack protection)
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false

  const expected = crypto
    .createHmac('sha512', secret)
    .update(\`\${timestamp}.\${rawBody}\`)
    .digest('hex')

  // Constant-time comparison prevents timing attacks
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
\`\`\`

**Express example**

\`\`\`js
import express from 'express'

const app = express()

// Use express.raw() — NOT express.json() — so rawBody is available
app.post('/webhooks/lasthope', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body.toString('utf8')
  const signature = req.headers['x-lasthope-signature']
  const timestamp = req.headers['x-lasthope-timestamp']

  if (!verifyWebhook(rawBody, signature, timestamp, process.env.LASTHOPE_WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Invalid signature' })
  }

  const event = JSON.parse(rawBody)

  switch (event.event) {
    case 'order.completed':
      // fulfil downstream logic
      break
    case 'order.failed':
    case 'order.refunded':
      // notify customer, update your records
      break
  }

  res.status(200).json({ received: true })
})
\`\`\`

### Security Notes

- Your webhook endpoint must be served over **public HTTPS**. Plain \`http://\`, localhost, \`127.0.0.1\`, \`192.168.x.x\`, \`10.x.x.x\`, \`169.254.x.x\` (AWS/GCP metadata), and similar private/loopback/metadata addresses are blocked.
- Always verify the signature before acting on an event. Never trust the payload content alone.
- The 5-minute timestamp window prevents replay attacks; keep your server clock synchronised (NTP).

---

## 9. Funding Your Wallet

The API spends from your LASTHOPE wallet. There is **no API endpoint to top up the wallet** in v1. Fund your wallet through the LASTHOPE dashboard using the available top-up methods.

Monitor your balance proactively with \`GET /api/v1/wallet\`. Orders will fail with \`402 Insufficient Funds\` if your balance is too low to cover the package price.
`
