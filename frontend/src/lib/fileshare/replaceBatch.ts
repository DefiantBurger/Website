// Replaces a key's files without a batch endpoint: each upload is its own request
// (100 MB per-request cap), so the old files are deleted only once every new one is stored.

export interface ReplaceBatchOps<F, R> {
  /** Occurrence indices the key holds before the upload. */
  listIndices(): Promise<number[]>;
  upload(file: F): Promise<R>;
  deleteIndices(indices: number[]): Promise<void>;
}

export type ReplaceBatchResult<R> =
  | { ok: true; uploaded: R[]; oldFilesRemoved: boolean }
  | {
      ok: false;
      failedFile: string;
      error: unknown;
      /** Files stored before the failure, which the rollback tried to delete. */
      uploadedCount: number;
      rolledBack: boolean;
    };

async function tryDelete<F, R>(ops: ReplaceBatchOps<F, R>, indices: number[]): Promise<boolean> {
  if (indices.length === 0) {
    return true;
  }
  try {
    await ops.deleteIndices(indices);
    return true;
  } catch {
    return false;
  }
}

/** Upload `files`, then delete the key's previous files; on a failed upload, delete the new ones instead. */
export async function replaceBatch<
  F extends { name: string },
  R extends { occurrenceIndex: number },
>(files: F[], ops: ReplaceBatchOps<F, R>): Promise<ReplaceBatchResult<R>> {
  // A failure here propagates: nothing has changed yet.
  const oldIndices = await ops.listIndices();
  const uploaded: R[] = [];

  for (const file of files) {
    try {
      uploaded.push(await ops.upload(file));
    } catch (error) {
      const rolledBack = await tryDelete(
        ops,
        uploaded.map((r) => r.occurrenceIndex),
      );
      return {
        ok: false,
        failedFile: file.name,
        error,
        uploadedCount: uploaded.length,
        rolledBack,
      };
    }
  }

  return { ok: true, uploaded, oldFilesRemoved: await tryDelete(ops, oldIndices) };
}
