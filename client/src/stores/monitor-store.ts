import { create } from 'zustand';
import { api } from '@/lib/api';
import type { MonitorServer } from '../../../server/src/types';

export const useMonitorStore = create<{
  servers: MonitorServer[] | null; error: string; refresh: () => Promise<void>;
}>((set) => {
  let pending: Promise<void> | undefined;
  return { servers: null, error: '', refresh: () => {
    if (pending) return pending;
    pending = api<{ servers: MonitorServer[] }>('/monitor')
      .then((result) => { set({ servers: result.servers, error: '' }); })
      .catch((error: Error) => { set({ error: error.message }); })
      .finally(() => { pending = undefined; });
    return pending;
  } };
});
