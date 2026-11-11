import { ApiError, apiFetch, apiJson } from '../api';
import { replaceBatch, type ReplaceBatchResult } from './replaceBatch';

export interface FileShareStatus {
  activeFileCount: number;
  usedBytes: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  retentionSeconds: number;
}

export interface FileShareRecord {
  occurrenceIndex: number;
  originalFilename: string;
  sizeBytes: number;
  uploadedAt: string;
  expiresAt: string;
}

export interface FileShareListResult {
  files: FileShareRecord[];
}

function postForm(fields: Record<string, string | Blob>): RequestInit {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    body.append(name, value);
  }
  return { method: 'POST', body };
}

export function fetchFileShareStatus(): Promise<FileShareStatus> {
  return apiJson<FileShareStatus>('/api/fileshare/status/');
}

/** Replace the key's files with `files`, keeping the old ones if any upload fails. */
export async function uploadFileShare(
  files: File[],
  password: string,
): Promise<ReplaceBatchResult<FileShareRecord>> {
  // Fail before touching the server if a selected file was moved or deleted since it was picked.
  for (const file of files) {
    await readFile(file.slice(0, 1), file.name);
  }

  return replaceBatch(files, {
    listIndices: async () => {
      try {
        return (await listFileShareFiles(password)).files.map((f) => f.occurrenceIndex);
      } catch (error) {
        // The list endpoint answers 404 when the key has no files.
        if (error instanceof ApiError && error.status === 404) {
          return [];
        }
        throw error;
      }
    },
    upload: async (file) => {
      // Send an in-memory copy: some browsers leave the fetch hanging forever when a
      // disk-backed body file disappears, which would skip the rollback.
      const copy = new File([await readFile(file, file.name)], file.name, { type: file.type });
      // No timeout: the server only answers once the whole body has arrived, which can take minutes.
      return apiJson<FileShareRecord>('/api/fileshare/upload/', {
        ...postForm({ file: copy, password }),
        timeoutMs: null,
      });
    },
    deleteIndices: (indices) => deleteFileShareFiles(password, indices),
  });
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

export async function deleteFileShareFiles(password: string, indices: number[]): Promise<void> {
  await apiFetch(
    '/api/fileshare/delete/',
    postForm({ password, occurrenceIndices: indices.join(',') }),
  );
}

export async function downloadFileShare(password: string, occurrenceIndex: number): Promise<Blob> {
  const response = await apiFetch(
    '/api/fileshare/access/',
    postForm({ password, occurrenceIndex: occurrenceIndex.toString() }),
  );
  return response.blob();
}

export function listFileShareFiles(password: string): Promise<FileShareListResult> {
  return apiJson<FileShareListResult>('/api/fileshare/list/', postForm({ password }));
}
