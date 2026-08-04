import { describe, expect, it, vi } from 'vitest';

import {
  FallbackStorageAdapter,
  InMemoryStorageAdapter,
  IndexedDbStorageAdapter,
  StorageUnavailableError,
  createBrowserStorageAdapter,
  type StorageAdapter
} from './storage-adapter';

describe('InMemoryStorageAdapter', () => {
  it('provides isolated structured-clone CRUD operations', async () => {
    const adapter = new InMemoryStorageAdapter<{ nested: { count: number } }>();
    const input = { nested: { count: 1 } };

    await adapter.write('item', input);
    input.nested.count = 2;
    const firstRead = await adapter.read('item');
    firstRead!.nested.count = 3;

    expect(await adapter.read('item')).toEqual({ nested: { count: 1 } });
    await adapter.remove('item');
    expect(await adapter.read('item')).toBeUndefined();

    await adapter.write('first', { nested: { count: 4 } });
    await adapter.write('second', { nested: { count: 5 } });
    await adapter.clear();
    expect(await adapter.read('first')).toBeUndefined();
    expect(await adapter.read('second')).toBeUndefined();
  });

  it('rejects empty keys without sharing state between instances', async () => {
    const first = new InMemoryStorageAdapter<number>();
    const second = new InMemoryStorageAdapter<number>();

    expect(() => first.read('   ')).toThrow(TypeError);
    await first.write('value', 1);
    expect(await second.read('value')).toBeUndefined();
  });
});

describe('FallbackStorageAdapter', () => {
  it('mirrors successful primary writes and healthy reads to the fallback', async () => {
    const primary = new InMemoryStorageAdapter<{ value: string }>();
    const fallback = new InMemoryStorageAdapter<{ value: string }>();
    const adapter = new FallbackStorageAdapter(primary, fallback);

    await primary.write('item', { value: 'from-primary' });
    expect(await adapter.read('item')).toEqual({ value: 'from-primary' });
    expect(await fallback.read('item')).toEqual({ value: 'from-primary' });

    await adapter.write('other', { value: 'mirrored' });
    expect(await primary.read('other')).toEqual({ value: 'mirrored' });
    expect(await fallback.read('other')).toEqual({ value: 'mirrored' });
    expect(adapter.mode).toBe('primary');
  });

  it('degrades once after an operational rejection and never retries the failed primary', async () => {
    const primary: StorageAdapter<{ value: string }> = {
      read: vi.fn().mockRejectedValue(new StorageUnavailableError()),
      write: vi.fn().mockRejectedValue(new StorageUnavailableError()),
      remove: vi.fn().mockRejectedValue(new StorageUnavailableError()),
      clear: vi.fn().mockResolvedValue(undefined)
    };
    const fallback = new InMemoryStorageAdapter<{ value: string }>();
    const adapter = new FallbackStorageAdapter(primary, fallback);

    await expect(adapter.write('item', { value: 'saved-locally' })).resolves.toBeUndefined();
    expect(adapter.mode).toBe('fallback');
    await expect(adapter.read('item')).resolves.toEqual({ value: 'saved-locally' });
    await adapter.remove('item');
    await adapter.clear();

    expect(primary.write).toHaveBeenCalledTimes(1);
    expect(primary.read).not.toHaveBeenCalled();
    expect(primary.remove).not.toHaveBeenCalled();
    expect(primary.clear).not.toHaveBeenCalled();
  });

  it('does not degrade for programmer validation errors', async () => {
    const primary: StorageAdapter<number> = {
      read: vi.fn().mockRejectedValue(new TypeError('invalid value')),
      write: vi.fn().mockRejectedValue(new TypeError('invalid value')),
      remove: vi.fn().mockRejectedValue(new TypeError('invalid value')),
      clear: vi.fn().mockResolvedValue(undefined)
    };
    const fallback = new InMemoryStorageAdapter<number>();
    const adapter = new FallbackStorageAdapter(primary, fallback);

    await expect(adapter.write('item', 1)).rejects.toThrow(TypeError);
    expect(adapter.mode).toBe('primary');
    expect(await fallback.read('item')).toBeUndefined();
  });
});

describe('IndexedDbStorageAdapter', () => {
  it('reports a machine-readable failure when IndexedDB is unavailable', async () => {
    const adapter = new IndexedDbStorageAdapter({
      databaseName: 'unavailable-storage-test',
      indexedDBFactory: undefined
    });

    await expect(adapter.read('item')).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE'
    });
    await expect(adapter.write('item', { value: true })).rejects.toBeInstanceOf(
      StorageUnavailableError
    );
  });

  it('validates keys and database configuration', () => {
    const adapter = new IndexedDbStorageAdapter();

    expect(() => adapter.read('')).toThrow(TypeError);
    expect(() => new IndexedDbStorageAdapter({ databaseName: ' ' })).toThrow(TypeError);
    expect(() => new IndexedDbStorageAdapter({ storeName: '' })).toThrow(TypeError);
    expect(() => new IndexedDbStorageAdapter({ version: 0 })).toThrow(TypeError);
    expect(() => new IndexedDbStorageAdapter({ version: 1.5 })).toThrow(TypeError);
  });
});

describe('createBrowserStorageAdapter', () => {
  it('composes a native adapter with a fresh fallback', async () => {
    const first = createBrowserStorageAdapter<{ value: number }>();
    const second = createBrowserStorageAdapter<{ value: number }>();

    await first.write('item', { value: 1 });
    expect(await second.read('item')).toBeUndefined();
  });
});
