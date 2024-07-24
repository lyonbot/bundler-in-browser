import { Volume } from "memfs";
import { BundlerInBrowser } from "../src/index";

const fsRaw = (Volume.fromJSON({
  "/index.js": `
import React from 'react';
import { createRoot } from 'react-dom/client';

const container = document.createElement('div');
document.body.appendChild(container);
const root = createRoot(container);

import SqlEditor from './sqlEditor.jsx';
root.render(React.createElement(SqlEditor));

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

const compiler = new BundlerInBrowser(fs);
await compiler.initialize();

const out = await compiler.compile();
const fn = new Function('module', 'require', 'var exports = module.exports = {};\n' + out);

const m = { exports: {} };
fn(m, r => {
  console.log('require', r);
  throw new Error('require not supported');
});

window.fs = fs;
