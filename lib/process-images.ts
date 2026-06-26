// The browser decodes the original photo (handles JPEG, PNG, and the HEIC the
// iPhone camera produces) and we resize it on a canvas. The WebP *encode* is
// done with a WASM codec (@jsquash/webp) instead of canvas.toBlob("image/webp")
// because native WebP encoding is missing or broken on several mobile browsers,
// which previously produced PNG bytes the server rejected.
const MAX_ORIGINAL_BYTES = 25 * 1024 * 1024;
// Target size for the WebP optimization. We lower the quality to try to reach
// it, but never block the upload if the photo is still heavier — it only needs
// to fit the 20 MB server limit, which a 1920 px WebP is always far below.
const TARGET_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 1920;

export interface ProcessedImage {
  id: string;
  file: File;
  previewUrl: string;
  width: number;
  height: number;
}

async function loadImage(file: File) {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      return {
        source: bitmap as CanvasImageSource,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Some mobile browsers expose createImageBitmap but cannot decode
      // every format available in the native photo picker.
    }
  }

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () =>
        reject(new Error("El teléfono no pudo abrir esta imagen."));
      element.src = sourceUrl;
    });
    return {
      source: image as CanvasImageSource,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(sourceUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(sourceUrl);
    throw error;
  }
}

export async function processImage(file: File): Promise<ProcessedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("El archivo seleccionado no es una imagen.");
  }
  if (file.size > MAX_ORIGINAL_BYTES) {
    throw new Error("Cada archivo original puede pesar como máximo 20 MB.");
  }

  const image = await loadImage(file);
  const scale = Math.min(
    1,
    MAX_DIMENSION / Math.max(image.width, image.height)
  );
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    image.close();
    throw new Error("El navegador no pudo procesar la imagen.");
  }
  context.drawImage(image.source, 0, 0, width, height);
  image.close();

  const imageData = context.getImageData(0, 0, width, height);
  const { default: encode } = await import("@jsquash/webp/encode");

  let quality = 80;
  let buffer = await encode(imageData, { quality });
  while (buffer.byteLength > TARGET_OUTPUT_BYTES && quality > 40) {
    quality -= 10;
    buffer = await encode(imageData, { quality });
  }

  const blob = new Blob([buffer], { type: "image/webp" });
  const id = crypto.randomUUID();
  const processedFile = new File([blob], `${id}.webp`, {
    type: "image/webp",
    lastModified: Date.now(),
  });
  return {
    id,
    file: processedFile,
    previewUrl: URL.createObjectURL(blob),
    width,
    height,
  };
}
