export const STORAGE_UNAVAILABLE_CODE = 'STORAGE_UNAVAILABLE' as const;
export type StorageUnavailableCode = typeof STORAGE_UNAVAILABLE_CODE;

export class StorageUnavailableError extends Error {
  readonly code: StorageUnavailableCode = STORAGE_UNAVAILABLE_CODE;

  constructor(message = 'The requested storage is unavailable.') {
    super(message);
    this.name = 'StorageUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface StorageAdapter<TValue = unknown> {
  read(key: string): Promise<TValue | undefined>;
  write(key: string, value: TValue): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface IndexedDbStorageOptions {
  readonly databaseName?: string;
  readonly storeName?: string;
  readonly version?: number;
  readonly indexedDBFactory?: IDBFactory;
}

export type StorageMode = 'primary' | 'fallback';

const DEFAULT_DATABASE_NAME = 'platform-storage';
const DEFAULT_STORE_NAME = 'values';
const DEFAULT_DATABASE_VERSION = 1;

const assertNonEmptyKey: (key: unknown) => asserts key is string = (key: unknown) => {
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new TypeError('Storage keys must be non-empty strings.');
  }
};

const assertNonEmptyName: (name: unknown, label: string) => asserts name is string = (
  name: unknown,
  label: string
) => {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
};

const assertVersion: (version: unknown) => asserts version is number = (version: unknown) => {
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new TypeError('IndexedDB version must be a positive integer.');
  }
};

const cloneStructuredValue = <TValue>(value: TValue): TValue => {
  if (typeof structuredClone !== 'function') {
    throw new StorageUnavailableError('structuredClone is unavailable in this runtime.');
  }
  return structuredClone(value);
};

const isProgrammerError = (error: unknown): boolean => {
  if (error instanceof TypeError || error instanceof RangeError || error instanceof SyntaxError) {
    return true;
  }

  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return ['DataCloneError', 'SyntaxError', 'TypeMismatchError'].includes(error.name);
  }

  return false;
};

const isOperationalFailure = (error: unknown): boolean => !isProgrammerError(error);

export class InMemoryStorageAdapter<TValue = unknown> implements StorageAdapter<TValue> {
  private readonly values = new Map<string, TValue>();

  read(key: string): Promise<TValue | undefined> {
    assertNonEmptyKey(key);
    if (!this.values.has(key)) {
      return Promise.resolve(undefined);
    }

    return Promise.resolve(cloneStructuredValue(this.values.get(key) as TValue));
  }

  write(key: string, value: TValue): Promise<void> {
    assertNonEmptyKey(key);
    const isolatedValue = cloneStructuredValue(value);
    this.values.set(key, isolatedValue);
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    assertNonEmptyKey(key);
    this.values.delete(key);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.values.clear();
    return Promise.resolve();
  }
}

export class IndexedDbStorageAdapter<TValue = unknown> implements StorageAdapter<TValue> {
  private readonly databaseName: string;
  private readonly storeName: string;
  private readonly version: number;
  private readonly indexedDBFactory: IDBFactory | undefined;
  private databasePromise: Promise<IDBDatabase> | undefined;

  constructor(options: IndexedDbStorageOptions = {}) {
    const databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
    const storeName = options.storeName ?? DEFAULT_STORE_NAME;
    const version = options.version ?? DEFAULT_DATABASE_VERSION;

    assertNonEmptyName(databaseName, 'databaseName');
    assertNonEmptyName(storeName, 'storeName');
    assertVersion(version);

    this.databaseName = databaseName;
    this.storeName = storeName;
    this.version = version;
    this.indexedDBFactory =
      'indexedDBFactory' in options
        ? options.indexedDBFactory
        : typeof indexedDB === 'undefined'
          ? undefined
          : indexedDB;
  }

  read(key: string): Promise<TValue | undefined> {
    assertNonEmptyKey(key);
    return this.runTransaction('readonly', (store) => {
      const request = store.get(key);
      return {
        request,
        readResult: (result: unknown) =>
          result === undefined ? undefined : cloneStructuredValue(result as TValue)
      };
    });
  }

  write(key: string, value: TValue): Promise<void> {
    assertNonEmptyKey(key);
    const isolatedValue = cloneStructuredValue(value);
    return this.runTransaction('readwrite', (store) => {
      const request = store.put(isolatedValue, key);
      return { request };
    }).then(() => undefined);
  }


  remove(key: string): Promise<void> {
    assertNonEmptyKey(key);
    return this.runTransaction('readwrite', (store) => {
      const request = store.delete(key);
      return { request };
    }).then(() => undefined);
  }

  clear(): Promise<void> {
    return this.runTransaction('readwrite', (store) => {
      const request = store.clear();
      return { request };
    }).then(() => undefined);
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.databasePromise !== undefined) {
      return this.databasePromise;
    }

