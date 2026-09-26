import { decode, encode } from '@msgpack/msgpack';
import type { Codec } from './sharedMemory';

/**
 * MessagePack transport codec: smaller payloads than JSON and supports types
 * JSON can't express (Uint8Array, BigInt, etc.). Decoded values are still
 * validated by each field's zod schema.
 */
export const msgpackCodec: Codec = { encode, decode };
