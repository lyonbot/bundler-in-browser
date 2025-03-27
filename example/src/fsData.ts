export const fsData = {
  "/index.js": `
import { createApp } from 'vue';
import confetti from "canvas-confetti";

import App from './App.vue';

const el = document.createElement('div');
document.body.appendChild(el);
createApp(App).mount(el);

setInterval(() => { confetti() }, 3000);
confetti();
`,
  "/App.vue": `
<template>
  <h1>BundlerInBrowser! Works!</h1>
  <div class="card">
    <p>
      <img src="./vue.svg" alt="Vue logo" width="100" height="100">
    </p>
    <p>Counter: {{ count }}</p>
    <button @click="increment">Increment</button>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
const count = ref(0);
const increment = () => count.value++;
const hue = computed(() => (count.value * 40) % 360);
</script>

<style scoped>
h1 {
  text-align: center;
  color: hsla(v-bind(hue), 100%, 37%, 1);
}

.card {
  text-align: center;
  border: 1px solid #ccc;
  padding: 16px;
  border-radius: 16px;
  max-width: 600px;
  margin: auto;
}
</style>
`,
  "/vue.svg": `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 261.76 226.69"><path d="M161.096.001l-30.225 52.351L100.647.001H-.005l130.877 226.688L261.749.001z" fill="#41b883"/><path d="M161.096.001l-30.225 52.351L100.647.001H52.346l78.526 136.01L209.398.001z" fill="#34495e"/></svg>
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
};
