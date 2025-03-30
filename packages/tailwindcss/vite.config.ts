import { createRequire } from 'module';
import { defineConfig } from 'vite';
import { mkdir, writeFile, readFile } from 'fs/promises';
import dts from 'vite-plugin-dts'

import packageJSON from './package.json' assert { type: 'json' };
const require = createRequire(import.meta.url);
const IS_DEVELOPMENT = process.env.NODE_ENV === 'development';

const nullobj = require.resolve('./src/dirty-stuff/empty-object.cjs')

export default defineConfig({
  define: {
    'process.env.NODE_ENV': '"development"',
    'process': '{"env":{}}',  // WTF for postcss
    // 'process.platform': '"browser"',
  },
  resolve: {
    alias: {
      "postcss/lib/terminal-highlight": nullobj,
      "source-map-js": nullobj,
      "path": nullobj,
      "url": nullobj,
      "fs": nullobj,
    }
  },
  plugins: [
    dts({ rollupTypes: true }),
    {
      name: 'generate-goods',
      apply: 'build',
      async buildEnd(error) {
        if (error) return;

        const goodsSource = await readFile('./src/goods/index.ts', 'utf-8');
        const names = Array.from(goodsSource.matchAll(/^import (\w+)/gm), m => m[1]);

        const dir = './goods';
        await mkdir(dir).catch(() => { });
        for (const name of names) {
          const file = `${dir}/${name}.js`;
          await writeFile(file, `import { tailwindGoods } from '../dist/index.js';\nexport default tailwindGoods.${name};\n`, 'utf-8');
        }

        console.log('goods generated: ' + names);
      },
    },
  ],
  build: {
    minify: !IS_DEVELOPMENT,
    rollupOptions: {
      external: [
        ...Object.keys(packageJSON.dependencies),
        ...Object.keys(packageJSON.peerDependencies),
      ]
    },
    lib: {
      entry: './src/index.ts',
      formats: ['cjs', 'es'],
      fileName: 'index',
    },
  },
})