// How long messages stay on the board. Must match MESSAGE_TTL_SECONDS in backend/app/messageboard.py.
export const MESSAGE_TTL_SECONDS = 60;

const BACKEND_BASE_URL =
	(import.meta.env.VITE_BACKEND_URL as string | undefined) ?? 'http://localhost:5000';

export interface BoardMessage {
	id: string;
	text: string;
	createdAt: string;
	expiresAt: string;
}

export interface MessageBoardResponse {
	messages: BoardMessage[];
	serverTime: string;
	retentionSeconds: number;
	totalActive: number;
}

export interface MessageBoardStatus {
	activeCount: number;
	retentionSeconds: number;
	maxMessageLength: number;
	maxMessages: number;
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

export async function fetchActiveMessages(): Promise<MessageBoardResponse> {
	const response = await fetch(`${BACKEND_BASE_URL}/api/messageboard/messages/`);
	if (!response.ok) {
		throw new Error(await readErrorMessage(response));
	}
	return parseJsonResponse<MessageBoardResponse>(response);
}

export async function postBoardMessage(text: string): Promise<BoardMessage> {
	const response = await fetch(`${BACKEND_BASE_URL}/api/messageboard/messages/`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ text }),
	});

	if (!response.ok) {
		throw new Error(await readErrorMessage(response));
	}

	return parseJsonResponse<BoardMessage>(response);
}

export async function fetchMessageBoardStatus(): Promise<MessageBoardStatus> {
	const response = await fetch(`${BACKEND_BASE_URL}/api/messageboard/status/`);
	if (!response.ok) {
		throw new Error(await readErrorMessage(response));
	}
	return parseJsonResponse<MessageBoardStatus>(response);
}
