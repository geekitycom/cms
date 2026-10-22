/** A file's size as a person reads it: `8 bytes`, `920 KB`, `1.8 MB`. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} ${bytes === 1 ? 'byte' : 'bytes'}`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
