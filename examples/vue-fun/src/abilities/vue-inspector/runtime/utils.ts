import { elToSelector } from "@/utils/selector"
import { KEY_PROPS_DATA, VUE_INST_RENDERED_ROOT, type InspectorRuntimeApi } from "../constants"
import type { Nil } from "yon-utils"

/**
 * for runtime, try to get the `data-v-inspector` attribute from an element.
 * 
 * this will try to get the innermost (which is usually normal HTML tag, not a component)
 */
export function getInspectorDataFromElement(el: any): InspectorDataFromElement | null {
    while (el && !getTheDataFromVNode(el.__vnode, el)) el = el.parentElement
    if (!el) return null

    const vnode = getInnermostVNode(el)
    const str = getTheDataFromVNode(vnode, el)
    return parseDataStr(el, str)
}

function getTheDataFromVNode(vnode: any, el: any) {
    if (!vnode) return null

    let v0 = vnode.props?.[KEY_PROPS_DATA]
    if (v0) return v0

    const ctxVNode = vnode?.ctx?.vnode
    if (el && ctxVNode && ctxVNode.el === el)
        return ctxVNode.props?.[KEY_PROPS_DATA]
}

function getInnermostVNode(el: any) {
    let vnode = el?.__vnode

    // ensure vnode is in the most inner component
    // use the inject `ctx.renderedRootVNode` to get the root vnode
    while (vnode?.component && getTheDataFromVNode(vnode, null)) {
        let nextVNode = vnode.component[VUE_INST_RENDERED_ROOT]
        if (!nextVNode) break  // seems not a component from user code
        vnode = nextVNode
    }
    return vnode
}

// FIXME: don't know why needed?
//
// function getComponentData(el: any) {
//     return undefined
//     const ctxVNode = el?.__vnode?.ctx?.vnode
//     if (ctxVNode?.el === el)
//         return ctxVNode?.props?.[KEY_PROPS_DATA]
// }

/**
 * @see KEY_PROPS_DATA - its comment described the format
 */
function parseDataStr(el: HTMLElement, str: any): InspectorDataFromElement | null {
    if (!el || !str || typeof str !== 'string') return null

    const loc = str.match(/:(\d+):(\d+)(?:-(\d+):(\d+))?((?:,\w+)*)$/)
    if (!loc) return null

    const toInt = (s: string) => parseInt(s, 10)
    const [, sLine, sCol, eLine = sLine, eCol = sCol, flagsRaw] = loc
    const flags = flagsRaw ? flagsRaw.slice(1).split(',') : undefined
    return {
        start: { line: toInt(sLine), column: toInt(sCol) },
        end: { line: toInt(eLine), column: toInt(eCol) },
        source: str.slice(0, loc.index),
        isRoot: !!flags?.includes('isRoot'),
        element: el,
    }
}

export interface InspectorDataFromElement {
    start: { line: number, column: number },
    end: { line: number, column: number },
    source: string,
    /** is component's root nodes (direct child of <template>) */
    isRoot?: boolean,
    element: HTMLElement,
}
/**
 * generate the format for communicating between editor
 * 
 * @param info - optional, if not set, will call `getInspectorDataFromElement(el)` to retrieve
 * @returns related nodes. inner node goes first, outer node goes last.
 */
export function toPickResultNodes(info: InspectorDataFromElement | Nil, withAncestors?: boolean): InspectorRuntimeApi.PickResultNode[] {
    if (!info) return []

    const results: InspectorRuntimeApi.PickResultNode[] = []
    let el = info.element

    // if (withAncestors) debugger
    do {
        const { x, y, width, height } = el.getBoundingClientRect()
        const selector = elToSelector(el)

        results.push({
            rect: { x, y, width, height },
            type: 'node',
            selector,
            loc: {
                start: { line: info.start.line, column: info.start.column },
                end: { line: info.end.line, column: info.end.column },
                source: info.source,
            },
        })

        // if is component's root nodes (direct child of <template>)
        // complete with its outer vnode
        if (info.isRoot) {
            let vnode = getInnermostVNode(el)?.ctx?.vnode
            while (vnode) {
                const parentInfo = parseDataStr(el, getTheDataFromVNode(vnode, null))
                if (!parentInfo) break

                results.push({
                    rect: { x, y, width, height },
                    type: 'component',
                    selector,
                    loc: {
                        start: { line: parentInfo.start.line, column: parentInfo.start.column },
                        end: { line: parentInfo.end.line, column: parentInfo.end.column },
                        source: parentInfo.source,
                    },
                })

                if (!parentInfo.isRoot) break  // no more recursive
                // otherwise, continue to find out its parent
                vnode = vnode.ctx?.vnode
            }
        }

        if (!withAncestors || !el.parentElement) break;
        el = el.parentElement
        info = getInspectorDataFromElement(el)
    } while (el && info);

    return results
}

export const toPickResultNodesWithAncestors = (info: InspectorDataFromElement | Nil) => toPickResultNodes(info, true)
