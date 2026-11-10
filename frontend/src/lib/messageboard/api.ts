import { apiJson } from '../api';

export interface BoardMessage {
  id: string;
  text: string;
  createdAt: string;
  expiresAt: string;
}

export interface MessageBoardResponse {
  messages: BoardMessage[];
  retentionSeconds: number;
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
