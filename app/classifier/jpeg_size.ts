/**
 * Start-of-frame markers (SOF0–SOF15) carry the image size. DHT (C4),
 * JPG (C8) and DAC (CC) share the range but are not frames.
 */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
}

/**
 * Reads width and height from a JPEG's frame header without decoding the
 * image. Returns null for anything that is not a well-formed JPEG header.
 */
export function readJpegSize(data: Buffer): { width: number; height: number } | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    return null
  }

  let offset = 2
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) {
      return null
    }
    const marker = data[offset + 1]
    if (marker === 0xff) {
      // Fill byte before a marker.
      offset += 1
      continue
    }
    // Markers without a length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      if (marker === 0xd9) return null
      offset += 2
      continue
    }

    const length = data.readUInt16BE(offset + 2)
    if (length < 2) {
      return null
    }
    if (isStartOfFrame(marker)) {
      if (offset + 9 > data.length) return null
      const height = data.readUInt16BE(offset + 5)
      const width = data.readUInt16BE(offset + 7)
      return width > 0 && height > 0 ? { width, height } : null
    }
    // Image data starts after start-of-scan; a frame header must come first.
    if (marker === 0xda) {
      return null
    }
    offset += 2 + length
  }
  return null
}
