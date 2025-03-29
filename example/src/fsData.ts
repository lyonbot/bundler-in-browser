export const fsData = {
  "/src/index.js": `
import { createApp } from 'vue';
import confetti from "canvas-confetti";

import App from './App.vue';
import "./tailwind.css";

const el = document.createElement('div');
document.body.appendChild(el);
createApp(App).mount(el);

setInterval(() => { confetti() }, 3000);
confetti();

// uncomment to test React + CodeMirror + module-css + TailwindCSS
// import './react/index';
`,
  "/src/tailwind.css": `
@tailwind base;
@tailwind components;
@tailwind utilities;
`,
  "/tailwind.config.js": `
// ⚠️ not suggested to use this config, because we use eval to load it
// please pass the config object directly to bundler-in-browser, not this virtual file

module.exports = {
  // "content" is ignored - managed by bundler-in-browser
  // content: [ "./src/**/*.{vue,js,ts,jsx,tsx}" ],

  // 3rd-party plugins not work here.

  corePlugins: {
    preflight: false,  // remove Tailwind's reset
  }
}
  `,
  "/src/App.vue": `
<template>
  <h1>BundlerInBrowser! Works!</h1>
  <div class="card bg-slate-200 shadow-lg">
    <p>
      <img src="./vue.svg" alt="Vue logo" width="100" height="100">
    </p>
    <p>Counter: {{ count }}</p>
    <button @click="increment">Increment</button>
  </div>
  <p class="footer">
    built with 
    <a href="https://github.com/lyonbot/bundler-in-browser" target="_blank">
      📦 
      bundler-in-browser
    </a>
  </p>
</template>

<script setup>
import { ref, computed } from 'vue';
const count = ref(0);
const increment = () => count.value++;

const hue = computed(() => (count.value * 40) % 360);
const textColor = computed(() => \`hsla(\${hue.value}, 100%, 37%, 1)\`);
</script>

<style scoped lang="scss">
h1 {
  text-align: center;
  color: v-bind(textColor);
  margin-top: 2em;
}

.card {
  text-align: center;
  border: 1px solid #ccc;
  padding: 16px;
  border-radius: 16px;
  max-width: 600px;
  margin: auto;
  margin-top: 4em;
}

.footer {
  margin-top: 4em;
  text-align: center;
  color: #333;

  a {
    color: #30a;
    text-decoration-style: dashed;
  }
}
</style>
`,
  "/src/vue.svg": `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 261.76 226.69"><path d="M161.096.001l-30.225 52.351L100.647.001H-.005l130.877 226.688L261.749.001z" fill="#41b883"/><path d="M161.096.001l-30.225 52.351L100.647.001H52.346l78.526 136.01L209.398.001z" fill="#34495e"/></svg>
`,
  "/src/react/index.js": `
// ------- React -------
import React from 'react';
import { createRoot } from 'react-dom/client';
import SqlEditor from './sqlEditor.jsx';

const container = document.createElement('div');
document.body.appendChild(container);
const root = createRoot(container);

root.render(React.createElement(SqlEditor));

// ------- Dynamic Import ------
import("./tst-dynamic.js").then(d => { console.log('dayjs=', d) })

// ------- CSS ------
import "github-markdown-css/github-markdown-dark.css";
import styles from "./styles.module.scss";

const text = document.createElement('div');
text.innerText = 'hello world';
text.className = styles.hello;
document.body.appendChild(text);
  `,
  "/src/react/styles.module.scss": `
.hello {
  @apply my-4 text-red-500 text-2xl animate-bounce;
}
  `,
  "/src/react/tst-dynamic.js": `
import dayjs from "dayjs";
export { dayjs }
  `,
  "/src/react/sqlEditor.jsx": `
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
      <button onClick={handleExecute}>Execute SQL</button>
    </div>
  );
};

export default SQLEditor;
`
};
