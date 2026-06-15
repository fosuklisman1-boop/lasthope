import { describe, it, expect } from 'vitest'
import { isPrivateIp, validateWebhookUrlShape } from './ssrf-guard'

describe('ssrf-guard', () => {
  it('flags private/loopback/link-local/metadata IPs', () => {
    for (const ip of ['127.0.0.1','10.0.0.5','192.168.1.1','172.16.0.1','169.254.169.254','0.0.0.0','::1','fc00::1'])
      expect(isPrivateIp(ip)).toBe(true)
  })
  it('allows public IPs', () => {
    for (const ip of ['8.8.8.8','1.1.1.1','93.184.216.34']) expect(isPrivateIp(ip)).toBe(false)
  })
  it('shape check requires https and rejects obvious bad hosts', () => {
    expect(validateWebhookUrlShape('https://hooks.example.com/x').ok).toBe(true)
    expect(validateWebhookUrlShape('http://hooks.example.com/x').ok).toBe(false)
    expect(validateWebhookUrlShape('https://localhost/x').ok).toBe(false)
    expect(validateWebhookUrlShape('https://127.0.0.1/x').ok).toBe(false)
    expect(validateWebhookUrlShape('ftp://x').ok).toBe(false)
  })
})
