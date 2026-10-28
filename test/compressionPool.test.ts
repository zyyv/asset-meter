import { getEventListeners } from 'node:events'
import { expect, it, vi } from 'vitest'
import { CompressionPool } from '../src/compression/pool'

function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

it('limits running tasks, serves the queue in order and recovers after a task fails', async () => {
  const pool = new CompressionPool(2)
  const started: number[] = []
  const gates = Array.from({ length: 5 }, gate)
  let active = 0; let peak = 0
  const jobs = gates.map((gate, index) => pool.run(async () => {
    started.push(index)
    peak = Math.max(peak, ++active)
    await gate.promise
    active--
    if (index === 0) { throw new Error('Encoder failed') }
    return index
  }))
  const results = Promise.allSettled(jobs)
  await vi.waitFor(() => expect(started).toEqual([0, 1]))
  gates[0]!.release()
  await vi.waitFor(() => expect(started).toEqual([0, 1, 2]))
  gates[1]!.release(); gates[2]!.release()
  await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3, 4]))
  gates[3]!.release(); gates[4]!.release()
  expect(peak).toBe(2)
  expect((await results).map(result => result.status)).toEqual(['rejected', 'fulfilled', 'fulfilled', 'fulfilled', 'fulfilled'])
  pool.dispose()
})

it('removes cancelled queued tasks without starting them or consuming another slot', async () => {
  const pool = new CompressionPool(1)
  const first = gate()
  const controller = new AbortController()
  const queued = vi.fn()
  const running = pool.run(async () => first.promise)
  const cancelled = pool.run(queued, controller.signal)
  const rejection = expect(cancelled).rejects.toThrow('Compression cancelled.')
  const last = vi.fn(async () => 'done')
  const final = pool.run(last)
  controller.abort()
  await rejection
  expect(queued).not.toHaveBeenCalled()
  expect(last).not.toHaveBeenCalled()
  first.release()
  await running
  expect(await final).toBe('done')
  pool.dispose()
})

it('keeps a cancelled active task in its slot until its worker finishes stopping', async () => {
  const pool = new CompressionPool(1)
  const stopped = gate()
  const controller = new AbortController()
  const running = pool.run(async (signal) => {
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    await stopped.promise
    signal.throwIfAborted()
  }, controller.signal)
  const rejection = expect(running).rejects.toThrow('Compression cancelled.')
  await vi.waitFor(() => expect(controller.signal.aborted).toBe(false))
  // Allow the first action's microtask to install its abort listener.
  await Promise.resolve()
  const next = vi.fn(async () => {})
  const queued = pool.run(next)
  controller.abort()
  await Promise.resolve()
  expect(next).not.toHaveBeenCalled()
  stopped.release()
  await rejection
  await queued
  expect(next).toHaveBeenCalledOnce()
  pool.dispose()
})

it('disposal aborts running work, rejects queued work and refuses new work', async () => {
  const pool = new CompressionPool(1)
  const running = pool.run(async (signal) => {
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    signal.throwIfAborted()
  })
  const queuedAction = vi.fn()
  const queued = pool.run(queuedAction)
  const results = Promise.allSettled([running, queued])
  await Promise.resolve()
  pool.dispose()
  expect((await results).every(result => result.status === 'rejected')).toBe(true)
  expect(queuedAction).not.toHaveBeenCalled()
  await expect(pool.run(vi.fn())).rejects.toThrow('cancelled')
  expect(() => new CompressionPool(0)).toThrow('positive integer')
})

it('shares one cancellation listener across large batches and releases it on cancellation', async () => {
  const pool = new CompressionPool(2)
  const controller = new AbortController()
  const jobs = Array.from({ length: 50 }, () => pool.run(async (signal) => {
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    signal.throwIfAborted()
  }, controller.signal))
  const results = Promise.allSettled(jobs)
  await Promise.resolve()
  expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1)
  controller.abort()
  expect((await results).every(result => result.status === 'rejected')).toBe(true)
  expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
  pool.dispose()
})
