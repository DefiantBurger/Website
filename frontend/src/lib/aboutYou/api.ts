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
    asn?: string;
    org?: string;
  };
  headers: {
    userAgent: string;
    acceptLanguage: string;
    referer: string;
    doNotTrack: string;
  };
};

const BACKEND_BASE_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? 'http://localhost:5000';

export async function loadRequestContextSnapshot(): Promise<RequestContextSnapshot> {
  const response = await fetch(`${BACKEND_BASE_URL}/api/about-you/request-context/`);
  if (!response.ok) {
    throw new Error('Failed to load request context snapshot.');
  }

  return (await response.json()) as RequestContextSnapshot;
}
