import { describe, expect, it } from 'vitest';
import { wrapCommonJS } from '../src/utils.js';
import { createBundlerForTest, hookMiniNpm } from './testutil.js';

describe('bundler', () => {
  it('works', async () => {
    const { bundler } = await createBundlerForTest({
      '/src/index.js': `
        import { hello } from './hello.js';
        export const msg = hello();
      `,
      '/src/hello.js': `
        export function hello() {
          return 'hello';
        }
      `,
    })

    const result = await bundler.build();

    expect(result.externals.length).toEqual(0);
    expect(result.vendorBundle.exportPaths.length).toEqual(0);
    expect(eval(wrapCommonJS(result.js))).toEqual({ msg: 'hello' });
  })

  it('works with npm', async () => {
    const { bundler } = await createBundlerForTest({
      '/src/index.js': `
        import { hello } from 'hello/lib/hello';
        export const msg = hello();
      `
    });

    const npmHook = hookMiniNpm(bundler.npm);
    npmHook.addMockPackage('hello', '1.0.0', {
      dependencies: {
        'world': '^2.0.0',
      },
      files: {
        'lib/hello.js': `
          import { world } from 'world';
          export function hello() {
            return 'hello ' + world();
          }
        `
      }
    });
    npmHook.addMockPackage('world', '2.0.0', {
      main: 'index.js',
      dependencies: {},
      files: {
        'index.js': `
          export function world() {
            return 'world';
          }
        `
      }
    })

    const result = await bundler.build();

    expect(result.externals.length).toEqual(0);
    expect(result.vendorBundle.exportPaths).toEqual(['hello/lib/hello']);
    expect(result.userCode.npmRequired).toEqual(['hello'])

    expect(eval(wrapCommonJS(result.js))).toEqual({ msg: 'hello world' });
  })
})