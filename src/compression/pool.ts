export class CompressionCancelled extends Error {
  constructor() { super('Compression cancelled.') }
}

interface Task {
  start: () => void
  cancel: () => void
}

interface CancellationGroup {
  tasks: Set<Task>
  cancel: () => void
}

/** FIFO admission control shared by previews and batches. Queued tasks hold no image bytes. */
export class CompressionPool {
  private readonly waiting: Task[] = []
  private readonly active = new Set<Task>()
  private readonly cancellations = new Map<AbortSignal, CancellationGroup>()
  private disposed = false

  constructor(readonly concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1) { throw new Error('Compression concurrency must be a positive integer.') }
  }

  run<T>(action: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.disposed || signal?.aborted) { return Promise.reject(new CompressionCancelled()) }
    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController()
      let task: Task
      const cleanup = () => {
        if (!signal) { return }
        const group = this.cancellations.get(signal)
        if (!group) { return }
        group.tasks.delete(task)
        if (!group.tasks.size) {
          signal.removeEventListener('abort', group.cancel)
          this.cancellations.delete(signal)
        }
      }
      task = {
        cancel: () => {
          controller.abort(new CompressionCancelled())
          const index = this.waiting.indexOf(task)
          if (index >= 0) {
            this.waiting.splice(index, 1)
            cleanup()
            reject(new CompressionCancelled())
          }
        },
        start: () => {
          this.active.add(task)
          void Promise.resolve().then(() => {
            controller.signal.throwIfAborted()
            return action(controller.signal)
          }).then(resolve, reject).finally(() => {
            cleanup()
            this.active.delete(task)
            this.drain()
          })
        },
      }
      if (signal) {
        let group = this.cancellations.get(signal)
        if (!group) {
          const tasks = new Set<Task>()
          const cancel = () => { for (const task of [...tasks]) { task.cancel() } }
          group = { tasks, cancel }
          this.cancellations.set(signal, group)
          // One listener per batch, even when hundreds of tasks share its signal.
          signal.addEventListener('abort', cancel, { once: true })
        }
        group.tasks.add(task)
      }
      this.waiting.push(task)
      this.drain()
    })
  }

  private drain(): void {
    while (!this.disposed && this.active.size < this.concurrency && this.waiting.length) {
      this.waiting.shift()!.start()
    }
  }

  dispose(): void {
    this.disposed = true
    for (const task of [...this.waiting, ...this.active]) { task.cancel() }
  }
}
