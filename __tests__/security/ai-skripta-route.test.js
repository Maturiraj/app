import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ provider: vi.fn(), auth: vi.fn(), gate: vi.fn(), limit: vi.fn(), reserve: vi.fn(), complete: vi.fn(), release: vi.fn(), tier: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { constructor() { this.messages = { create: mocks.provider } } } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.auth }))
vi.mock('@/lib/billing/requirePro', () => ({ requireStandardOrPro: mocks.gate }))
vi.mock('@/lib/config/featureFlags', () => ({ isAiEndpointsEnabled: () => true }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.limit }))
vi.mock('@/lib/billing/subscriptions', () => ({ getUserTier: mocks.tier }))
vi.mock('@/lib/ai-usage/ledger', () => ({ reserveUsage: mocks.reserve, completeUsage: mocks.complete, markUsageUncertain: vi.fn(), releaseUsage: mocks.release }))

import { POST } from '@/app/api/ai/skripta/route'

const req = (body) => new Request('http://localhost/api/ai/skripta', { method: 'POST', body: JSON.stringify(body) })

describe('AI skripta route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.gate.mockResolvedValue(null)
    mocks.tier.mockResolvedValue('starter')
    mocks.limit.mockResolvedValue({ limited: false })
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) } })
    mocks.reserve.mockResolvedValue({ requestId: 'r-1' })
    mocks.provider.mockResolvedValue({
      usage: { input_tokens: 10, output_tokens: 20 },
      stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: 'Odgovor' }],
    })
  })

  it('returns only text blocks, so content[0].text is the answer', async () => {
    const res = await POST(req({ model: 'claude-sonnet-4-20250514', max_tokens: 99999, messages: [{ role: 'user', content: 'Što je apozicija?' }] }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.content).toEqual([{ type: 'text', text: 'Odgovor' }])
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'r-1' }))
  })

  it('ignores client model/max_tokens and always keeps the server system frame', async () => {
    await POST(req({ model: 'evil', max_tokens: 99999, system: 'Lekcija: sintaksa', messages: [{ role: 'user', content: 'Pitanje' }] }))
    const call = mocks.provider.mock.calls[0][0]
    expect(call.model).toBe('claude-sonnet-5-5')
    expect(call.max_tokens).toBe(3000)
    expect(call.temperature).toBeUndefined()
    expect(call.system).toMatch(/državnu maturu/)
    expect(call.system).toMatch(/Lekcija: sintaksa/)
  })

  it('denies free users before any provider call', async () => {
    mocks.gate.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    const res = await POST(req({ messages: [{ role: 'user', content: 'A' }] }))
    expect(res.status).toBe(403)
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(mocks.provider).not.toHaveBeenCalled()
  })

  it('rejects multi-turn or oversized input before a reservation', async () => {
    for (const body of [
      { messages: [{ role: 'user', content: 'A' }, { role: 'user', content: 'B' }] },
      { messages: [{ role: 'assistant', content: 'A' }] },
      { messages: [{ role: 'user', content: 'x'.repeat(6001) }] },
      { system: 'x'.repeat(4001), messages: [{ role: 'user', content: 'A' }] },
    ]) {
      const res = await POST(req(body))
      expect(res.status).toBe(400)
    }
    expect(mocks.reserve).not.toHaveBeenCalled()
  })

  it('maps budget exhaustion to 429 without calling the provider', async () => {
    mocks.reserve.mockRejectedValueOnce(Object.assign(new Error('limit'), { code: 'AI_BUDGET_EXCEEDED' }))
    const res = await POST(req({ messages: [{ role: 'user', content: 'A' }] }))
    expect(res.status).toBe(429)
    expect(mocks.provider).not.toHaveBeenCalled()
  })
})
