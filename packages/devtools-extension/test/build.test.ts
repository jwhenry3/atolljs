// @vitest-environment node
/**
 * The unpacked-extension build: manifest (MV3, content script + module
 * service worker, no permission keys), the generated classic content
 * script, panel.html derived from the dashboard's index.html, copied app,
 * and PNG icons.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ICON_SIZES, build, chromeVersion, classicScript, panelHtml } from '../scripts/build.mjs';
import { encodePng, parseMark, renderMark } from '../scripts/icons.mjs';
import { FakeEvent } from './fakeChrome';

const out = mkdtempSync(join(tmpdir(), 'atoll-ext-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('extension build', () => {
  it('emits a loadable MV3 extension', () => {
    const { manifest } = build({ outDir: out });
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.devtools_page).toBe('devtools.html');
    expect(manifest).not.toHaveProperty('permissions');
    expect(manifest).not.toHaveProperty('host_permissions');
    expect(manifest.background).toEqual({ service_worker: 'background.js', type: 'module' });
    expect(manifest.content_scripts).toEqual([{
      matches: ['<all_urls>'], js: ['content.js'], run_at: 'document_start', all_frames: false, world: 'ISOLATED',
    }]);
    expect(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))).toEqual(manifest);

    for (const f of ['devtools.html', 'devtools.js', 'background.js', 'content.js',
      'ext/bridge.js', 'ext/push-bridge.js', 'ext/hub.js', 'ext/frames.js', 'ext/ext.css',
      'app/index.html', 'app/main.js', 'app/api.js', 'app/panels/shell.js']) {
      expect(existsSync(join(out, f)), f).toBe(true);
    }
    expect(existsSync(join(out, 'ext/relay.js'))).toBe(false);
    expect(existsSync(join(out, 'app/panels/route.d.ts'))).toBe(false);
    expect(readFileSync(join(out, 'devtools.js'), 'utf8')).toContain("'app/panel.html'");
    expect(readFileSync(join(out, 'background.js'), 'utf8')).toContain("from './ext/hub.js'");

    const panel = readFileSync(join(out, 'app/panel.html'), 'utf8');
    expect(panel.indexOf('../ext/bridge.js')).toBeGreaterThan(0);
    expect(panel.indexOf('../ext/bridge.js')).toBeLessThan(panel.indexOf('./main.js'));
    expect(panel).toContain('href="../ext/ext.css"');

    for (const s of ICON_SIZES) {
      const png = readFileSync(join(out, `icons/icon-${s}.png`));
      expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
      expect(png.readUInt32BE(16)).toBe(s); // IHDR width
      expect(png.readUInt32BE(20)).toBe(s);
    }
  });

  it('generates a classic content script that installs only a message listener', () => {
    build({ outDir: out });
    const src = readFileSync(join(out, 'content.js'), 'utf8');
    expect(src).not.toMatch(/^\s*(import|export)\b/m);
    const runtime = { onMessage: new FakeEvent(), connect: vi.fn() };
    const Channel = vi.fn();
    // a classic script body: parses and runs as a plain function, nothing module-only
    new Function('chrome', 'BroadcastChannel', src)({ runtime }, Channel);
    expect(runtime.onMessage.listeners.size).toBe(1);
    expect(runtime.connect).not.toHaveBeenCalled();
    expect(Channel).not.toHaveBeenCalled();
  });

  it('refuses module syntax it cannot flatten', () => {
    expect(classicScript([{ name: 'a.js', code: "import { x } from './b.js';\nexport const y = x;" }], '')).toContain('const y = x;');
    expect(() => classicScript([{ name: 'a.js', code: "import x from 'pkg';" }], '')).toThrow(/a\.js/);
    expect(() => classicScript([{ name: 'a.js', code: 'export default 1;' }], '')).toThrow(/a\.js/);
  });

  it('refuses an index.html the extension CSP would break', () => {
    const ok = '<html><head></head><body><script type="module" src="./main.js"></script></body></html>';
    expect(panelHtml(ok)).toContain('../ext/bridge.js');
    expect(() => panelHtml(ok.replace('<body>', '<body><script>window.x=1</script>'))).toThrow(/inline/);
    expect(() => panelHtml('<html><head></head><body></body></html>')).toThrow(/main\.js/);
  });

  it('maps package versions onto Chrome version fields', () => {
    expect(chromeVersion('0.4.2')).toEqual({ version: '0.4.2' });
    expect(chromeVersion('1.0.0-beta.3')).toEqual({ version: '1.0.0', version_name: '1.0.0-beta.3' });
    expect(() => chromeVersion('next')).toThrow();
  });

  it('rasterizes the mark with a transparent rounded tile', () => {
    const svg = '<svg viewBox="0 0 10 10"><path d="M 2 2 H 8 V 8 H 2 Z" fill="#ffffff"/></svg>';
    const px = renderMark(parseMark(svg), 20, { radius: 0.2, pad: 0 });
    expect(px[3]).toBe(0); // corner outside the rounded tile
    const mid = (10 * 20 + 10) * 4;
    expect([px[mid], px[mid + 3]]).toEqual([255, 255]);
    expect(encodePng(px, 20, 20).subarray(12, 16).toString('latin1')).toBe('IHDR');
    expect(() => parseMark('<svg viewBox="0 0 1 1"><path d="m 0 0 l 1 1" fill="#ffffff"/></svg>')).toThrow(/relative/);
  });
});
