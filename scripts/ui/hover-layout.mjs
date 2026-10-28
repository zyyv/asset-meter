/* global document, NodeFilter, getComputedStyle */
// Inspect actual text baselines and painted glyphs, not just element boxes.
export async function inspectHoverRows(hover) {
  await hover.evaluate(() => document.fonts.ready.then(() => true))
  return hover.locator('table > tbody > tr').evaluateAll(elements => elements.filter(element => element.children.length === 4).map((element) => {
    const label = element.children[1].querySelector('span')
    const value = element.lastElementChild.querySelector('span, strong')
    const icon = element.firstElementChild.querySelector('.codicon')
    const range = document.createRange()
    range.selectNodeContents(label)
    const left = range.getBoundingClientRect()
    const labelBox = label.getBoundingClientRect()
    const right = value.getBoundingClientRect()
    const iconBox = icon?.getBoundingClientRect()
    const baseline = (node) => {
      const marker = document.createElement('span')
      Object.assign(marker.style, { display: 'inline-block', width: '0', height: '0', verticalAlign: 'baseline' })
      const text = document.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode()
      if (text) { text.parentNode.insertBefore(marker, text) }
      else { node.append(marker) }
      const result = marker.getBoundingClientRect().top
      marker.remove()
      return result
    }
    const context = document.createElement('canvas').getContext('2d')
    const inkCenter = (node, text) => {
      const style = getComputedStyle(node)
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const metrics = context.measureText(text)
      return baseline(node) + (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2
    }
    const glyph = icon && getComputedStyle(icon, '::before').content
    const opticalOffset = icon && Math.abs(inkCenter(icon, JSON.parse(glyph)) - inkCenter(label, label.textContent))
    return { label: label.textContent.trim(), value: value.textContent.trim(), left: left.left, right: right.right, gap: right.left - left.right, top: left.top, bottom: Math.max(left.bottom, right.bottom), baselineOffset: Math.abs(baseline(label) - baseline(value)), keyColor: getComputedStyle(label).color, valueColor: getComputedStyle(value).color, iconColor: icon && getComputedStyle(icon).color, iconWidth: iconBox?.width, iconGap: iconBox && labelBox.left - iconBox.right, opticalOffset, glyph }
  }))
}
