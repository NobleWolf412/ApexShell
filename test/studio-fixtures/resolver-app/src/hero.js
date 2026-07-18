// Resolver fixture — the hero module. Line positions are load-bearing for
// the drill's tier-b assertions; append below rather than reflowing.
'use strict';

function mountHero(root) {
  const cta = root.querySelector('.hero-cta');
  cta.textContent = 'Get started';
  cta.addEventListener('click', function () { console.log('hero: start'); });
}

module.exports = { mountHero };
