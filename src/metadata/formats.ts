export const previewImageExtensions = ['jpg', 'jpeg', 'jpe', 'png', 'webp', 'gif', 'avif', 'svg', 'ico', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'iiq']

const previewPattern = new RegExp(`\\.(?:${previewImageExtensions.join('|')})$`, 'i')
const metadataPattern = /\.(?:jpe?g|jpe|png|webp|tiff?|heic|heif|avif|iiq)$/i

export function supportsMetadata(path: string): boolean { return metadataPattern.test(path) }
export function isPreviewImage(path: string): boolean { return previewPattern.test(path) }
