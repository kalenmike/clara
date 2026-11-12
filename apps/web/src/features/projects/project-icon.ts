/** The harness recommends 128×128 for project icons. */
export const PROJECT_ICON_SIZE = 128
export const PROJECT_ICON_MAX_INPUT_BYTES = 5 * 1024 * 1024
export const PROJECT_ICON_MAX_DATA_URL_LENGTH = 256 * 1024

const IMAGE_NAME = /\.(avif|gif|jpe?g|png|svg|webp)$/i

export class ProjectIconError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectIconError'
  }
}

/** A centered square crop, so wide or tall images are not stretched. */
export function centeredSquare(width: number, height: number) {
  const side = Math.min(width, height)
  return {
    side,
    sx: Math.floor((width - side) / 2),
    sy: Math.floor((height - side) / 2),
  }
}

type DecodedImage = {
  source: CanvasImageSource
  width: number
  height: number
  dispose: () => void
}

export function isProjectIconFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_NAME.test(file.name)
}

/**
 * Resize a chosen image to the harness's recommended 128×128 PNG and return it as
 * a data URL. The result is stored in `icon.override`, which is exactly where
 * the harness stores a custom project icon.
 */
export async function projectIconDataURL(file: File): Promise<string> {
  if (!isProjectIconFile(file)) {
    throw new ProjectIconError('Choose an image file.')
  }
  if (file.size > PROJECT_ICON_MAX_INPUT_BYTES) {
    throw new ProjectIconError('That image is larger than 5 MB.')
  }

  const image = await decode(file)
  try {
    const { side, sx, sy } = centeredSquare(image.width, image.height)
    if (side <= 0) {
      throw new ProjectIconError('That image has no readable pixels.')
    }

    const canvas = document.createElement('canvas')
    canvas.width = PROJECT_ICON_SIZE
    canvas.height = PROJECT_ICON_SIZE
    const context = canvas.getContext('2d')
    if (!context) throw new ProjectIconError('This browser cannot resize images.')

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image.source, sx, sy, side, side, 0, 0, PROJECT_ICON_SIZE, PROJECT_ICON_SIZE)

    let dataURL: string
    try {
      dataURL = canvas.toDataURL('image/png')
    } catch {
      throw new ProjectIconError('That image could not be processed. Try a different file.')
    }

    if (dataURL.length > PROJECT_ICON_MAX_DATA_URL_LENGTH) {
      throw new ProjectIconError('That image is too large. Try a simpler or smaller image.')
    }
    return dataURL
  } finally {
    image.dispose()
  }
}

async function decode(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        dispose: () => bitmap.close(),
      }
    } catch {
      // Some browsers refuse SVG here; the Image element below handles it.
    }
  }

  const url = URL.createObjectURL(file)
  try {
    const image = await loadImage(url)
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => URL.revokeObjectURL(url),
    }
  } catch {
    URL.revokeObjectURL(url)
    throw new ProjectIconError('That image could not be read. Try a different file.')
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not decode the image'))
    image.src = src
  })
}
