export const KEY_PROPS_DATA = '__v_inspector'
export const ATTR_KEY = 'data-v-inspector'

/** RPC actions exposed from runtime. can be invoked by editor */
export type InspectorRuntimeApi = {
  selectElementByClick(): Promise<void | {
    uniqueSelector: string,
    type: 'node' | 'component',
    loc: {
      start: { line: number, column: number },
      end: { line: number, column: number },
      source: string,
    },
  }>
}

/** RPC actions exposed from editor. can be invoked by runtime */
export type InspectorEditorApi = {

}