    if (this.indexedDBFactory === undefined) {
      this.databasePromise = Promise.reject(
        new StorageUnavailableError('IndexedDB is unavailable in this runtime.')
      );
      return this.databasePromise;
    }

    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = this.indexedDBFactory!.open(this.databaseName, this.version);
      } catch (error: unknown) {
        reject(error);
        return;
      }

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.storeName)) {
          database.createObjectStore(this.storeName);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new StorageUnavailableError('IndexedDB failed to open.'));
      request.onblocked = () =>
        reject(new StorageUnavailableError('IndexedDB opening was blocked.'));
    });

    return this.databasePromise;
  }

  private runTransaction<TResult extends TValue | undefined = TValue | undefined>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => {
      readonly request: IDBRequest;
      readonly readResult?: (result: unknown) => TResult;
    }
  ): Promise<TResult> {
    return this.openDatabase().then(
      (database) =>
        new Promise<TResult>((resolve, reject) => {
          let transaction: IDBTransaction;
          let operationResult: { readonly request: IDBRequest; readonly readResult?: (result: unknown) => TResult };
          let requestResult: TResult | undefined;
          let requestCompleted = false;
          let transactionCompleted = false;
          let failed = false;

          const fail = (error: unknown): void => {
            if (failed) {
              return;
            }
            failed = true;
            reject(error);
          };

          try {
            transaction = database.transaction(this.storeName, mode);
            operationResult = operation(transaction.objectStore(this.storeName));
          } catch (error: unknown) {
            fail(error);
            return;
          }

          operationResult.request.onsuccess = () => {
            requestCompleted = true;
            try {
              requestResult = operationResult.readResult
                ? operationResult.readResult(operationResult.request.result)
                : (undefined as TResult);
            } catch (error: unknown) {
              fail(error);
            }
            if (transactionCompleted && !failed) {
              resolve(requestResult as TResult);
            }
          };
          operationResult.request.onerror = () => {
            fail(
              operationResult.request.error ??
                new StorageUnavailableError('IndexedDB request failed.')
            );
          };
          transaction.oncomplete = () => {
            transactionCompleted = true;
            if (requestCompleted && !failed) {
              resolve(requestResult as TResult);
            }
          };
          transaction.onerror = () =>
            fail(transaction.error ?? new StorageUnavailableError('IndexedDB transaction failed.'));
          transaction.onabort = () =>
            fail(transaction.error ?? new StorageUnavailableError('IndexedDB transaction aborted.'));
        })
    );
  }
}

export class FallbackStorageAdapter<TValue = unknown> implements StorageAdapter<TValue> {
  private currentMode: StorageMode = 'primary';

  constructor(
    private readonly primary: StorageAdapter<TValue>,
    private readonly fallback: StorageAdapter<TValue>
  ) {
    if (primary === null || typeof primary !== 'object') {
      throw new TypeError('A primary storage adapter is required.');
    }
    if (fallback === null || typeof fallback !== 'object') {
      throw new TypeError('A fallback storage adapter is required.');
    }
  }

  get mode(): StorageMode {
    return this.currentMode;
  }

  read(key: string): Promise<TValue | undefined> {
    assertNonEmptyKey(key);
    if (this.currentMode === 'fallback') {
      return this.fallback.read(key);
    }

    return Promise.resolve()
      .then(() => this.primary.read(key))
      .then(
        async (value) => {
          if (value === undefined) {
            await this.fallback.remove(key);
          } else {
            await this.fallback.write(key, value);
          }
          return value;
        },
        async (error: unknown) => {
          if (!isOperationalFailure(error)) {
            throw error;
          }
          this.currentMode = 'fallback';
          return this.fallback.read(key);
        }
      );
  }

  write(key: string, value: TValue): Promise<void> {
    assertNonEmptyKey(key);
    if (this.currentMode === 'fallback') {
      return this.fallback.write(key, value);
    }

    return Promise.resolve()
      .then(() => this.primary.write(key, value))
      .then(
        () => this.fallback.write(key, value),
        (error: unknown) => {
          if (!isOperationalFailure(error)) {
            throw error;
          }
          this.currentMode = 'fallback';
          return this.fallback.write(key, value);
        }
      );
  }


  remove(key: string): Promise<void> {
    assertNonEmptyKey(key);
    if (this.currentMode === 'fallback') {
      return this.fallback.remove(key);
    }

    return Promise.resolve()
      .then(() => this.primary.remove(key))
      .then(
        () => this.fallback.remove(key),
        (error: unknown) => {
          if (!isOperationalFailure(error)) {
            throw error;
          }
          this.currentMode = 'fallback';
          return this.fallback.remove(key);
        }
      );
  }

  clear(): Promise<void> {
    if (this.currentMode === 'fallback') {
      return this.fallback.clear();
    }

    return Promise.resolve()
      .then(() => this.primary.clear())
      .then(
        () => this.fallback.clear(),
        (error: unknown) => {
          if (!isOperationalFailure(error)) {
            throw error;
          }
          this.currentMode = 'fallback';
          return this.fallback.clear();
        }
      );
  }
}

export function createBrowserStorageAdapter<TValue = unknown>(
  options: IndexedDbStorageOptions = {}
): FallbackStorageAdapter<TValue> {
  return new FallbackStorageAdapter<TValue>(
    new IndexedDbStorageAdapter<TValue>(options),
    new InMemoryStorageAdapter<TValue>()
  );
}
