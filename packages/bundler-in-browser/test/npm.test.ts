import { fs, InMemory } from '@zenfs/core';
import { describe, expect, it } from 'vitest';
import { MiniNPM } from '../src/MiniNPM.js';
import { hookMiniNpm } from './testutil.js';

describe('npm', () => {
  it('works', async () => {
    fs.umount('/')
    fs.mount('/', InMemory.create({}));

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
    expect(fs.readdirSync('/node_modules').sort()).toEqual([
      '.store',
      'dirty',
      'react',
      'react-dom',  // hoisted
    ])

    // ----------------------------------------------
    // root install dirty@2

    expect(await npm.isAlreadySatisfied({ 'dirty': '*' })).toBe(true);
    expect(await npm.isAlreadySatisfied({ 'dirty': '1' })).toBe(true);
    expect(await npm.isAlreadySatisfied({ 'dirty': '^2.0.0' })).toBe(false);

    await npm.install({
      'react': 'latest',
      'dirty': '2.0.0',
    })

    expect(await npm.isAlreadySatisfied({ 'dirty': '^2.0.0' })).toBe(true);

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
    expect(fs.readdirSync('/node_modules/.store').sort()).toEqual([
      "dirty@2.0.0",
      "lock.json",
    ])
  })
})

