//
// this file contains some useful vue stuff for development usage
//

import { NodeTypes, type AttributeNode, type NodeTransform, type SourceLocation } from '@vue/compiler-core'
import { ATTR_KEY, KEY_PROPS_DATA, VUE_INST_RENDERED_ROOT } from './constants'

const EXCLUDE_TAG = ['template', 'script', 'style']

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
export const vueInspectorNodeTransform: NodeTransform = (node, context) => {
  const filename = context.filename

  if (node.type === 1) {
    if ((node.tagType === 0 || node.tagType === 1) && !EXCLUDE_TAG.includes(node.tag)) {
      const { line, column } = node.loc.start
      const { line: endLine, column: endColumn } = node.loc.end

      let content = `${filename}:${line}:${column}-${endLine}:${endColumn}`

      const isTopLevel = context.parent?.type === 0 satisfies NodeTypes.ROOT // direct child of <template>
      if (isTopLevel) {
        content += ',isRoot'
        node.props.push({
          type: 6 satisfies NodeTypes.ATTRIBUTE,
          name: ATTR_KEY + '-isRoot',
          value: undefined,
          loc: getFakeLoc(),
          nameLoc: getFakeLoc(),
        })
      }

      node.props.push({
        type: 6 satisfies NodeTypes.ATTRIBUTE,
        name: ATTR_KEY,
        value: {
          type: 2 satisfies NodeTypes.TEXT,
          content,
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
    
    // if a component only have one root, the DOM element's __vnode is from the outer component's render
    // to allow "getInspectorDataFromElement" dive into the innermost vnode (aka current)
    // we mount this vnode to ctx.renderedRootVNode, where vnode.ctx === outerVNode.component
    if ('${ATTR_KEY}-isRoot' in vnode.props) {
      vnode.ctx["${VUE_INST_RENDERED_ROOT}"] = vnode
      delete vnode.props['${ATTR_KEY}-isRoot']
    }
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
