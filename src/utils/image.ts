/**
 * Client-side image upload helpers.
 *
 * The prototype persists uploads as compact data URLs (products, staff
 * avatars). Files are downscaled on a canvas so they stay comfortably
 * inside the localStorage quota; production would upload to object
 * storage and store the returned URL instead.
 */

const DEFAULT_MAX = 520
const JPEG_QUALITY = 0.82

export interface ReadImageOptions {
  /** Longest edge in px. Smaller files keep localStorage happy. */
  maxSize?: number
}

/** Reads an image file and returns a downscaled JPEG data URL. */
export function fileToDataUrl(file: File, options: ReadImageOptions = {}): Promise<string> {
  const maxSize = options.maxSize ?? DEFAULT_MAX

  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onerror = () => reject(new Error('Could not read the selected image file.'))
    reader.onload = () => {
      const source = reader.result
      if (typeof source !== 'string') {
        reject(new Error('Could not read the selected image file.'))
        return
      }

      const image = new Image()
      image.onerror = () => reject(new Error('The selected file is not a valid image.'))
      image.onload = () => {
        try {
          const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight))
          const width = Math.max(1, Math.round(image.naturalWidth * scale))
          const height = Math.max(1, Math.round(image.naturalHeight * scale))

          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const context = canvas.getContext('2d')
          if (!context) {
            reject(new Error('Image processing is not available in this browser.'))
            return
          }
          context.drawImage(image, 0, 0, width, height)
          resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY))
        } catch {
          reject(new Error('Could not process the selected image.'))
        }
      }
      image.src = source
    }

    reader.readAsDataURL(file)
  })
}