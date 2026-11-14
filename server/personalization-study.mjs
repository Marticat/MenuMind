import { demonstrationDishes } from './demo-recipes.mjs';
import { defaultProfile } from './db.mjs';
import { loadConfig } from './config.mjs';
import { generateDescription } from './generation.mjs';
import { extractTags } from './tags.mjs';
import {
  arms,
  ALPHA,
  MODEL_VERSION,
  buildContext,
  chooseArm,
  initialModel,
  updateModel,
} from './bandit.mjs';

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const guests = ['chicken', 'beef', 'fish', 'rice', 'mushrooms', 'vegetables'].map((tag, i) => ({
  id: `sim-guest-${i + 1}`,
  name: `Тестовый гость ${i + 1}`,
  language: i % 2 ? 'kk' : 'ru',
  descriptionPreference: 'auto',
  preferredTags: [tag],
}));
const scenarios = [
  {
    id: 'personalized',
    title: 'У гостей разные предпочтения',
    rule: 'P(add)=0.65 for the hidden preferred style, 0.15 otherwise. Hidden styles cycle across six guest profiles.',
  },
  {
    id: 'no-effect',
    title: 'Описание не влияет на реакцию',
    rule: 'P(add)=0.30 for every guest and style. Paired outcome draws give identical outcomes for all policies.',
  },
  {
    id: 'common-preference',
    title: 'Всем нравится краткий вариант',
    rule: 'P(add)=0.65 for concise, 0.15 otherwise, regardless of guest.',
  },
];
const policyNames = { linucb: 'LinUCB', random: 'Случайный выбор', fixed: 'Всегда кратко' };

export async function runStudy({ seeds = [7, 19, 42], steps = 300 } = {}) {
  if (
    !Array.isArray(seeds) ||
    !seeds.length ||
    seeds.some((s) => !Number.isInteger(s)) ||
    !Number.isInteger(steps) ||
    steps < 12 ||
    steps > 2000
  )
    throw new Error('Provide integer seeds and 12..2000 steps');
  const catalog = [];
  for (const { recipe, language } of demonstrationDishes) {
    const variants = {};
    for (const style of arms) {
      const result = await generateDescription({
        recipe,
        language,
        descriptionStyle: style,
        tone: 'editorial',
        profile: defaultProfile('Simulation'),
        config: loadConfig({}).llm,
      });
      variants[style] = { text: result.texts.website, tags: result.descriptionTags.website };
    }
    catalog.push({ recipe: { ...recipe, tags: extractTags(recipe) }, language, variants });
  }
  const results = [];
  for (const scenario of scenarios) {
    const events = [];
    for (const seed of seeds) {
      // Independent RNG streams: choosing an arm must not change future guests or rewards.
      const inputRandom = seededRandom(seed);
      const tieRandom = seededRandom(seed + 1000);
      const baselineRandom = seededRandom(seed + 2000);
      const models = {};
      const histories = {};
      for (let step = 0; step < steps; step++) {
        const guestIndex = Math.floor(inputRandom() * guests.length);
        const guest = guests[guestIndex];
        const eligible = catalog.filter((d) => d.language === guest.language);
        const dish = eligible[Math.floor(inputRandom() * eligible.length)];
        const history = (histories[guest.id] ??= {});
        const contexts = Object.fromEntries(
          arms.map((arm) => [
            arm,
            buildContext(guest, dish.recipe, 'website', history, dish.variants[arm].tags),
          ]),
        );
        for (const arm of arms) models[arm] ??= initialModel(contexts[arm].length);
        const selected = {
          linucb: chooseArm(models, contexts, arms, 'auto', ALPHA, (n) =>
            Math.floor(tieRandom() * n),
          ).arm,
          random: arms[Math.floor(baselineRandom() * arms.length)],
          fixed: 'concise',
        };
        // Hidden environment is evaluated AFTER choice, never passed to the learner.
        const preferred =
          scenario.id === 'common-preference' ? 'concise' : arms[guestIndex % arms.length];
        const draw = inputRandom();
        const probabilities = Object.fromEntries(
          arms.map((arm) => [
            arm,
            scenario.id === 'no-effect' ? 0.3 : arm === preferred ? 0.65 : 0.15,
          ]),
        );
        const decisions = Object.fromEntries(
          Object.entries(selected).map(([policy, arm]) => [
            policy,
            { style: arm, reward: Number(draw < probabilities[arm]) },
          ]),
        );
        const { style, reward } = decisions.linucb;
        models[style] = updateModel(models[style], contexts[style], reward);
        const previous = history[style] ?? { observations: 0, rewards: 0 };
        history[style] = {
          observations: previous.observations + 1,
          rewards: previous.rewards + reward,
        };
        events.push({
          seed,
          step: step + 1,
          guestId: guest.id,
          recipeId: dish.recipe.id,
          probabilities,
          draw,
          decisions,
        });
      }
    }
    const policies = Object.entries(policyNames).map(([id, label]) => {
      const additions = events.reduce((sum, e) => sum + e.decisions[id].reward, 0);
      return {
        id,
        label,
        impressions: events.length,
        additions,
        rate: additions / events.length,
        bySeed: seeds.map((seed) => ({
          seed,
          impressions: steps,
          additions: events
            .filter((e) => e.seed === seed)
            .reduce((sum, e) => sum + e.decisions[id].reward, 0),
        })),
      };
    });
    results.push({ ...scenario, policies, events });
  }
  return {
    version: 'personalization-simulation-v1',
    dataSource: 'synthetic',
    realOrderUpliftEstablished: false,
    modelVersion: MODEL_VERSION,
    alpha: ALPHA,
    seeds,
    stepsPerSeed: steps,
    guestCount: guests.length,
    dishCount: catalog.length,
    scope:
      'Synthetic add-to-cart events; not real purchases, a causal effect estimate, or a forecast. No live/demo database models are read or written.',
    protocol:
      'Same guest/dish/outcome stream for all policies; fresh LinUCB per seed/scenario; only chosen-arm feedback used. Existing production context features and alpha, no tuning on these outcomes.',
    guests,
    scenarios: results,
  };
}
