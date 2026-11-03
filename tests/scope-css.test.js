import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeSelector } from '../scripts/scope-css.mjs';

test('scopes actual document selectors without corrupting workbench class names or attributes', () => {
  for (const selector of ['.sftp-body', '.terminal-body', '.modal-body', '.html-preview', '#app-sidebar', '[data-target="body"]', '.foo\\:root']) {
    assert.equal(scopeSelector(selector), '#dsh-ssh-root ' + selector);
  }
  assert.equal(scopeSelector('html[data-dbx-theme="dark"] .sftp-body'), '#dsh-ssh-root[data-dbx-theme="dark"] .sftp-body');
  assert.equal(scopeSelector('body > #app'), '#dsh-ssh-root > .ssh-vue-mount');
  assert.equal(scopeSelector(':root'), '#dsh-ssh-root');
  assert.equal(scopeSelector('.popover :is(button, input)'), '#dsh-ssh-root .popover :is(button, input)');
});
