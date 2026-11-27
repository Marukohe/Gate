import { create } from 'zustand';
import { api } from '@/lib/api';
import type { GatewayStatus, MonitorServer } from '../../../server/src/types';

export const useMonitorStore = create<{
  servers: MonitorServer[] | null; gateways: GatewayStatus[]; error: string; refresh: () => Promise<void>;
}>((set) => {
  let pending: Promise<void> | undefined;
  return { servers: null, gateways: [], error: '', refresh: () => {
    if (pending) return pending;
    pending = api<{ servers: MonitorServer[]; gateways?: GatewayStatus[] }>('/monitor')
      .then((result) => { set({ servers: result.servers, gateways: result.gateways ?? [], error: '' }); })
      .catch((error: Error) => { set({ error: error.message }); })
      .finally(() => { pending = undefined; });
    return pending;
  } };
});
