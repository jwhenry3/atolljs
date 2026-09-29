import { describe, expect, it } from 'vitest';
import * as react from '@atolljs/react';
import { useObservable, useSharedValue, useTask } from '../src/index';

describe('@atolljs/nextjs', () => {
  it('re-exports the React bindings verbatim', () => {
    expect(useObservable).toBe(react.useObservable);
    expect(useSharedValue).toBe(react.useSharedValue);
    expect(useTask).toBe(react.useTask);
  });
});
