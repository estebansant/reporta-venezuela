// Pre/post satellite change detection primitives.
// Algorithm: score = 0.4*(1-SSIM) + 0.3*|ΔNDVI| + 0.3*|ΔNDBI|
// NDVI = (NIR - Red) / (NIR + Red)   [B08, B04 in Sentinel-2, 10 m]
// NDBI = (SWIR - NIR) / (SWIR + NIR) [B11, B08 in Sentinel-2, 20 m upsampled]
// Building collapse shows: SSIM drop + NDVI drop + NDBI shift.

export interface BandWindow {
  red: Float32Array;   // B04, 10 m — raw DN (divide by 10 000 to get reflectance)
  nir: Float32Array;   // B08, 10 m
  swir: Float32Array;  // B11, 20 m — same pixel count as nir (upsampled 2×2 NN)
  width: number;
  height: number;
}

export interface CellScore {
  score: number;
  ssim: number;
  deltaNdvi: number;
  deltaNdbi: number;
}

export function computeNDVI(red: Float32Array, nir: Float32Array): Float32Array {
  const out = new Float32Array(red.length);
  for (let i = 0; i < red.length; i++) {
    const r = red[i] / 10_000;
    const n = nir[i] / 10_000;
    const denom = n + r;
    out[i] = denom === 0 ? 0 : (n - r) / denom;
  }
  return out;
}

export function computeNDBI(nir: Float32Array, swir: Float32Array): Float32Array {
  const out = new Float32Array(nir.length);
  for (let i = 0; i < nir.length; i++) {
    const n = nir[i] / 10_000;
    const s = swir[i] / 10_000;
    const denom = s + n;
    out[i] = denom === 0 ? 0 : (s - n) / denom;
  }
  return out;
}

// Upsample a 20 m band to match a 10 m band (nearest-neighbor, 2× in each axis).
export function upsample2x(src: Float32Array, srcW: number, srcH: number): Float32Array {
  const dstW = srcW * 2;
  const dstH = srcH * 2;
  const dst = new Float32Array(dstW * dstH);
  for (let sy = 0; sy < srcH; sy++) {
    for (let sx = 0; sx < srcW; sx++) {
      const v = src[sy * srcW + sx];
      dst[(sy * 2) * dstW + sx * 2] = v;
      dst[(sy * 2) * dstW + sx * 2 + 1] = v;
      dst[(sy * 2 + 1) * dstW + sx * 2] = v;
      dst[(sy * 2 + 1) * dstW + sx * 2 + 1] = v;
    }
  }
  return dst;
}

// Block-based SSIM on a 2-D window (values expected in [0, 1]).
export function computeSSIM(
  a: Float32Array,
  b: Float32Array,
  width: number,
  height: number,
  blockSize = 8,
): number {
  const C1 = 0.01 ** 2;
  const C2 = 0.03 ** 2;
  let total = 0;
  let count = 0;

  for (let y = 0; y + blockSize <= height; y += blockSize) {
    for (let x = 0; x + blockSize <= width; x += blockSize) {
      let sA = 0, sB = 0, sA2 = 0, sB2 = 0, sAB = 0;
      const n = blockSize * blockSize;
      for (let dy = 0; dy < blockSize; dy++) {
        for (let dx = 0; dx < blockSize; dx++) {
          const i = (y + dy) * width + (x + dx);
          const va = a[i];
          const vb = b[i];
          sA += va; sB += vb; sA2 += va * va; sB2 += vb * vb; sAB += va * vb;
        }
      }
      const mA = sA / n;
      const mB = sB / n;
      const varA = sA2 / n - mA * mA;
      const varB = sB2 / n - mB * mB;
      const cov = sAB / n - mA * mB;
      const num = (2 * mA * mB + C1) * (2 * cov + C2);
      const den = (mA * mA + mB * mB + C1) * (varA + varB + C2);
      total += num / den;
      count++;
    }
  }

  return count === 0 ? 1 : Math.min(1, Math.max(0, total / count));
}

// Score a rectangular cell [r0,r1) × [c0,c1) within BandWindow pairs.
export function scoreCell(
  pre: BandWindow,
  post: BandWindow,
  r0: number,
  c0: number,
  r1: number,
  c1: number,
): CellScore {
  const cellW = c1 - c0;
  const cellH = r1 - r0;
  const n = cellW * cellH;

  const preNirW = new Float32Array(n);
  const preRedW = new Float32Array(n);
  const preSwirW = new Float32Array(n);
  const postNirW = new Float32Array(n);
  const postRedW = new Float32Array(n);
  const postSwirW = new Float32Array(n);

  let idx = 0;
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const pi = r * pre.width + c;
      preRedW[idx] = pre.red[pi];
      preNirW[idx] = pre.nir[pi];
      preSwirW[idx] = pre.swir[pi];
      postRedW[idx] = post.red[pi];
      postNirW[idx] = post.nir[pi];
      postSwirW[idx] = post.swir[pi];
      idx++;
    }
  }

  const preNdvi = computeNDVI(preRedW, preNirW);
  const postNdvi = computeNDVI(postRedW, postNirW);
  const preNdbi = computeNDBI(preNirW, preSwirW);
  const postNdbi = computeNDBI(postNirW, postSwirW);

  let sumDeltaNdvi = 0;
  let sumDeltaNdbi = 0;
  for (let i = 0; i < n; i++) {
    sumDeltaNdvi += Math.abs(postNdvi[i] - preNdvi[i]);
    sumDeltaNdbi += Math.abs(postNdbi[i] - preNdbi[i]);
  }
  const deltaNdvi = sumDeltaNdvi / n;
  const deltaNdbi = sumDeltaNdbi / n;

  // SSIM on NIR reflectance [0,1]
  const preNirRef = preNirW.map((v) => v / 10_000);
  const postNirRef = postNirW.map((v) => v / 10_000);
  const ssim = computeSSIM(
    new Float32Array(preNirRef),
    new Float32Array(postNirRef),
    cellW,
    cellH,
  );

  const score = Math.min(1, Math.max(0, 0.4 * (1 - ssim) + 0.3 * deltaNdvi + 0.3 * deltaNdbi));
  return { score, ssim, deltaNdvi, deltaNdbi };
}
