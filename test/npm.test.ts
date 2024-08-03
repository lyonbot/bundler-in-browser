import { describe, expect, it } from 'vitest';
import { MiniNPM } from '../src/npm';
import { memfs } from 'memfs';
import SemVer from 'semver';
import { memoAsync } from '../src/utils';

describe('npm', () => {
  it('works', async () => {
    const { fs } = memfs();
    const npm = new MiniNPM(fs);
    const hook = hookMiniNpm(npm);

    // ----------------------------------------------

    hook.addMockPackage('dirty', '1.0.0', {})
    hook.addMockPackage('dirty', '1.2.0', {})
    hook.addMockPackage('dirty', '2.0.0', {})
    hook.addMockPackage('react', '18.2.0', {
      dependencies: {
        'react-dom': '^18.0.0',
        'dirty': '^1.0.0',
      },
    })
    hook.addMockPackage('react-dom', '18.2.0', {
      dependencies: {
        'dirty': '^1.0.0',
      }
    })

    // ----------------------------------------------

    await npm.install({
      react: 'latest',
    })

    // check hoisted
    expect(fs.readdirSync('/node_modules')).toEqual([
      '.store',
      'dirty',
      'react',
      'react-dom',  // hoisted
    ])

    // ----------------------------------------------
    // root install dirty@2

    await npm.install({
      'react': 'latest',
      'dirty': '2.0.0',
    })

    expect(hook.ver('dirty')).toEqual('2.0.0')
    expect(hook.ver('react', 'dirty')).toEqual('1.2.0')
    expect(hook.ver('react', 'react-dom', 'dirty')).toEqual('1.2.0')

    // ----------------------------------------------
    // delete react

    await npm.install({
      'dirty': '2.0.0',
    })

    expect(hook.ver('dirty')).toEqual('2.0.0')
    expect(hook.ver('react')).toEqual(null)
    expect(fs.readdirSync('/node_modules/.store')).toEqual([
      "dirty@2.0.0",
      "lock.json",
    ])
  })
})


function hookMiniNpm(npm: MiniNPM) {
  const $$latestVersion = Symbol('latestVersion')
  const mockRegistry: {
    [name: string]: {
      [$$latestVersion]: string,
      [version: string]: {
        dependencies?: Record<string, string>,
      }
    }
  } = {}

  npm.pourTarball = async (tarballUrl, destDir) => {
    // guess version from url
    let markPos = tarballUrl.lastIndexOf('/')
    let version = tarballUrl.slice(markPos + 1)

    npm.fs.mkdirSync(destDir, { recursive: true })
    npm.fs.writeFileSync(`${destDir}/version`, version)
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
    if (!p) return null

    return {
      dependencies: {},
      ...p,
      dist: {
        shasum: '123',
        tarball: `http://localhost/${name}/version/${version}`,
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