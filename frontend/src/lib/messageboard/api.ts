import { apiJson } from '../api';

// How long messages stay on the board. Must match MESSAGE_TTL_SECONDS in backend/app/messageboard.py.
export const MESSAGE_TTL_SECONDS = 60;

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

export function fetchActiveMessages(): Promise<MessageBoardResponse> {
	return apiJson<MessageBoardResponse>('/api/messageboard/messages/');
}

export function postBoardMessage(text: string): Promise<BoardMessage> {
	return apiJson<BoardMessage>('/api/messageboard/messages/', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text }),
	});
}

export function fetchMessageBoardStatus(): Promise<MessageBoardStatus> {
	return apiJson<MessageBoardStatus>('/api/messageboard/status/');
}
