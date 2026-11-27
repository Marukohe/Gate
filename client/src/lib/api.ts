export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  if (response.status === 401 && path !== '/auth') window.dispatchEvent(new Event('gate-sign-in'));
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(body?.error ?? 'Request failed');
  return body as T;
}
export const post = <T>(path: string, body: object) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
