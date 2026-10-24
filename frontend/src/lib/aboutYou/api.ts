import { apiJson } from '../api';

export type RequestContextSnapshot = {
  timestamp: string;
  request: {
    method: string;
    path: string;
  };
  network: {
    clientIp: string;
    clientIpMasked: string;
    ipSource: string;
    hasForwardedHeaders: boolean;
  };
  geolocation: {
    available: boolean;
    reason?: string;
    provider?: string;
    country?: string;
    region?: string;
    city?: string;
    postal?: string;
    timezone?: string;
    latitude?: number | null;
    longitude?: number | null;
  };
  headers: {
    userAgent: string;
    acceptLanguage: string;
    referer: string;
    doNotTrack: string;
  };
};

export function loadRequestContextSnapshot(): Promise<RequestContextSnapshot> {
  return apiJson<RequestContextSnapshot>('/api/about-you/request-context/');
}
