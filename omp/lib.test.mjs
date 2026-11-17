import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editsFromMessages, editsFromPatch, substitute, substituteMessages } from './lib.mjs';
import { nudgeMessage } from '../hooks/classify.mjs';

const VARS = { CLAUDE_PROJECT_DIR: '/work/app', CLAUDE_PLUGIN_ROOT: '/plugins/qualflare' };

test('substitute fills only the braced placeholders', () => {
  assert.equal(
    substitute('mkdir -p "${CLAUDE_PROJECT_DIR}/.qualflare" && cat ${CLAUDE_PLUGIN_ROOT}/x', VARS),
    'mkdir -p "/work/app/.qualflare" && cat /plugins/qualflare/x',
  );
  assert.equal(substitute('echo $CLAUDE_PROJECT_DIR', VARS), 'echo $CLAUDE_PROJECT_DIR');
  assert.equal(substitute('${CLAUDE_OTHER}', VARS), '${CLAUDE_OTHER}');
});

test('substituteMessages rewrites tool results and user text, not assistant turns', () => {
  const messages = [
    { role: 'user', content: 'Run ${CLAUDE_PROJECT_DIR}' },
    { role: 'assistant', content: [{ type: 'text', text: 'I will read ${CLAUDE_PROJECT_DIR}' }] },
    { role: 'toolResult', toolCallId: 't1', content: [{ type: 'text', text: 'Read `${CLAUDE_PROJECT_DIR}/.qualflare/test-state.md`' }] },
  ];
  const out = substituteMessages(messages, VARS);
  assert.equal(out[0].content, 'Run /work/app');
  assert.equal(out[1], messages[1]);
  assert.equal(out[2].content[0].text, 'Read `/work/app/.qualflare/test-state.md`');
  assert.equal(messages[2].content[0].text.includes('${CLAUDE_PROJECT_DIR}'), true, 'input not mutated');
});

test('substituteMessages returns null when nothing changes', () => {
  assert.equal(substituteMessages([{ role: 'user', content: 'hi' }], VARS), null);
});

test('editsFromPatch reads every [PATH#TAG] header', () => {
  const edits = editsFromPatch('[src/a.ts#A1B2]\nPUT 3.=3:\n+const x = 2;\n[src/b.ts#3C4D]\nPUT >2:\n+one\n+two');
  assert.deepEqual(edits, [
    { path: 'src/a.ts', trivial: true },
    { path: 'src/b.ts', trivial: false },
  ]);
  assert.deepEqual(editsFromPatch('[src/c.ts#ABCD]\nCUT 4.=9'), [{ path: 'src/c.ts', trivial: false }]);
  assert.deepEqual(editsFromPatch(undefined), []);
});

const call = (name, args) => ({ role: 'assistant', content: [{ type: 'toolCall', id: name, name, arguments: args }] });

test('editsFromMessages finds write and edit calls', () => {
  const edits = editsFromMessages([
    call('read', { path: 'src/a.ts' }),
    call('write', { path: 'src/new.ts', content: 'x' }),
    call('edit', { input: '[src/a.ts#A1B2]\nPUT 1.=1:\n+y' }),
  ]);
  assert.deepEqual(edits, [
    { path: 'src/new.ts', trivial: false },
    { path: 'src/a.ts', trivial: true },
  ]);
});

test('omp session edits drive the same nudge rules', () => {
  const sourceOnly = editsFromMessages([call('write', { path: '/work/app/src/pay.ts', content: 'x' })]);
  assert.match(nudgeMessage(sourceOnly, '/skill:qf-cover'), /1 source file\(s\).*\/skill:qf-cover/);
  const withTest = editsFromMessages([
    call('write', { path: '/work/app/src/pay.ts', content: 'x' }),
    call('write', { path: '/work/app/src/pay.test.ts', content: 'x' }),
  ]);
  assert.equal(nudgeMessage(withTest), null);
});
