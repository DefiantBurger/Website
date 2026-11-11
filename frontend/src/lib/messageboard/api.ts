import { apiJson } from '../api';
import type { BoardMessage } from './board';

export interface BoardLimits {
  retentionSeconds: number;
  maxMessageLength: number;
}

export interface MessageBoardResponse extends BoardLimits {
  messages: BoardMessage[];
  // When the server built the response, for timing expiry on the client.
  serverTime: string;
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
