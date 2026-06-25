const MAX_ORIGINAL_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 1920;

export interface ProcessedImage {
  id: string;
  file: File;
  previewUrl: string;
  width: number;
  height: number;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("No se pudo convertir la imagen."))),
      "image/webp",
      quality,
    );
  });
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
    throw new Error("Cada archivo original puede pesar como máximo 10 MB.");
  }

  const image = await loadImage(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height));
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

  let quality = 0.6;
  let blob = await canvasToBlob(canvas, quality);
  while (blob.size > MAX_OUTPUT_BYTES && quality > 0.3) {
    quality -= 0.1;
    blob = await canvasToBlob(canvas, quality);
  }
  if (blob.size > MAX_OUTPUT_BYTES) {
    throw new Error("La imagen optimizada todavía supera 2 MB.");
  }

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
