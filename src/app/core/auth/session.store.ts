import { Injectable, computed, signal, type Signal } from '@angular/core';

import {
  type AccountId,
  type AuthSession,
  type DemoAccount,
  findDemoAccount,
  type RoleCode
} from './authorization';

@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly writableSession = signal<AuthSession | null>(null);

  readonly session: Signal<AuthSession | null> = this.writableSession.asReadonly();
  readonly isAuthenticated = computed(() => this.session() !== null);
  readonly role = computed<RoleCode | null>(() => this.session()?.account.roleCode ?? null);
  readonly activeAccount = computed<DemoAccount | null>(() => this.session()?.account ?? null);

  signIn(accountId: AccountId | string): void {
    this.setActiveAccount(accountId);
  }

  switchAccount(accountId: AccountId | string): void {
    this.setActiveAccount(accountId);
  }

  signOut(): void {
    if (this.writableSession() === null) {
      return;
    }

    this.writableSession.set(null);
  }

  private setActiveAccount(accountId: AccountId | string): void {
    const account = findDemoAccount(accountId);
    if (account === undefined) {
      throw new RangeError(`Unknown demo account: ${String(accountId)}.`);
    }

    const previous = this.writableSession();
    if (previous?.accountId === account.id) {
      return;
    }

    this.writableSession.set(
      Object.freeze({
        accountId: account.id,
        account
      })
    );
  }
}

