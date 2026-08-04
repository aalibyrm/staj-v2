import { describe, expect, it } from 'vitest';

import {
  PlatformEventBus,
  PlatformState,
  type PlatformEvent
} from './platform-state';

describe('PlatformState', () => {
  it('starts with the online idle snapshot and derives status values', () => {
    const state = new PlatformState(new PlatformEventBus());

    expect(state.state()).toEqual({ connectivity: 'online', pendingOperations: 0 });
    expect(state.isOnline()).toBe(true);
    expect(state.isBusy()).toBe(false);
  });

  it('updates immutably and emits typed events in mutation order', () => {
    const eventBus = new PlatformEventBus();
    const state = new PlatformState(eventBus);
    const events: PlatformEvent[] = [];
    const initialSnapshot = state.state();

    eventBus.events$.subscribe((event) => events.push(event));
    state.setConnectivity('reconnecting');
    const reconnectingSnapshot = state.state();
    state.setPendingOperations(2);

    expect(initialSnapshot).toEqual({ connectivity: 'online', pendingOperations: 0 });
    expect(reconnectingSnapshot).toEqual({ connectivity: 'reconnecting', pendingOperations: 0 });
    expect(state.state()).toEqual({ connectivity: 'reconnecting', pendingOperations: 2 });
    expect(reconnectingSnapshot).not.toBe(initialSnapshot);
    expect(events).toEqual([
      { type: 'connectivity-changed', connectivity: 'reconnecting' },
      { type: 'pending-operations-changed', pendingOperations: 2 }
    ]);
    expect(state.isOnline()).toBe(false);
    expect(state.isBusy()).toBe(true);
  });

  it('suppresses duplicate values without changing the snapshot or emitting', () => {
    const eventBus = new PlatformEventBus();
    const state = new PlatformState(eventBus);
    const events: PlatformEvent[] = [];
    const initialSnapshot = state.state();

    eventBus.events$.subscribe((event) => events.push(event));
    state.setConnectivity('online');
    state.setPendingOperations(0);

    expect(state.state()).toBe(initialSnapshot);
    expect(events).toEqual([]);
  });

  it('rejects invalid connectivity and pending-operation counts', () => {
    const state = new PlatformState(new PlatformEventBus());

    expect(() => state.setConnectivity('unknown' as never)).toThrow(TypeError);
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => state.setPendingOperations(value)).toThrow(TypeError);
    }
    expect(state.state()).toEqual({ connectivity: 'online', pendingOperations: 0 });
  });

  it('does not expose a writable signal', () => {
    const state = new PlatformState(new PlatformEventBus());
    const readonlySignal = state.state as unknown as { set?: unknown; update?: unknown };

    expect(readonlySignal.set).toBeUndefined();
    expect(readonlySignal.update).toBeUndefined();
  });
});
