import { type RootNode, type SourceLocation, type TemplateChildNode } from '@vue/compiler-core'

const EXCLUDE_TAG = ['template', 'script', 'style']
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
export const vueInspectorNodeTransform = (node: TemplateChildNode | RootNode) => {
  const filename = 'Foo.vue'

  if (node.type === 1) {
    if ((node.tagType === 0 || node.tagType === 1) && !EXCLUDE_TAG.includes(node.tag)) {
      const { line, column } = node.loc.start
      node.props.push({
        type: 6,
        name: ATTR_KEY,
        value: {
          type: 2,
          content: `${filename}:${line}:${column}`,
          loc: getFakeLoc(),
        },
        loc: getFakeLoc(),
        nameLoc: getFakeLoc(),
      })
    }
  }
}
