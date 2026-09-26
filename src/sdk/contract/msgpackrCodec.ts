import { Packr } from 'msgpackr';
import type { Codec } from './sharedMemory';

/**
 * MessagePack via msgpackr, with `useRecords` — structure-sharing for repeated
 * same-shape objects (field names encoded once, then compact record bodies).
 * The fast path for large arrays of uniform records. Both threads get this
 * codec from the shared contract, so the extension format stays consistent.
 * Drop-in Codec: `defineSharedMemory(spec, { codec: msgpackrCodec })`.
 */
const packr = new Packr({ useRecords: true });

export const msgpackrCodec: Codec = {
  encode: (value) => packr.pack(value),
  decode: (data) => packr.unpack(data),
};
