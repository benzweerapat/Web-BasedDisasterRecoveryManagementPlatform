const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'ai-chat.service.js'), 'utf8'), {
    module, exports: module.exports, process, globalThis,
    require(name) {
      assert.equal(name, '../../db');
      return { pool: { run() { throw Error('Inventory must not be read while disabled'); } } };
    }
  });
  return module.exports;
}

test('an inherited provider key alone never enables AI or reads inventory', async () => {
  const ai = load();
  const env = { GEMINI_API_KEY: 'unit-test-placeholder' };
  assert.equal(ai.getAiStatus(env).configured, false);
  await assert.rejects(ai.askInventoryAssistant({ question: 'test', env }), error => error.code === 'AI_NOT_CONFIGURED');
});

test('AI requires both explicit opt-in and a provider key', () => {
  const ai = load();
  assert.equal(ai.getAiStatus({ AI_CHAT_ENABLED: 'true' }).configured, false);
  assert.equal(ai.getAiStatus({ AI_CHAT_ENABLED: 'false', GEMINI_API_KEY: 'unit-test-placeholder' }).configured, false);
  assert.equal(ai.getAiStatus({ AI_CHAT_ENABLED: 'true', GEMINI_API_KEY: 'unit-test-placeholder' }).configured, true);
});
