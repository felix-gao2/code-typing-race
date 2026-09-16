import { randomInt } from 'node:crypto';
import { parseArgs } from 'node:util';
import { TIERS, type Tier } from './config.ts';
import { generateSnippet, LANGUAGES, type Language } from './index.ts';

const { values } = parseArgs({
  options: {
    seed: { type: 'string', short: 's' },
    lang: { type: 'string', short: 'l', default: 'java' },
    tier: { type: 'string', short: 't', default: 'medium' },
    count: { type: 'string', short: 'n', default: '1' },
  },
});

const language = values.lang as Language;
if (!LANGUAGES.includes(language)) {
  throw new Error(`unknown language: ${values.lang} (have: ${LANGUAGES.join(', ')})`);
}

const tier = values.tier as Tier;
if (!(tier in TIERS)) {
  throw new Error(`unknown tier: ${values.tier} (have: ${Object.keys(TIERS).join(', ')})`);
}

const count = Number(values.count);
if (!Number.isInteger(count) || count < 1) {
  throw new Error(`--count must be a positive integer, got: ${values.count}`);
}

// No seed given means "show me something new" — printed so any snippet a
// reader likes can be reproduced exactly.
const baseSeed = values.seed === undefined ? randomInt(2 ** 31) : Number(values.seed);
if (!Number.isInteger(baseSeed)) {
  throw new Error(`--seed must be an integer, got: ${values.seed}`);
}

for (let i = 0; i < count; i += 1) {
  const seed = baseSeed + i;
  const snippet = generateSnippet({ seed, language, tier });
  if (count > 1) {
    console.log(`\n=== seed ${seed} · ${language} · ${tier} · ${snippet.length} chars ===`);
  }
  console.log(snippet);
}
