import type * as vscode from 'vscode'

export type Logger = Pick<vscode.LogOutputChannel, 'debug' | 'info' | 'warn' | 'error'>

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
}
