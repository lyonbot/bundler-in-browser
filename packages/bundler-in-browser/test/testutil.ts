import SemVer from 'semver';
import path from 'path';
import type { MiniNPM } from '../src/MiniNPM.js';
import { InMemory, fs } from '@zenfs/core';
import { BundlerInBrowser } from 'bundler-in-browser';
import esbuild from "esbuild-wasm";
import type { BuildTreeNPMRegistry } from '@/npm/tree.js';
import { create as createResolver } from 'enhanced-resolve'

export function hookMiniNpm(npm: MiniNPM) {
  const $$latestVersion = Symbol('latestVersion')
  const mockRegistry: {
    [name: string]: {
      [$$latestVersion]: string,
      [version: string]: {
        main?: string,
        dependencies?: Record<string, string>,
        files?: Record<string, string>,
      }
    }
  } = {}

  npm.pourTarball = async (pkg, destDir) => {
    // guess version from url
    const { name, version } = pkg

    npm.fs.mkdirSync(destDir, { recursive: true })
    npm.fs.writeFileSync(`${destDir}/version`, version)  // for debug test only
    npm.fs.writeFileSync(`${destDir}/package.json`, JSON.stringify(await mockRegistryCtrl.getPackageJson(name, version), null, 2))

    const files = mockRegistry[name][version].files
    if (files) {
      for (const [fileName, fileContent] of Object.entries(files)) {
        const fullPath = `${destDir}/${fileName}`
        npm.fs.mkdirSync(path.dirname(fullPath), { recursive: true })
        npm.fs.writeFileSync(fullPath, fileContent)
      }
    }
  }
  npm.getRegistry = () => mockRegistryCtrl

  const mockRegistryCtrl: BuildTreeNPMRegistry = {
    getPackageJson: async (name, version) => {
      const mod = mockRegistry[name]
      if (!mod) throw new Error(`package ${name} not found`)
      if (!mod[version]) throw new Error(`package ${name}@${version} not found`)
      return {
        name,
        version,
        main: mod[version].main || 'index.js',
        dependencies: { ...mod[version].dependencies },
      }
    },
    getVersionList: async (name) => {
      const mod = mockRegistry[name]
      if (!mod) throw new Error(`package ${name} not found`)
      return {
        versions: Object.keys(mod).filter(x => typeof x === 'string'),
        tags: { latest: mod[$$latestVersion] },
      }
    },
  }

  const addMockPackage = (name: string, version: string, data: typeof mockRegistry[string][string]) => {
    mockRegistry[name] = mockRegistry[name] || {}
    mockRegistry[name][version] = data

    if (!mockRegistry[name][$$latestVersion] || SemVer.gt(version, mockRegistry[name][$$latestVersion])) {
      mockRegistry[name][$$latestVersion] = version
    }
  }

  return {
    addMockPackage,
    /** query the (nested) version of installed package */
    async ver(...pkgNames: string[]) {
      const invokeResolver = createResolver({
        fileSystem: npm.fs as any,
        exportsFields: [], // ignore "exports" field, so we can read package.json
        symlinks: true,
      })

      try {
        let currDir = '/'
        for (const pkg of pkgNames) {
          await new Promise<void>((resolve, reject) => {
            invokeResolver(currDir, `${pkg}/package.json`, (err, res) => {
              if (err) return reject(err);
              if (!res) return reject(new Error(`Cannot resolve ${pkg}`));

              currDir = path.dirname(res)
              resolve()
            })
          })
        }

        const versionFile = npm.fs.readFileSync(currDir + '/version', 'utf8') as string
        return versionFile
      } catch {
        return null
      }
    }
  }
}

/**
 * create and initialize a BundlerInBrowser instance for testing
 */
export async function createBundlerForTest(files: Record<string, string>) {
  fs.umount('/')
  fs.mount('/', InMemory.create(files));

  for (const file of Object.keys(files)) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, files[file])
  }

  const bundler = new BundlerInBrowser(fs as any);
  patchBundlerInit(bundler);

  await bundler.initialize();

  return { fs, bundler }
}

export async function patchBundlerInit(bundler: BundlerInBrowser) {
  bundler.initialize = () => {
    return bundler.initialized ||= (async () => {
      await initializeEsbuild();
      bundler.esbuild = esbuild as any;
    })()
  }
}

export async function initializeEsbuild() {
  return _esbuildInitializePromise ||= esbuild.initialize({});
}

let _esbuildInitializePromise: Promise<any> | undefined;
