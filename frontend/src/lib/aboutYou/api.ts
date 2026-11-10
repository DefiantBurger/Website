import { apiJson } from '../api';
import type { RequestContextSnapshot } from './facts';

export type { RequestContextSnapshot };

export function loadRequestContextSnapshot(): Promise<RequestContextSnapshot> {
  return apiJson<RequestContextSnapshot>('/api/about-you/request-context/');
}
