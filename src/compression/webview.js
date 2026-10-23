/* global acquireVsCodeApi, document, window */
const vscode = acquireVsCodeApi()
const save = document.getElementById('save')
const discard = document.getElementById('discard')
const status = document.getElementById('status')
const mode = document.getElementById('mode')
const zoom = document.getElementById('zoom')
const plugin = document.getElementById('plugin')
const recompress = document.getElementById('recompress')
const pluginDescription = document.getElementById('plugin-description')
const resultId = document.body.dataset.resultId
const resultPlugin = plugin.value
const canSave = save.dataset.canSave === 'true'
let finished = false
let busy = false
let previewReady = false
function setBusy(value) {
  busy = value
  plugin.disabled = busy || finished
  recompress.disabled = busy || finished
  save.disabled = busy || finished || !previewReady || !canSave || plugin.value !== resultPlugin
}
const previous = vscode.getState()
if (previous?.saved && previous.resultId === resultId) {
  finished = true
  status.textContent = previous.text
  status.classList.add('success')
  setBusy(false)
  save.textContent = 'Saved'
  discard.textContent = 'Close'
}
// Header validation cannot detect all damaged pixel data. Decode before allowing a save.
Promise.all([...document.querySelectorAll('.pair img')].map(image => image.decode())).then(() => {
  previewReady = true
  vscode.postMessage({ type: 'previewReady', resultId })
  setBusy(busy)
}).catch(() => {
  previewReady = false
  status.textContent = 'The image preview could not be decoded. Saving is disabled. Choose another plugin or compress again.'
  status.classList.remove('success')
  vscode.postMessage({ type: 'previewError', resultId })
  setBusy(busy)
})
save.addEventListener('click', () => {
  setBusy(true)
  discard.disabled = true
  vscode.postMessage({ type: 'save' })
})
discard.addEventListener('click', () => vscode.postMessage({ type: 'discard' }))
plugin.addEventListener('change', () => {
  pluginDescription.textContent = plugin.selectedOptions[0].dataset.description
  status.textContent = plugin.value === resultPlugin
    ? 'Review the images, then save. The original has not been changed.'
    : 'Click Compress Again to use the selected plugin.'
  setBusy(false)
})
recompress.addEventListener('click', () => {
  setBusy(true)
  status.textContent = `Compressing with ${plugin.selectedOptions[0].textContent}…`
  status.classList.remove('success')
  vscode.postMessage({ type: 'compress', plugin: plugin.value })
})
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
  if (data?.type === 'compressionResult') {
    plugin.value = data.plugin
    pluginDescription.textContent = plugin.selectedOptions[0].dataset.description
    status.textContent = data.text
    setBusy(false)
    return
  }
  if (data?.type !== 'saveResult') { return }
  status.textContent = data.text
  status.classList.toggle('success', data.saved)
  finished = data.saved
  setBusy(false)
  discard.disabled = false
  if (data.saved) {
    vscode.setState({ saved: true, text: data.text, resultId })
    save.textContent = 'Saved'; discard.textContent = 'Close'
  }
})
