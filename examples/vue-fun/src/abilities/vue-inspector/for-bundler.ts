//
// this file contains some useful vue stuff for development usage
//

import { type AttributeNode, type RootNode, type SourceLocation, type TemplateChildNode } from '@vue/compiler-core'

const EXCLUDE_TAG = ['template', 'script', 'style']
const KEY_PROPS_DATA = '__v_inspector'
const ATTR_KEY = 'data-v-inspector'

const getFakeLoc = (): SourceLocation => ({
  start: { offset: 0, line: 0, column: 0 },
  end: { offset: 0, line: 0, column: 0 },
  source: '',
})

/**
 * Add `data-v-inspector` attribute to all Vue elements.
 * 
 * use this in `templateCompilerOptions.nodeTransforms`
 */
export const vueInspectorNodeTransform = (node: TemplateChildNode | RootNode, context: any) => {
  const filename = context.filename

  if (node.type === 1) {
    if ((node.tagType === 0 || node.tagType === 1) && !EXCLUDE_TAG.includes(node.tag)) {
      const { line, column } = node.loc.start
      const { line: endLine, column: endColumn } = node.loc.end
      node.props.push({
        type: 6,
        name: ATTR_KEY,
        value: {
          type: 2,
          content: `${filename}:${line}:${column}-${endLine}:${endColumn}`,
          loc: getFakeLoc(),
        },
        loc: getFakeLoc(),
        nameLoc: getFakeLoc(),
      } satisfies AttributeNode)
    }
  }
}

/**
 * patch the compiled template/script code,
 */
export function vuePatchScriptForInspector(content: string, mappings: any): undefined | [code: string, mappings: any] {
  if (!content?.includes(ATTR_KEY)) return

  const fn = new Set<string>()
  let s = content

  s = s.replace(/(createElementVNode|createVNode|createElementBlock|createBlock) as _\1,?/g, (_, name) => {
    fn.add(name)
    return ''
  })

  if (!fn.size) return

  // simply append to end of script,
  // so the sourcemap can just work without modification 
  // and function declarations will be hoisted (js rocks), it just works!

  s += `\n/* Injection by vite-plugin-vue-inspector Start */
import { ${Array.from(fn.values()).map(i => `${i} as __${i}`).join(',')} } from 'vue'
function _interopVNode(vnode) {
  if (vnode && vnode.props && '${ATTR_KEY}' in vnode.props) {
    const data = vnode.props['${ATTR_KEY}']
    delete vnode.props['${ATTR_KEY}']
    Object.defineProperty(vnode.props, '${KEY_PROPS_DATA}', { value: data, enumerable: false })
  }
  return vnode
}
${Array.from(fn.values()).map(i => `function _${i}(...args) { return _interopVNode(__${i}(...args)) }`).join('\n')}
/* Injection by vite-plugin-vue-inspector End */
`

  // TODO: handle JSX syntax
  // TODO: handle sourcemap

  return [s, mappings]
}
