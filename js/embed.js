import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

env.allowLocalModels = false;

let extractorPromise = null;

export function getExtractor(onProgress) {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
      progress_callback: onProgress,
    });
  }
  return extractorPromise;
}

export async function embed(text, onProgress) {
  const extractor = await getExtractor(onProgress);
  const out = await extractor(text, { pooling: 'mean', normalize: true, truncation: true });
  return out.data; // Float32Array, 384 dims, L2-normalized
}

// Vectors are L2-normalized → dot product == cosine similarity.
export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
