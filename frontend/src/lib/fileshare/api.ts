import { apiFetch, apiJson, apiPostJsonWithProgress } from '../api';
import { decryptFile, decryptName, encryptFile, type FileShareKey } from './crypto';

export interface FileShareStatus {
  activeFileCount: number;
  usedBytes: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  retentionSeconds: number;
}

/** A file as the server describes it; it never sees the name. */
interface FileShareRecord {
  id: string;
  salt: string;
  encryptedName: string;
  sizeBytes: number;
  uploadedAt: string;
  expiresAt: string;
}

/** A listed file with its name decrypted. */
export interface FileShareFile {
  id: string;
  salt: string;
  name: string;
  sizeBytes: number;
  uploadedAt: string;
  expiresAt: string;
}

/** `uploaded` names the files stored before a failure; any of them means the key's earlier files are gone. */
export type UploadResult =
  | { ok: true; uploaded: string[] }
  | { ok: false; uploaded: string[]; failedFile: string; error: unknown };

/** Progress through a batch, counted in file bytes so it doesn't jump between files. */
export interface UploadProgress {
  /** Index into the uploaded files of the one being worked on. */
  fileIndex: number;
  /** `storing` means the file is fully sent and its response is pending. */
  phase: 'encrypting' | 'uploading' | 'storing';
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

/** Encrypt and upload `files` one per request (the 80 MB cap is per request); the first replaces the key's earlier files once stored. */
export async function uploadFileShare(
  files: File[],
  key: FileShareKey,
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadResult> {
  // Fail before touching the server if a selected file was moved or deleted since it was picked.
  for (const file of files) {
    await readable(file.slice(0, 1).arrayBuffer(), file.name);
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  let doneBytes = 0;
  const uploaded: string[] = [];
  for (const [fileIndex, file] of files.entries()) {
    const report = (phase: UploadProgress['phase'], fraction: number) =>
      onProgress?.({ fileIndex, phase, sentBytes: doneBytes + file.size * fraction, totalBytes });
    report('encrypting', 0);
    try {
      // Encrypting reads the whole file into memory, which also protects against browsers that
      // leave the request hanging when a disk-backed body file disappears mid-upload.
      const encrypted = await readable(encryptFile(key, file, file.name), file.name);
      const replace = uploaded.length === 0 ? '1' : undefined;
      await apiPostJsonWithProgress<FileShareRecord>('/api/fileshare/upload/', {
        body: formData({
          file: new File([encrypted.body], 'encrypted'),
          token: key.token,
          salt: encrypted.salt,
          encryptedName: encrypted.encryptedName,
          replace,
        }),
        // Scaled to the file's size, since the multipart body is a little bigger.
        onProgress: (loaded, total) => {
          if (total > 0) {
            report(loaded >= total ? 'storing' : 'uploading', loaded / total);
          }
        },
        responseTimeoutMs: UPLOAD_RESPONSE_TIMEOUT_MS,
      });
      uploaded.push(file.name);
      doneBytes += file.size;
    } catch (error) {
      return { ok: false, uploaded, failedFile: file.name, error };
    }
  }
  return { ok: true, uploaded };
}

async function readable<T>(read: Promise<T>, name: string): Promise<T> {
  try {
    return await read;
  } catch {
    throw new Error(
      `Couldn't read ${name}; it may have been moved or deleted. Choose the files again.`,
    );
  }
}

export async function downloadFileShare(key: FileShareKey, file: FileShareFile): Promise<Blob> {
  const response = await apiFetch(
    '/api/fileshare/access/',
    postForm({ token: key.token, id: file.id }),
  );
  return decryptFile(key, file.salt, await response.blob());
}

export async function listFileShareFiles(key: FileShareKey): Promise<FileShareFile[]> {
  const { files } = await apiJson<{ files: FileShareRecord[] }>(
    '/api/fileshare/list/',
    postForm({ token: key.token }),
  );
  return Promise.all(
    files.map(async ({ encryptedName, ...file }) => ({
      ...file,
      name: await decryptName(key, file.salt, encryptedName),
    })),
  );
}
