const SOI = Buffer.from([0xff, 0xd8])
const EOI = Buffer.from([0xff, 0xd9])
const SOS = 0xda

/**
 * Segments that carry metadata rather than image data: APP1–APP15 (EXIF
 * with GPS, XMP, ICC profiles, maker notes, Photoshop data) and comments.
 * APP0 (JFIF) and APP14 (Adobe) are kept: they only describe how to decode
 * the image, and dropping APP14 can change the colours of some JPEGs.
 */
function isMetadata(marker: number): boolean {
  return (marker >= 0xe1 && marker <= 0xef && marker !== 0xee) || marker === 0xfe
}

/** Markers without a length field: TEM and the restart markers RST0–RST7 */
function isStandalone(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)
}

/**
 * End of the entropy-coded data that starts at `offset`: the position of
 * the next marker. Stuffed bytes (FF 00), restart markers and fill bytes
 * belong to the scan. Returns null when the data ends without a marker.
 */
function endOfScan(data: Buffer, offset: number): number | null {
  let i = offset
  while (i + 1 < data.length) {
    if (data[i] === 0xff) {
      const next = data[i + 1]
      if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
        i += 2
        continue
      }
      if (next === 0xff) {
        i += 1
        continue
      }
      return i
    }
    i += 1
  }
  return null
}

/**
 * Removes all metadata segments from a JPEG without re-encoding it: the
 * image data is copied byte for byte. Anything after the end-of-image
 * marker (some phones append extra data there) is dropped as well.
 * Returns null for anything that is not a complete, well-formed JPEG.
 */
export function stripJpegMetadata(data: Buffer): Buffer | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    return null
  }

  const parts: Buffer[] = [SOI]
  let offset = 2
  while (offset + 1 < data.length) {
    if (data[offset] !== 0xff) {
      return null
    }
    const marker = data[offset + 1]
    if (marker === 0xff) {
      // Fill byte before a marker.
      offset += 1
      continue
    }
    if (marker === 0xd9) {
      parts.push(EOI)
      return Buffer.concat(parts)
    }
    if (isStandalone(marker)) {
      parts.push(data.subarray(offset, offset + 2))
      offset += 2
      continue
    }

    if (offset + 4 > data.length) return null
    const length = data.readUInt16BE(offset + 2)
    const end = offset + 2 + length
    if (length < 2 || end > data.length) return null
    if (!isMetadata(marker)) {
      parts.push(data.subarray(offset, end))
    }
    offset = end

    if (marker === SOS) {
      // Image data follows; progressive JPEGs have several scans, and
      // segments between them are checked like the ones before.
      const scanEnd = endOfScan(data, offset)
      if (scanEnd === null) return null
      parts.push(data.subarray(offset, scanEnd))
      offset = scanEnd
    }
  }
  // No end-of-image marker
  return null
}
