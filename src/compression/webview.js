/* global acquireVsCodeApi, document, window */
const vscode = acquireVsCodeApi()
const save = document.getElementById('save')
const discard = document.getElementById('discard')
const status = document.getElementById('status')
const mode = document.getElementById('mode')
const zoom = document.getElementById('zoom')
const previous = vscode.getState()
if (previous?.saved) {
  status.textContent = previous.text
  status.classList.add('success')
  save.disabled = true
  save.textContent = 'Saved'
  discard.textContent = 'Close'
}
save.addEventListener('click', () => {
  save.disabled = true
  discard.disabled = true
  vscode.postMessage({ type: 'save' })
})
discard.addEventListener('click', () => vscode.postMessage({ type: 'discard' }))
mode.addEventListener('change', () => {
  document.body.classList.toggle('slider', mode.value === 'slider')
  document.getElementById('zoom-control').hidden = mode.value === 'slider'
})
zoom.addEventListener('change', () => document.body.classList.toggle('actual', zoom.value === 'actual'))
document.getElementById('split').addEventListener('input', (event) => {
  document.getElementById('after-overlay').style.clipPath = `inset(0 0 0 ${event.target.value}%)`
})
const canvases = [...document.querySelectorAll('.pair .canvas')]
for (const canvas of canvases) {
  canvas.addEventListener('scroll', () => {
    for (const other of canvases) {
      if (other !== canvas) { other.scrollLeft = canvas.scrollLeft; other.scrollTop = canvas.scrollTop }
    }
  })
}
window.addEventListener('message', ({ data }) => {
  if (data?.type !== 'saveResult') { return }
  status.textContent = data.text
  status.classList.toggle('success', data.saved)
  save.disabled = data.saved
  discard.disabled = false
  if (data.saved) {
    vscode.setState({ saved: true, text: data.text })
    save.textContent = 'Saved'; discard.textContent = 'Close'
  }
})
