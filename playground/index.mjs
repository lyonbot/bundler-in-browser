import { Volume } from "memfs";
import { BundlerInBrowser } from "../src/index";
import esbuildWasmURL from "esbuild-wasm/esbuild.wasm?url";
import installSassPlugin from "../src/plugins/sass";
import installVuePlugin from "../src/plugins/vue";
import { wrapCommonJS } from "../src/utils";

const fsRaw = (Volume.fromJSON({
  "/index.js": `
import confetti from "canvas-confetti";
confetti();
setInterval(() => { confetti() }, 3000);

import { createApp } from 'vue';
import App from './App.vue';

const el = document.createElement('div');
document.body.appendChild(el);
createApp(App).mount(el);
`,
  "/App.vue": `
<template>
  <h1>BundlerInBrowser! Works!</h1>
  <p>Counter: {{ count }}</p>
  <button @click="increment">Increment</button>
</template>

<script setup>
import { ref, computed } from 'vue';
const count = ref(0);
const increment = () => count.value++;
const hue = computed(() => (count.value * 40) % 360);
</script>

<style scoped>
h1 {
  color: hsla(v-bind(hue), 100%, 37%, 1);
}
</style>
`,
  "/index2.js": `
import "github-markdown-css/github-markdown-dark.css";
import * as S from "./base.module.scss";
console.log(S);

import React from 'react';
import { createRoot } from 'react-dom/client';

const container = document.createElement('div');
document.body.appendChild(container);
const root = createRoot(container);

import("./dynamic1.js").then(d => { console.log('dayjs=',d) })

import SqlEditor from './sqlEditor.jsx';
root.render(React.createElement(SqlEditor));
  `,
  "/base.module.scss": `
.hello {
  color: red;
}
  `,
  "/dynamic1.js": `
import dayjs from "dayjs";
export { dayjs }
  `,
  "/sqlEditor.jsx": `
import React, { useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { dracula } from '@uiw/codemirror-theme-dracula';

const SQLEditor = () => {
  const [code, setCode] = useState('SELECT * FROM users;');

  const handleChange = React.useCallback((value, viewUpdate) => {
    setCode(value);
  }, []);

  const handleExecute = () => {
    // 这里可以添加执行SQL的逻辑
    console.log('Executing SQL:', code);
  };

  return (
    <div className="p-4 bg-gray-100 rounded-lg">
      <CodeMirror
        value={code}
        height="200px"
        theme={dracula}
        extensions={[sql()]}
        onChange={handleChange}
        className="mb-4 border border-gray-300 rounded"
      />
      <button onClick={handleExecute}>执行SQL</button>
    </div>
  );
};

export default SQLEditor;
`

  // "/index.js": `import { hello } from "./hello.js";\n console.log(hello());`,
  // "/hello.js": `import { v4 } from "uuid";\n export function hello() { return "hello " + v4(); }`,
}));
const fs = new Proxy({}, {
  get(target, prop) {
    let raw = target[prop];
    if (raw) return raw;

    let fromFs = fsRaw[prop]
    if (typeof fromFs === "function") fromFs = fromFs.bind(fsRaw);
    return fromFs
  },
})

window.fs = fs;

const compiler = new BundlerInBrowser(fs);
await compiler.initialize({
  esbuildWasmURL: esbuildWasmURL
});

installSassPlugin(compiler);
installVuePlugin(compiler);

const out = await compiler.compile();
console.log('compiled', out);

const style = document.createElement('style');
document.head.appendChild(style);
style.textContent = out.css;

const fn = new Function(wrapCommonJS(out.js));
fn();
