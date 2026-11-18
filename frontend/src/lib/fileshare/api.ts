import { apiFetch, apiJson } from '../api';

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

/** A POST with `fields` as multipart form data; undefined fields are left out. */
function postForm(fields: Record<string, string | Blob | undefined>): RequestInit {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) {
      body.append(name, value);
    }
  }
  return { method: 'POST', body };
}

export function fetchFileShareStatus(): Promise<FileShareStatus> {
  return apiJson<FileShareStatus>('/api/fileshare/status/');
}

/** Upload `files` one per request (the 80 MB cap is per request); the first replaces the key's earlier files once stored. */
export async function uploadFileShare(files: File[], password: string): Promise<UploadResult> {
  // Fail before touching the server if a selected file was moved or deleted since it was picked.
  for (const file of files) {
    await readFile(file.slice(0, 1), file.name);
  }

  const uploaded: FileShareRecord[] = [];
  for (const file of files) {
    try {
      // Send an in-memory copy: some browsers leave the fetch hanging forever when a
      // disk-backed body file disappears, which would never report the failure.
      const copy = new File([await readFile(file, file.name)], file.name, { type: file.type });
      const replace = uploaded.length === 0 ? '1' : undefined;
      // No timeout: the server only answers once the whole body has arrived, which can take minutes.
      uploaded.push(
        await apiJson<FileShareRecord>('/api/fileshare/upload/', {
          ...postForm({ file: copy, password, replace }),
          timeoutMs: null,
        }),
      );
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
