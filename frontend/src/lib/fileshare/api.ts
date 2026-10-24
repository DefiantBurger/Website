import { apiFetch, apiJson } from '../api';

export interface FileShareStatus {
	activeFileCount: number;
	usedBytes: number;
	maxFileBytes: number;
	maxTotalBytes: number;
	retentionSeconds: number;
	uploadsPaused: boolean;
}

export interface FileShareUploadResult {
	label: string;
	originalFilename: string;
	sizeBytes: number;
	uploadedAt: string;
	expiresAt: string;
	downloadEndpoint: string;
}

export interface FileShareListItem {
	occurrenceIndex: number;
	originalFilename: string;
	sizeBytes: number;
	uploadedAt: string;
	expiresAt: string;
}

export interface FileShareListResult {
	files: FileShareListItem[];
}

function postForm(fields: Record<string, string | Blob>): RequestInit {
	const body = new FormData();
	for (const [name, value] of Object.entries(fields)) {
		body.append(name, value);
	}
	return { method: 'POST', body };
}

export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) {
		return '0 B';
	}

	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let value = bytes;
	let unitIndex = 0;

	while (value >= 1000 && unitIndex < units.length - 1) {
		value /= 1000;
		unitIndex += 1;
	}

	const precision = unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
	return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function fetchFileShareStatus(): Promise<FileShareStatus> {
	return apiJson<FileShareStatus>('/api/fileshare/status/');
}

/** Upload files one at a time; the first clears the key's existing files, so each call replaces the previous batch. */
export async function uploadFileShare(files: File[], password: string): Promise<FileShareUploadResult[]> {
	const results: FileShareUploadResult[] = [];

	for (const [index, file] of files.entries()) {
		const init = postForm({ file, password, clearExisting: index === 0 ? 'true' : 'false' });
		results.push(await apiJson<FileShareUploadResult>('/api/fileshare/upload/', init));
	}

	return results;
}

export async function downloadFileShare(
	password: string,
	occurrenceIndex: number = 1,
	expectedFilename?: string,
): Promise<{ blob: Blob; filename: string }> {
	const response = await apiFetch(
		'/api/fileshare/access/',
		postForm({ password, occurrenceIndex: occurrenceIndex.toString() }),
	);

	// Prefer the filename the caller already knows; fall back to content-disposition.
	let filename = expectedFilename;
	if (!filename) {
		const disposition = response.headers.get('content-disposition') ?? '';
		const filenameMatch = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
		filename = decodeURIComponent(filenameMatch?.[1] ?? filenameMatch?.[2] ?? 'download');
	}

	return { blob: await response.blob(), filename };
}

export function listFileShareFiles(password: string): Promise<FileShareListResult> {
	return apiJson<FileShareListResult>('/api/fileshare/list/', postForm({ password }));
}
