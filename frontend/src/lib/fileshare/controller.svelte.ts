import { AsyncTask } from '../asyncTask.svelte';
import { errorMessage } from '../api';
import { saveBlob } from '../download';
import { formatBytes, formatMinutes } from '../format';
import { generateAccessKey } from './accessKey';
import {
  downloadFileShare,
  fetchFileShareStatus,
  listFileShareFiles,
  uploadFileShare,
  type FileShareFile,
  type FileShareStatus,
  type UploadProgress,
} from './api';
import { deriveKey, type FileShareKey } from './crypto';

/** The File Share page's state and actions, so the page itself is only layout. */
export class FileShareController {
  status = $state<FileShareStatus | null>(null);
  readonly statusTask = new AsyncTask('Failed to load storage status.');

  files = $state<File[]>([]);
  sendKey = $state('');
  /** The key Generate last filled in; shown in full while it's still the key. */
  generatedKey = $state<string | null>(null);
  readonly send = new AsyncTask('Upload failed.');
  progress = $state<UploadProgress | null>(null);

  receiveKey = $state('');
  readonly receive = new AsyncTask("Couldn't retrieve files.");
  listed = $state<FileShareFile[]>([]);
  // Downloads use the key the list came from, so editing the box afterwards doesn't break them.
  #listedKey: FileShareKey | null = null;

  readonly showGeneratedKey = $derived(
    this.generatedKey !== null && this.generatedKey === this.sendKey,
  );
  readonly statusLine = $derived.by(() => {
    const s = this.status;
    if (!s) {
      return '';
    }
    return [
      `${s.activeFileCount} active`,
      `${formatBytes(s.usedBytes)} / ${formatBytes(s.maxTotalBytes, { trim: true })} used`,
      `${formatBytes(s.maxFileBytes, { trim: true })} per file`,
      `files expire after ${formatMinutes(s.retentionSeconds)}`,
    ].join(' · ');
  });

  async loadStatus(): Promise<void> {
    await this.statusTask.run(async () => {
      this.status = await fetchFileShareStatus();
    });
  }

  setFiles(files: Iterable<File>): void {
    this.files = Array.from(files);
    this.send.reset();
  }

  async generateKey(): Promise<void> {
    try {
      this.sendKey = this.generatedKey = await generateAccessKey();
    } catch (error) {
      this.send.fail(errorMessage(error, "Couldn't generate a key."));
    }
  }

  /** Upload the selected files under `sendKey`. */
  async sendFiles(): Promise<void> {
    if (this.files.length === 0) {
      this.send.fail('Choose at least one file to upload.');
      return;
    }
    if (!this.sendKey.trim()) {
      this.send.fail('Enter an access key, or use Generate.');
      return;
    }
    // Without the status yet, skip the early check; the server still rejects with a 413.
    const maxFileBytes = this.status?.maxFileBytes ?? Infinity;
    const oversized = this.files.filter((file) => file.size > maxFileBytes).length;
    if (oversized > 0) {
      this.send.fail(
        `Files must be ${formatBytes(maxFileBytes, { trim: true })} or smaller; ${oversized} file(s) are too big.`,
      );
      return;
    }

    await this.send.run(async () => {
      const key = await deriveKey(this.sendKey);
      const result = await uploadFileShare(this.files, key, (p) => (this.progress = p));
      this.progress = null;
      if (result.ok) {
        // The key field is cleared next, so repeat the key here.
        this.send.success = `Stored ${result.uploaded.length} file(s) under ${this.sendKey.trim()}: ${result.uploaded.join(', ')}.`;
        this.files = [];
        this.sendKey = '';
        this.generatedKey = null;
      } else {
        const reason = errorMessage(result.error, 'Upload failed.');
        const outcome =
          result.uploaded.length === 0
            ? 'Nothing was replaced; the key still has its previous files.'
            : `The key's previous files were replaced; it now holds only the ${result.uploaded.length} file(s) stored before this one.`;
        this.send.error = `Upload failed on ${result.failedFile}: ${reason}\n${outcome}`;
      }
    });
    this.progress = null;
    await this.loadStatus();
  }

  async list(): Promise<void> {
    const key = this.receiveKey.trim();
    if (!key) {
      this.receive.fail('Enter the access key to retrieve files.');
      this.listed = [];
      return;
    }
    await this.receive.run(async () => {
      this.listed = []; // so a failed lookup doesn't leave the previous key's files listed
      const derived = await deriveKey(key);
      // The API answers 404 when there are none, so this list is never empty.
      this.listed = await listFileShareFiles(derived);
      this.#listedKey = derived;
      this.receive.success = `Found ${this.listed.length} file(s).`;
    });
  }

  async download(files: FileShareFile[]): Promise<void> {
    const key = this.#listedKey;
    if (files.length === 0 || !key) {
      this.receive.fail('No files available for download.');
      return;
    }
    await this.receive.run(async () => {
      const failures: string[] = [];
      for (const file of files) {
        try {
          saveBlob(await downloadFileShare(key, file), file.name);
        } catch (error) {
          failures.push(`- ${file.name}: ${errorMessage(error, 'Download failed.')}`);
        }
      }
      const succeeded = files.length - failures.length;
      if (succeeded > 0) {
        this.receive.success = `Started ${succeeded} download${succeeded === 1 ? '' : 's'}.`;
      }
      if (failures.length > 0) {
        this.receive.error = `${succeeded} succeeded, ${failures.length} failed:\n${failures.join('\n')}`;
      }
    });
  }
}
