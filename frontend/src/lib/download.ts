/** Hand a blob to the browser as a file download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Firefox and Safari can fail the download if the URL is revoked before it starts.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
