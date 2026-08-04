import { Injectable, computed, signal, type Signal } from '@angular/core';
import { Subject, type Observable } from 'rxjs';

export const PLATFORM_CONNECTIVITY = ['online', 'offline', 'reconnecting'] as const;
export type PlatformConnectivity = (typeof PLATFORM_CONNECTIVITY)[number];

export interface PlatformSnapshot {
  readonly connectivity: PlatformConnectivity;
  readonly pendingOperations: number;
}

export type PlatformEvent =
  | {
      readonly type: 'connectivity-changed';
      readonly connectivity: PlatformConnectivity;
    }
  | {
      readonly type: 'pending-operations-changed';
      readonly pendingOperations: number;
    };

const INITIAL_PLATFORM_SNAPSHOT: PlatformSnapshot = Object.freeze({
  connectivity: 'online',
  pendingOperations: 0
});

const isPlatformConnectivity = (value: unknown): value is PlatformConnectivity =>
  typeof value === 'string' &&
  (PLATFORM_CONNECTIVITY as readonly string[]).includes(value);

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const immutableSnapshot = (snapshot: PlatformSnapshot): PlatformSnapshot =>
  Object.freeze({
    connectivity: snapshot.connectivity,
    pendingOperations: snapshot.pendingOperations
  });

@Injectable({ providedIn: 'root' })
export class PlatformEventBus {
  private readonly eventSubject = new Subject<PlatformEvent>();

  readonly events$: Observable<PlatformEvent> = this.eventSubject.asObservable();

  emit(event: PlatformEvent): void {
    if (event === null || typeof event !== 'object') {
      throw new TypeError('Platform event must be an object.');
    }
    this.eventSubject.next(event);
  }
}

@Injectable({ providedIn: 'root' })
export class PlatformState {
  private readonly writableState = signal<PlatformSnapshot>(INITIAL_PLATFORM_SNAPSHOT);

  readonly state: Signal<PlatformSnapshot> = this.writableState.asReadonly();
  readonly isOnline = computed(() => this.state().connectivity === 'online');
  readonly isBusy = computed(() => this.state().pendingOperations > 0);

  constructor(private readonly eventBus: PlatformEventBus) {}

  setConnectivity(connectivity: PlatformConnectivity): void {
    if (!isPlatformConnectivity(connectivity)) {
      throw new TypeError(`Unsupported platform connectivity: ${String(connectivity)}.`);
    }

    const previous = this.writableState();
    if (previous.connectivity === connectivity) {
      return;
    }

    this.writableState.set(
      immutableSnapshot({
        connectivity,
        pendingOperations: previous.pendingOperations
      })
    );
    this.eventBus.emit({ type: 'connectivity-changed', connectivity });
  }

  setPendingOperations(pendingOperations: number): void {
    if (!isNonNegativeInteger(pendingOperations)) {
      throw new TypeError('pendingOperations must be a non-negative integer.');
    }

    const previous = this.writableState();
    if (previous.pendingOperations === pendingOperations) {
      return;
    }

    this.writableState.set(
      immutableSnapshot({
        connectivity: previous.connectivity,
        pendingOperations
      })
    );
    this.eventBus.emit({ type: 'pending-operations-changed', pendingOperations });
  }
}
