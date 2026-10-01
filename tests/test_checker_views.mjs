import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { checkerViews } from '../tools/check/check_resources.mjs'

const base = path.resolve('assets')
const output = path.resolve('debug/check')
const manifest = {
  controller: [{ name: 'adb' }],
  resource: [
    { name: 'A', path: ['./resource', './resource_a'] },
    { name: 'B', path: ['./resource', './resource_b'] }
  ],
  task: [
    { name: 'A', entry: 'A_Start', resource: ['A'] },
    { name: 'B', entry: 'B_Start', resource: ['B'] },
    { name: 'common', entry: 'Common' },
    { name: 'other controller', entry: 'Other', controller: ['win32'] }
  ]
}

test('each view checks only supported tasks and preserves their actual entries', () => {
  const original = structuredClone(manifest)
  const views = checkerViews(manifest, base, output)
  assert.deepEqual(views.map(v => v.task.map(t => t.entry)), [['A_Start', 'Common'], ['B_Start', 'Common']])
  assert.equal(path.resolve(output, views[1].resource[0].path[1]), path.join(base, 'resource_b'))
  assert.deepEqual(manifest, original)
})

test('a broken active entry is retained for maa-checker to reject', () => {
  const broken = structuredClone(manifest)
  broken.task[0].entry = 'Missing'
  assert.equal(checkerViews(broken, base, output)[0].task[0].entry, 'Missing')
})

test('unsupported imported task declarations fail instead of silently skipping validation', () => {
  assert.throws(() => checkerViews({ ...manifest, import: ['tasks.json'] }, base, output), /PI import/)
})
