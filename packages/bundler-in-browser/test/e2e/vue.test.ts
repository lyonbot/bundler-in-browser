import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { wrapCommonJS } from '../../src/utils/string.js';
import { createBundlerForTest, initializeEsbuild } from '../testutil.js';
import { installVuePlugin } from 'bundler-in-browser';
import { newFunction } from 'yon-utils';
import { insertElement, insertStyle, resetInsertedElements } from './e2eutils.js';

declare global {
  const __VUE_HMR_RUNTIME__: any
}

describe('vue', () => {
  let Vue!: typeof import('vue');
  const fakeRequire = (id: string) => {
    if (id === 'vue') return Vue;
    throw new Error(`Unknown require id: ${id}`)
  }
  const runJsGetExports = (js: string) => {
    const program = newFunction(['require'], `return ${wrapCommonJS(js)}`);
    return program(fakeRequire);
  }

  beforeAll(async () => {
    await initializeEsbuild();
    Vue = await import('vue');
  })

  beforeEach(() => {
    resetInsertedElements();
  })

  it.each([
    { styleLang: 'css' },
    { styleLang: 'scss' },
  ])('basic works, setup + %s', async (opts) => {
    const { bundler } = await createBundlerForTest({
      '/src/index.js': `
        import App from './App.vue';
        export default App;
      `,
      '/src/App.vue': `
        <template>
          <div class="msg">{{ msg }}</div>
          <button @click="msg = 'world'">change</button>
        </template>
        <script setup>
          import { ref } from 'vue';
          const msg = ref('hello');
        </script>
        <style scoped lang="${opts.styleLang}">
          ${opts.styleLang === 'scss' ? `
            @use 'sass:color';
            
            button {
              color: color.adjust(#ffffff, $red: -255);
            } 
          ` : ''}
          .msg {
            color: red;
          }
        </style>
      `,
    })

    await installVuePlugin(bundler);
    bundler.config.externals.push('vue');

    const result = await bundler.build();

    // run js
    const App = runJsGetExports(result.js).default;
    const container = document.createElement('div');
    insertElement(container);
    Vue.createApp(App).mount(container);

    // insert css
    insertStyle(result.css);

    // assert
    expect(container.querySelector('.msg')?.textContent).toEqual('hello');
    expect(container.querySelector('button')?.textContent).toEqual('change');

    container.querySelector('button')?.click();
    await Vue.nextTick();

    expect(container.querySelector('.msg')?.textContent).toEqual('world');

    if (opts.styleLang === 'scss') {
      const anotherButton = document.createElement('button');
      anotherButton.textContent = 'scoped style not affected';
      insertElement(anotherButton);

      expect(getComputedStyle(anotherButton).color).not.toEqual('rgb(0, 255, 255)');
      expect(getComputedStyle(container.querySelector('button')!).color).toEqual('rgb(0, 255, 255)');
    }
  })

  it('hmr', async () => {
    const { fs, bundler } = await createBundlerForTest({
      '/src/index.js': `
        import App from './App.vue';
        export default App;
      `,
      '/src/App.vue': `
        <template>
          <div class="msg">{{ msg }}</div>
          <button @click="msg = 'world'">change</button>
        </template>
        <script setup>
          import { ref } from 'vue';
          const msg = ref('hello');
        </script>
        <style scoped>
          .msg {
            color: red;
          }
        </style>
      `,
    })

    const vuePlugin = await installVuePlugin(bundler);
    bundler.config.externals.push('vue');

    // HMR magics 💫
    vuePlugin.options.hmr = true;
    vuePlugin.options.inlineTemplate = false;

    // first build
    const result = await bundler.build();

    // run js
    const App = runJsGetExports(result.js).default;
    const container = document.createElement('div');
    insertElement(container);
    Vue.createApp(App).mount(container);

    // insert css
    const style1 = insertStyle(result.css);

    // assert Vue runtime
    // Please use vue/dist/vue.esm-bundler.js
    expect(typeof __VUE_HMR_RUNTIME__).toBe('object');

    // assert
    expect(container.querySelector('.msg')?.textContent).toEqual('hello');
    expect(container.querySelector('button')?.textContent).toEqual('change');
    container.querySelector('button')?.click();
    await Vue.nextTick();
    expect(container.querySelector('.msg')?.textContent).toEqual('world');

    // ----------------------------------------------
    // hmr make patch

    const sfc = vuePlugin.sfcCache.get('/src/App.vue')!
    expect(sfc).toBeTruthy();
    expect(sfc.hmrId).toBeTruthy();

    await fs.promises.writeFile(
      '/src/App.vue', `
        <template>
          <div class="msg">{{ msg }}</div>
          <button @click="msg = 'world'">修改！</button>
        </template>
        <script setup>
          import { ref } from 'vue';
          const msg = ref('hello');
        </script>
        <style scoped>
          .msg {
            color: blue;
          }
        </style>
      `,
    )

    // Note1:
    // in actual usage, we shall check which .vue file changed.
    // and compare `sfc` with newest result of `compiler.parse("new content")`
    // 
    // but for now, just assume /src/App.vue changed

    // Note2:
    // all imported modules of App.vue will be reinitialized,
    // hence, in your real project, please externalize them (bundler.config.externals), and inherit them from existing instance
    // (hint: use vuePlugin.options.patchCompiledScript to find imported symbols, and store them in runtime, then reuse them in HMR reload)

    const result2 = await bundler.build();
    const App2 = runJsGetExports(result2.js).default;

    // ----------------------------------------------
    // hmr apply: replace style
    style1.remove();
    insertStyle(result2.css);

    // ----------------------------------------------
    // hmr apply: replace render function
    __VUE_HMR_RUNTIME__.rerender(sfc.hmrId, App2.render);
    await Vue.nextTick();

    // assert
    expect(container.querySelector('.msg')?.textContent).toEqual('world'); // unchanged
    expect(container.querySelector('button')?.textContent).toEqual('修改！');
    expect(getComputedStyle(container.querySelector('.msg')!).color).toEqual('rgb(0, 0, 255)');

    // ----------------------------------------------
    // hmr apply: reload component

    __VUE_HMR_RUNTIME__.reload(sfc.hmrId, App2);
    await Vue.nextTick();

    // assert
    expect(container.querySelector('.msg')?.textContent).toEqual('hello'); // reset
    expect(container.querySelector('button')?.textContent).toEqual('修改！');
    expect(getComputedStyle(container.querySelector('.msg')!).color).toEqual('rgb(0, 0, 255)');
  })
})