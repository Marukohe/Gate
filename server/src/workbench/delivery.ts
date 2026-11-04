import type { DeliveryRequest } from './types.js';

export function deliveryRequest(value: unknown): DeliveryRequest {
  if (!value || typeof value !== 'object') throw new Error('Inspect a delivery preview first');
  const input = value as DeliveryRequest;
  const text = (value: unknown, name: string, empty = false) => {
    if (typeof value !== 'string' || (!empty && !value.trim()) || value.includes('\0') || value.length > 100_000) {
      throw new Error(`Invalid ${name}`);
    }
    return value;
  };
  if (!['commit', 'push', 'create-pr'].includes(input.action)) throw new Error('Choose commit, push, or create-pr');
  if (!input.snapshot || !/^[a-f0-9]{40,64}$/.test(input.snapshot.head) ||
    !/^[a-f0-9]{40,64}$/.test(input.snapshot.tree) || typeof input.snapshot.dirty !== 'boolean') throw new Error('Invalid code snapshot');
  const remote = input.remote;
  if (remote !== null && (!remote || remote.name !== 'origin' || !/^[a-f0-9]{64}$/.test(remote.fingerprint))) {
    throw new Error('Invalid origin preview');
  }
  return { action: input.action, checkoutId: text(input.checkoutId, 'checkout'), branch: text(input.branch, 'branch'),
    snapshot: { head: input.snapshot.head, tree: input.snapshot.tree, dirty: input.snapshot.dirty },
    remote: remote ? { name: 'origin', display: text(remote.display, 'origin'), fingerprint: remote.fingerprint } : null,
    ...(input.action === 'commit' ? { message: text(input.message, 'commit message') } : {}),
    ...(input.action === 'create-pr' ? { title: text(input.title, 'PR title'), body: text(input.body, 'PR body', true),
      base: text(input.base, 'PR base') } : {}),
  };
}
