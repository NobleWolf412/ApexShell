'use strict';

const assert = require('assert');
const { linkifyEscaped } = require('../renderer/linkify');
const { normalizeExternalUrl } = require('../main/externalUrl');

const https = linkifyEscaped('Open https://github.com/login/device');
assert.match(https, />https:\/\/github\.com\/login\/device<\/a>/);
assert.match(https, /class="webLink"/);
assert.doesNotMatch(https, /class="pathLink"/);
assert.doesNotMatch(https, />s:\/\/github/);

const windows = linkifyEscaped('Open C:\\Users\\Matt\\ApexShell');
assert.match(windows, /class="pathLink"/);
assert.match(windows, /data-path="C:\\Users\\Matt\\ApexShell"/);

const punctuated = linkifyEscaped('(C:\\temp\\file.txt), next');
assert.match(punctuated, /data-path="C:\\temp\\file\.txt"/);
assert.match(punctuated, />C:\\temp\\file\.txt<\/a>\), next$/);

const markdown = linkifyEscaped('Visit [GitHub](https://github.com/Ir8code/ApexShell).');
assert.match(markdown, /^Visit GitHub \(<a class="webLink"/);
assert.match(markdown, />https:\/\/github\.com\/Ir8code\/ApexShell<\/a>\)\.$/);

assert.equal(normalizeExternalUrl('https://github.com/Ir8code/ApexShell'),
  'https://github.com/Ir8code/ApexShell');
assert.equal(normalizeExternalUrl('http://example.com'), 'http://example.com/');
assert.equal(normalizeExternalUrl('javascript:alert(1)'), null);
assert.equal(normalizeExternalUrl('file:///C:/Windows'), null);
assert.equal(normalizeExternalUrl('https://user:pass@example.com'), null);

// ---- XSS contract (audit L7): the safety property is that a linkified URL
// can't break out of data-url="…". It rests on LINK_RE excluding " ' < > — pin
// it so loosening that char-class fails loudly here instead of silently.
(function xssContract() {
  // a URL carrying a double-quote must NOT produce a quote inside the emitted
  // attribute (which would let the rest become new attributes / a handler)
  const q = linkifyEscaped('see https://evil.test/"onmouseover="alert(1)');
  const attr = (q.match(/data-url="([^"]*)"/) || [])[1] || '';
  assert.ok(!attr.includes('"'), 'no quote may survive inside data-url');
  assert.ok(!attr.includes('onmouseover'), 'breakout payload must not enter the attribute');
  // angle brackets can't be smuggled into a URL either (tag injection)
  const lt = linkifyEscaped('https://evil.test/<script>x</script>');
  const lattr = (lt.match(/data-url="([^"]*)"/) || [])[1] || '';
  assert.ok(!/[<>]/.test(lattr), 'no < or > may survive inside data-url');
  // linkify only recognizes http(s)/drive paths — a javascript: URL is inert
  const js = linkifyEscaped('click javascript:alert(1)');
  assert.doesNotMatch(js, /<a /, 'javascript: is never linkified');
  // linkify assumes ALREADY-ESCAPED input: it must not itself introduce a raw
  // < that wasn't a link (it doesn't unescape; a lone bracket passes through)
  const plain = linkifyEscaped('a &lt;b&gt; c');
  assert.equal(plain, 'a &lt;b&gt; c', 'non-link text is left untouched');
})();

console.log('linkify drill: PASS (incl. XSS contract)');
