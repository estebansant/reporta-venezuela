const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export function readWebpDimensions(bytes: Uint8Array) {
  if (bytes.byteLength < 30) return null;
  const text = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));

  if (text(0, 4) !== "RIFF" || text(8, 4) !== "WEBP") return null;
  const chunk = text(12, 4);

  if (chunk === "VP8X") {
    return {
      width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
    };
  }

  if (chunk === "VP8 " && text(23, 3) === String.fromCharCode(0x9d, 0x01, 0x2a)) {
    return {
      width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
      height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
    };
  }

  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const bits =
      bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  return null;
}

export async function validateWebpFile(file: File) {
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dimensions = readWebpDimensions(bytes);
  if (!dimensions) return null;
  return { bytes, ...dimensions };
}
