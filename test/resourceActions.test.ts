import assert from 'node:assert/strict'
import { beforeEach, it, vi } from 'vitest'
import * as vscode from 'vscode'
import { deleteResource } from '../src/resourceActions'
import { resetWorkspace, workspaceUris } from './support/workspace'

vi.mock('vscode', async () => (await import('./support/workspace')).createVscodeMock())
const { assets, logo } = workspaceUris(vscode)
beforeEach(() => resetWorkspace(vscode))

it('waits for explicit confirmation before deleting the exact file and refreshing', async () => {
  const refreshed = vi.fn()
  let confirm = (_value: vscode.MessageItem | undefined) => {}
  const answer = new Promise<vscode.MessageItem | undefined>((resolve) => { confirm = resolve })
  vi.mocked(vscode.window.showWarningMessage).mockReturnValueOnce(answer)
  const pending = deleteResource(logo, refreshed)
  await vi.waitFor(() => assert.equal(vi.mocked(vscode.window.showWarningMessage).mock.calls.length, 1))
  assert.equal(vi.mocked(vscode.workspace.fs.delete).mock.calls.length, 0)
  const prompt = vi.mocked(vscode.window.showWarningMessage).mock.calls[0]!
  assert.ok((prompt[1] as vscode.MessageOptions).modal)
  assert.ok((prompt[1] as vscode.MessageOptions).detail?.includes(logo.fsPath))
  confirm({ title: 'Delete' })
  assert.equal(await pending, true)
  assert.deepEqual(vi.mocked(vscode.workspace.fs.delete).mock.calls[0], [logo, { recursive: false, useTrash: true }])
  assert.deepEqual(refreshed.mock.calls, [[logo]])
})

it.each([undefined, { title: 'Cancel' }])('does not delete or refresh after cancelling the confirmation (%j)', async (answer) => {
  const refreshed = vi.fn()
  vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce(answer)
  assert.equal(await deleteResource(logo, refreshed), false)
  assert.equal(vi.mocked(vscode.workspace.fs.delete).mock.calls.length, 0)
  assert.equal(refreshed.mock.calls.length, 0)
})

it('warns about folder contents and requests recursive deletion only after confirmation', async () => {
  vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce({ title: 'Delete' })
  assert.equal(await deleteResource(assets, vi.fn()), true)
  assert.match(vi.mocked(vscode.window.showWarningMessage).mock.calls[0]![1]!.detail!, /all files and folders/)
  assert.deepEqual(vi.mocked(vscode.workspace.fs.delete).mock.calls[0], [assets, { recursive: true, useTrash: true }])
})

it('does not allow deleting workspace roots or a missing resource argument', async () => {
  const refreshed = vi.fn()
  assert.equal(await deleteResource(undefined, refreshed), false)
  assert.equal(await deleteResource(vscode.workspace.workspaceFolders![0]!.uri, refreshed), false)
  assert.equal(vi.mocked(vscode.window.showWarningMessage).mock.calls.length, 0)
  assert.equal(vi.mocked(vscode.workspace.fs.delete).mock.calls.length, 0)
})

it('reports a failed deletion without refreshing it as a successful removal', async () => {
  const refreshed = vi.fn()
  vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce({ title: 'Delete' })
  vi.mocked(vscode.workspace.fs.delete).mockRejectedValueOnce(new Error('Read only'))
  assert.equal(await deleteResource(logo, refreshed), false)
  assert.equal(refreshed.mock.calls.length, 0)
  assert.match(vi.mocked(vscode.window.showErrorMessage).mock.calls[0]![0], /Read only/)
})
