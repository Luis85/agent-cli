import { AsyncLocalStorage } from 'node:async_hooks';
import type { EventDeliveryScope } from '../../application/plugins/events.ts';

interface Delivery { active: boolean; parent?: Delivery }

/** A separate scope per bus tracks descendants across awaits without counting sibling deliveries. */
export class NodeEventScope implements EventDeliveryScope {
  private readonly storage = new AsyncLocalStorage<Delivery>();
  depth(): number {
    let depth = 0;
    for (let current = this.storage.getStore(); current; current = current.parent) if (current.active) depth++;
    return depth;
  }
  async run<T>(callback: () => Promise<T>): Promise<T> {
    let parent = this.storage.getStore();
    while (parent && !parent.active) parent = parent.parent;
    const delivery = { active: true, parent };
    try { return await this.storage.run(delivery, callback); }
    finally { delivery.active = false; }
  }
}
