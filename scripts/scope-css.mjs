import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const parser = require('postcss-selector-parser');

export function scopeSelector(selector) {
  const tree = parser().astSync(selector);
  tree.each(rule => {
    rule.walkTags(node => {
      if (node.value === 'html' || node.value === 'body') node.replaceWith(parser.id({ value: 'dsh-ssh-root' }));
    });
    rule.walkPseudos(node => {
      if (node.value === ':root') node.replaceWith(parser.id({ value: 'dsh-ssh-root' }));
    });
    rule.walkIds(node => {
      if (node.value === 'app') node.replaceWith(parser.className({ value: 'ssh-vue-mount' }));
    });
    if (rule.first?.type !== 'id' || rule.first.value !== 'dsh-ssh-root') {
      rule.prepend(parser.combinator({ value: ' ' }));
      rule.prepend(parser.id({ value: 'dsh-ssh-root' }));
    }
  });
  return tree.toString();
}
