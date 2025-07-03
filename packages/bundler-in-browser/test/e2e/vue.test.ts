import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { wrapCommonJS } from '../../src/utils/string.js';
import { createBundlerForTest, initializeEsbuild } from '../testutil.js';
import { installVuePlugin } from 'bundler-in-browser';
import { newFunction } from 'yon-utils';
import { insertElement, insertStyle, resetInsertedElements } from './e2eutils.js';

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
})