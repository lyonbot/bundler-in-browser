import SemVer from 'semver';
import path from 'path';
import { memoAsync } from '../src/utils.js';
import type { MiniNPM } from '../src/MiniNPM.js';
import { InMemory, fs } from '@zenfs/core';
import { BundlerInBrowser } from 'bundler-in-browser';
import esbuild from "esbuild-wasm";

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

  npm.pourTarball = async (tarballUrl, destDir) => {
    // guess version from url
    let versionMarkPos = tarballUrl.lastIndexOf('/-/')
    let version = tarballUrl.slice(versionMarkPos + 3)
    let name = tarballUrl.slice(tarballUrl.indexOf('/package/') + 9, versionMarkPos)

    npm.fs.mkdirSync(destDir, { recursive: true })
    npm.fs.writeFileSync(`${destDir}/version`, version)
    npm.fs.writeFileSync(`${destDir}/package.json`, JSON.stringify({
      name,
      version,
      main: mockRegistry[name][version].main || 'index.js',
      dependencies: { ...mockRegistry[name][version].dependencies },
    }))

    const files = mockRegistry[name][version].files
    if (files) {
      for (const [fileName, fileContent] of Object.entries(files)) {
        const fullPath = `${destDir}/${fileName}`
        npm.fs.mkdirSync(path.dirname(fullPath), { recursive: true })
        npm.fs.writeFileSync(fullPath, fileContent)
      }
    }
  }
  npm.getPackageVersions = async (name) => {
    if (!mockRegistry[name]) return { versions: [], tags: {} }

    const versions = Object.keys(mockRegistry[name]).filter(x => typeof x === 'string')
    const tags = {
      latest: mockRegistry[name][$$latestVersion],
    }

    return { versions, tags }
  }
  npm.getPackageJson = memoAsync(async (name, version) => {
    let p = mockRegistry[name]?.[version]
    if (!p) throw new Error(`package ${name}@${version} not found`)

    return {
      name,
      version,
      dependencies: {},
      ...p,
      dist: {
        shasum: '123',
        tarball: `http://localhost/package/${name}/-/${version}`,
        integrity: '123',
      }
    }
  })

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
    ver(...pkgNames: string[]) {
      try {
        const path = pkgNames.map(x => '/node_modules/' + x).join('')
        return npm.fs.readFileSync(path + '/version', 'utf8') as string
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

  const bundler = new BundlerInBrowser(fs);
  bundler.initialized = _esbuildInitializePromise ||= esbuild.initialize({});
  // await bundler.initialize(); 

  return { fs, bundler }
}

let _esbuildInitializePromise: Promise<any> | undefined;
