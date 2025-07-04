export class ShabbyVueHMRRuntime {
  deps: { [name: string]: any } = {}

  rememberDep(hmrId: string, deps: Record<string, any>) {
    this.deps[hmrId] = deps
  }

  getDeps(hmrId: string) {
    return this.deps[hmrId] || {}
  }

  reset() {
    this.deps = {}
  }
}
