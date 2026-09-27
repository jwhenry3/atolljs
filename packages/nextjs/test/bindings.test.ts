import { describe, expect, it } from 'vitest';
import * as react from '@jwhenry123/mesh-react';
import { useObservable, useSharedValue, useTask } from '../src/index';

describe('@jwhenry123/mesh-nextjs', () => {
  it('re-exports the React bindings verbatim', () => {
    expect(useObservable).toBe(react.useObservable);
    expect(useSharedValue).toBe(react.useSharedValue);
    expect(useTask).toBe(react.useTask);
  });
});
