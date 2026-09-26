import { MemoryConfig, ViewType } from '../contract/types';

export class MemoryManager {
  public memory: WebAssembly.Memory;
  private maxPages: number;

  constructor(config: MemoryConfig = {}) {
    const initialPages = config.initialPages ?? 16; // 1MB default
    this.maxPages = config.maximumPages ?? 16384; // 1GB default limit

    // Initialize WebAssembly.Memory with shared: true for SharedArrayBuffer support
    this.memory = new WebAssembly.Memory({
      initial: initialPages,
      maximum: this.maxPages,
      shared: true,
    });
  }

  /**
   * Automatically checks if memory needs to grow to accommodate new bytes,
   * and expands via memory.grow() if necessary. Thread-safe.
   */
  public ensureCapacity(requiredBytes: number): void {
    const currentByteLength = this.memory.buffer.byteLength;
    if (currentByteLength >= requiredBytes) return;

    const bytesNeeded = requiredBytes - currentByteLength;
    const pagesNeeded = Math.ceil(bytesNeeded / 65536);
    const currentPages = this.memory.buffer.byteLength / 65536;

    if (currentPages + pagesNeeded > this.maxPages) {
      throw new Error(`Cannot grow memory: exceeds maximum page limit of ${this.maxPages}`);
    }

    this.memory.grow(pagesNeeded);
  }

  /**
   * Creates a typed view over the shared memory buffer at a specific byte offset.
   */
  public getView<T extends Int32Array | Float64Array | BigInt64Array | Uint8Array>(
    type: ViewType,
    byteOffset: number = 0,
    length?: number
  ): T {
    const buffer = this.memory.buffer;
    
    switch (type) {
      case 'Int32':
        return new Int32Array(buffer, byteOffset, length) as T;
      case 'Float64':
        return new Float64Array(buffer, byteOffset, length) as T;
      case 'BigInt64':
        return new BigInt64Array(buffer, byteOffset, length) as T;
      case 'Uint8':
        return new Uint8Array(buffer, byteOffset, length) as T;
      default:
        throw new Error(`Unsupported view type: ${type}`);
    }
  }

  /**
   * Exposes the raw SharedArrayBuffer
   */
  public getBuffer(): SharedArrayBuffer {
    return this.memory.buffer as unknown as SharedArrayBuffer;
  }
}
