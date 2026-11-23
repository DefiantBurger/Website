import { apiFetch, apiJson, apiPostJsonWithProgress } from '../api';

export interface FileShareStatus {
  activeFileCount: number;
  usedBytes: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  retentionSeconds: number;
}

export interface FileShareRecord {
  id: string;
  originalFilename: string;
  sizeBytes: number;
  uploadedAt: string;
  expiresAt: string;
}

/** `uploaded` holds the files stored before a failure; any of them means the key's earlier files are gone. */
export type UploadResult =
  | { ok: true; uploaded: FileShareRecord[] }
  | { ok: false; uploaded: FileShareRecord[]; failedFile: string; error: unknown };

/** Progress through a batch, counted in file bytes so it doesn't jump between files. */
export interface UploadProgress {
  /** Index into the uploaded files of the one being sent. */
  fileIndex: number;
  /** Whether that file is fully sent and its response is pending. */
  fileSent: boolean;
  sentBytes: number;
  totalBytes: number;
}

// Nginx and Cloudflare buffer the body before Flask stores it, so the response can lag the last byte.
const UPLOAD_RESPONSE_TIMEOUT_MS = 60_000;

/** `fields` as multipart form data; undefined fields are left out. */
function formData(fields: Record<string, string | Blob | undefined>): FormData {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) {
      body.append(name, value);
    }
  }
  return body;
}

function postForm(fields: Record<string, string | Blob | undefined>): RequestInit {
  return { method: 'POST', body: formData(fields) };
}

export function fetchFileShareStatus(): Promise<FileShareStatus> {
  return apiJson<FileShareStatus>('/api/fileshare/status/');
}

/** Upload `files` one per request (the 80 MB cap is per request); the first replaces the key's earlier files once stored. */
export async function uploadFileShare(
  files: File[],
  password: string,
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadResult> {
  // Fail before touching the server if a selected file was moved or deleted since it was picked.
  for (const file of files) {
    await readFile(file.slice(0, 1), file.name);
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  let doneBytes = 0;
  const uploaded: FileShareRecord[] = [];
  for (const [fileIndex, file] of files.entries()) {
    const report = (fraction: number) =>
      onProgress?.({
        fileIndex,
        fileSent: fraction >= 1,
        sentBytes: doneBytes + file.size * fraction,
        totalBytes,
      });
    report(0);
    try {
      // Send an in-memory copy: some browsers leave the request hanging when a disk-backed
      // body file disappears, which would only surface as a stall instead of the real cause.
      const copy = new File([await readFile(file, file.name)], file.name, { type: file.type });
      const replace = uploaded.length === 0 ? '1' : undefined;
      uploaded.push(
        await apiPostJsonWithProgress<FileShareRecord>('/api/fileshare/upload/', {
          body: formData({ file: copy, password, replace }),
          // Scaled to the file's size, since the multipart body is a little bigger.
          onProgress: (loaded, total) => {
            if (total > 0) {
              report(loaded / total);
            }
          },
          responseTimeoutMs: UPLOAD_RESPONSE_TIMEOUT_MS,
        }),
      );
      doneBytes += file.size;
    } catch (error) {
      return { ok: false, uploaded, failedFile: file.name, error };
    }
  }
  return { ok: true, uploaded };
}

async function readFile(blob: Blob, name: string): Promise<ArrayBuffer> {
  try {
    return await blob.arrayBuffer();
  } catch {
    throw new Error(
      `Couldn't read ${name}; it may have been moved or deleted. Choose the files again.`,
    );
  }
}

export async function downloadFileShare(password: string, id: string): Promise<Blob> {
  const response = await apiFetch('/api/fileshare/access/', postForm({ password, id }));
  return response.blob();
}

export function listFileShareFiles(password: string): Promise<{ files: FileShareRecord[] }> {
  return apiJson<{ files: FileShareRecord[] }>('/api/fileshare/list/', postForm({ password }));
}
