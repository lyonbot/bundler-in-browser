//
// setup highlight and theme
//

import { shikiToMonaco, textmateThemeToMonacoTheme } from '@shikijs/monaco'
import * as monaco from 'monaco-editor-core'
import { createHighlighter, bundledThemes, normalizeTheme } from 'shiki'

// 创建一个可复用的语法高亮器
// see https://textmate-grammars-themes.netlify.app/
createHighlighter({
  themes: [
    'vitesse-dark',
    'vitesse-light',
  ],
  langs: [
    'vue',
    'javascript',
    'typescript',
    'yaml',
    'json',
    'css',
    'scss'
  ],
}).then(async (highlighter) => {

  // 首先注册你需要的语言的 IDs
  monaco.languages.register({ id: 'vue', extensions: ['.vue'] })
  monaco.languages.register({ id: 'typescript', extensions: ['.ts'] })
  monaco.languages.register({ id: 'javascript', extensions: ['.js'] })
  monaco.languages.register({ id: 'yaml', extensions: ['.yaml'] })
  monaco.languages.register({ id: 'json', extensions: ['.json'] })
  monaco.languages.register({ id: 'css', extensions: ['.css'] })
  monaco.languages.register({ id: 'scss', extensions: ['.scss'] })

  // 注册 Shiki 主题，并为 Monaco 提供语法高亮
  shikiToMonaco(highlighter, monaco)

  monaco.editor.setTheme('vitesse-light')

  // editor.lineHighlightBackground
  // editor.selectionBackground
  // editor.selectionHighlightBackground

  // make the selection eye-catching
  const theme = await bundledThemes['vitesse-light']().then(theme => theme.default)
  const monacoTheme = textmateThemeToMonacoTheme(normalizeTheme(theme))
  monacoTheme.colors['editor.selectionBackground'] = '#10b98166'
  monaco.editor.defineTheme('vitesse-light', monacoTheme)
})
