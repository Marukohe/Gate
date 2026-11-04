import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkbenchSnapshot } from '../../../../server/src/workbench/types';

export async function workbenchRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/workbench${path}`, {
    method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Request failed');
  return result as T;
}

export function useWorkbench() {
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    try {
      const next = await workbenchRequest<WorkbenchSnapshot>('');
      if (generation.current === version) { setSnapshot(next); setError(null); }
    } catch (error) {
      if (generation.current === version) setError((error as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => { clearInterval(timer); generation.current++; };
  }, [refresh]);
  const mutate = useCallback(async <T,>(path: string, method: string, body?: unknown): Promise<T> => {
    setBusy(true);
    try {
      const result = await workbenchRequest<T>(path, method, body);
      await refresh();
      return result;
    } finally { setBusy(false); }
  }, [refresh]);
  return { snapshot, error, busy, refresh, mutate };
}

export type WorkbenchActions = Pick<ReturnType<typeof useWorkbench>, 'mutate' | 'busy'>;
