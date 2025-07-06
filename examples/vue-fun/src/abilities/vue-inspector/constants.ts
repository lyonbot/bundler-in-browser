/**
 * extra information is mounted to `vnode.props[KEY_PROPS_DATA]` for vue-inspector
 * 
 * format:
 * 
 * - /foo/bar.vue:2:2-4:30
 * - /foo/bar.vue:2:2-4:30,isRoot     - this is component's root nodes (direct child of <template>)
 */
export const KEY_PROPS_DATA = '__v_inspector'

/**
 * this is injected to render function as each node's attribute.
 */
export const ATTR_KEY = 'data-v-inspector'

/**
 * if a component only have one root, the DOM element's `__vnode` is the one from outer component's render.
 * 
 * to allow "getInspectorDataFromElement" dive into the innermost vnode (aka current)
 * we mount the rendered root vnode, to its ctx.renderedRootVNode,
 * where `outerVNode.component === innerVnode.ctx` and `outerVNode.component.renderedRootVNode` is the rendered root vnode
 */
export const VUE_INST_RENDERED_ROOT = 'renderedRootVNode'

/** RPC actions exposed from runtime. can be invoked by editor */
export type InspectorRuntimeApi = {
  selectElementByClick(): Promise<{
    clientX: number,
    clientY: number,

    nodes: Array<InspectorRuntimeApi.PickResultNode>
  }>
}

export namespace InspectorRuntimeApi {
  export type PickResultNode = {
    rect: { left: number, top: number, width: number, height: number },
    type: 'node' | 'component',
    loc: {
      start: { line: number, column: number },
      end: { line: number, column: number },
      source: string,
    },
  }
}

/** RPC actions exposed from editor. can be invoked by runtime */
export type InspectorEditorApi = {
  setHoveringNode(data: InspectorRuntimeApi.PickResultNode | null): Promise<void>
}
