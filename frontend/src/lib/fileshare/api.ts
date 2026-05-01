const BACKEND_BASE_URL =
	(import.meta.env.VITE_BACKEND_URL as string | undefined) ?? 'http://localhost:5000';

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

function parseJsonResponse<T>(response: Response): Promise<T> {
	return response.json() as Promise<T>;
}

async function readErrorMessage(response: Response): Promise<string> {
	const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
	if (contentType.includes('application/json')) {
		try {
			const payload = (await response.json()) as { error?: string };
			return payload.error ?? 'Request failed.';
		} catch {
			return 'Request failed.';
		}
	}

	return (await response.text()).slice(0, 160) || 'Request failed.';
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

export async function fetchFileShareStatus(): Promise<FileShareStatus> {
	const response = await fetch(`${BACKEND_BASE_URL}/api/fileshare/status/`);
	if (!response.ok) {
		throw new Error(await readErrorMessage(response));
	}

	return parseJsonResponse<FileShareStatus>(response);
}

export async function uploadFileShare(
	files: File | File[],
	password: string,
): Promise<FileShareUploadResult[]> {
	const fileArray = Array.isArray(files) ? files : [files];
	const results: FileShareUploadResult[] = [];

	for (let i = 0; i < fileArray.length; i++) {
		const file = fileArray[i];
		const isFirst = i === 0;
		const formData = new FormData();
		formData.append('file', file);
		formData.append('password', password);
		formData.append('clearExisting', isFirst ? 'true' : 'false');

		const response = await fetch(`${BACKEND_BASE_URL}/api/fileshare/upload/`, {
			method: 'POST',
			body: formData,
		});

		if (!response.ok) {
			throw new Error(await readErrorMessage(response));
		}

		const result = await parseJsonResponse<FileShareUploadResult>(response);
		results.push(result);
	}

	return results;
}

export async function downloadFileShare(
	password: string,
	occurrenceIndex: number = 1,
	expectedFilename?: string,
): Promise<{ blob: Blob; filename: string }> {
	const formData = new FormData();
	formData.append('password', password);
	formData.append('occurrenceIndex', occurrenceIndex.toString());

	const response = await fetch(`${BACKEND_BASE_URL}/api/fileshare/access/`, {
		method: 'POST',
		body: formData,
	});

	if (!response.ok) {
		throw new Error(await readErrorMessage(response));
	}

	// If we have the filename from the caller, use it directly
	// Otherwise try to extract from content-disposition header as fallback
	let filename = expectedFilename ?? 'download';
	
	if (!expectedFilename) {
		const disposition = response.headers.get('content-disposition') ?? '';
		const filenameMatch = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
		filename = filenameMatch?.[1] ?? filenameMatch?.[2] ?? 'download';
	}

	return {
		blob: await response.blob(),
		filename: decodeURIComponent(filename),
	};
}

export async function listFileShareFiles(password: string): Promise<FileShareListResult> {
	const formData = new FormData();
	formData.append('password', password);

	const response = await fetch(`${BACKEND_BASE_URL}/api/fileshare/list/`, {
		method: 'POST',
		body: formData,
	});

	if (!response.ok) {
		throw new Error(await readErrorMessage(response));
	}

	return parseJsonResponse<FileShareListResult>(response);
}