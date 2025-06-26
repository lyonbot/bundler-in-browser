//
// setup highlight and theme
//

import { shikiToMonaco } from '@shikijs/monaco'
import * as monaco from 'monaco-editor-core'
import { createHighlighter } from 'shiki'

// 创建一个可复用的语法高亮器
const highlighter = await createHighlighter({
  themes: [
    'vitesse-dark',
    'vitesse-light',
  ],
  langs: [
    'vue',
    'javascript',
    'typescript',
    'json',
    'css',
    'scss'
  ],
})

// 首先注册你需要的语言的 IDs
// monaco.languages.register({ id: 'vue' })       // will be registered by setup-volar
monaco.languages.register({ id: 'typescript' })
monaco.languages.register({ id: 'javascript' })
monaco.languages.register({ id: 'json' })
monaco.languages.register({ id: 'css' })
monaco.languages.register({ id: 'scss' })

// 注册 Shiki 主题，并为 Monaco 提供语法高亮
shikiToMonaco(highlighter, monaco)

monaco.editor.setTheme('vitesse-dark')

// // 创建编辑器
// const editor = monaco.editor.create(document.getElementById('container'), {
//   value: 'const a = 1',
//   language: 'javascript',
//   theme: 'vitesse-dark',
// })

// 正常使用