/**
 * Types for root.svelte.js — the helper stays .js because the svelte compiler
 * parses .svelte.js rune modules under vitest without TS preprocessing.
 */
export function inRoot<T>(fn: () => T): { value: T; destroy: () => void };
