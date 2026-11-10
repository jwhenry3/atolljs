// @vitest-environment happy-dom
/**
 * The `atollFederation` publish plugin — config() maps `shared` onto rollup
 * external+paths, generateBundle emits mfe.manifest.json keyed by the
 * emitted entry chunks (exposes map or chunk names).
 */
import { describe, expect, it } from 'vitest';
import { atollFederation } from '../src/vite';

type Bundle = Record<
  string,
  {
    type: string;
    isEntry?: boolean;
    facadeModuleId?: string;
    fileName: string;
    name?: string;
  }
>;

const runGenerate = (
  plugin: ReturnType<typeof atollFederation>,
  bundle: Bundle,
): { fileName?: string; source?: string } => {
  const emitted: { fileName?: string; source?: string } = {};
  (plugin.generateBundle as (this: unknown, o: unknown, b: Bundle) => void).call(
    {
      emitFile: (f: { fileName?: string; source?: string }) => {
        emitted.fileName = f.fileName;
        emitted.source = f.source;
      },
    },
    {},
    bundle,
  );
  return emitted;
};

describe('atollFederation', () => {
  it('config() externalizes shared deps and rewrites them to pinned URLs', () => {
    const plugin = atollFederation({
      shared: { react: 'https://shell/@shared/react@18.3.1.js', vue: 'https://shell/@shared/vue.js' },
    });
    const config = (plugin.config as () => unknown)() as {
      build: { rollupOptions: { external: string[]; output: { paths: Record<string, string> } } };
    };
    expect(config.build.rollupOptions.external).toEqual(['react', 'vue']);
    expect(config.build.rollupOptions.output.paths.react).toBe(
      'https://shell/@shared/react@18.3.1.js',
    );
  });

  it('config() is inert with no shared deps', () => {
    const plugin = atollFederation({ name: 'm' });
    expect((plugin.config as () => unknown)()).toBeNull();
  });

  it('emits a manifest mapping exposes keys to emitted entry chunks', () => {
    const plugin = atollFederation({
      name: 'counter-mfe',
      exposes: { counter: 'src/mfe/counter.app.ts' },
      manifest: { version: '1.0.0', requires: { react: '^18' } },
    });
    const emitted = runGenerate(plugin, {
      'counter.app-abc.js': {
        type: 'chunk',
        isEntry: true,
        facadeModuleId: '/repo/src/mfe/counter.app.ts',
        fileName: 'counter.app-abc.js',
        name: 'counter',
      },
      'shared-xyz.js': { type: 'chunk', isEntry: false, fileName: 'shared-xyz.js' },
    });
    expect(emitted.fileName).toBe('mfe.manifest.json');
    const manifest = JSON.parse(emitted.source!);
    expect(manifest).toEqual({
      name: 'counter-mfe',
      version: '1.0.0',
      apps: { counter: './counter.app-abc.js' },
      requires: { react: '^18' },
    });
  });

  it('without exposes, every entry chunk becomes an app keyed by chunk name', () => {
    const plugin = atollFederation({ name: 'r', manifest: { fileName: 'fed.json' } });
    const emitted = runGenerate(plugin, {
      'a.js': { type: 'chunk', isEntry: true, fileName: 'a.js', name: 'alpha' },
      'b.js': { type: 'chunk', isEntry: true, fileName: 'b.js', name: 'beta' },
      'c.js': { type: 'chunk', isEntry: false, fileName: 'c.js', name: 'shared' },
      'logo.png': { type: 'asset', fileName: 'logo.png' },
    });
    expect(emitted.fileName).toBe('fed.json');
    const manifest = JSON.parse(emitted.source!);
    expect(manifest.apps).toEqual({ alpha: './a.js', beta: './b.js' });
    expect(manifest.version).toBeUndefined();
    expect(manifest.requires).toBeUndefined();
  });
});
