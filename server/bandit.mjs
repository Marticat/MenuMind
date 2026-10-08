import { randomInt } from 'node:crypto';
import { tagCatalog } from './tags.mjs';
import { descriptionStyles } from './description-styles.mjs';

// Bump when features, their ordering, normalization or arm meanings change.
export const MODEL_VERSION = 'linucb-descriptions-v2-tags';
export const ALPHA = 0.5;
export const arms = Object.keys(descriptionStyles);

export function buildContext(customer, recipe, channel, history = {}, descriptionTags = null) {
  const preferred = new Set(customer.preferredTags);
  const tags = new Set(recipe.tags.map((tag) => tag.id));
  const mentions = new Set(descriptionTags?.mentioned.map((tag) => tag.id) ?? []);
  const features = [
    1,
    ...arms.map((arm) => Number(customer.descriptionPreference === arm)),
    Number(customer.language === 'kk'),
    ...['yandex', 'wolt', 'website', 'print'].map((id) => Number(channel === id)),
    ...tagCatalog.map((tag) => Number(preferred.has(tag.id))),
    ...tagCatalog.map((tag) => Number(tags.has(tag.id))),
    ...tagCatalog.map((tag) => Number(preferred.has(tag.id) && tags.has(tag.id))),
    ...arms.map((arm) => {
      const { rewards = 0, observations = 0 } = history[arm] ?? {};
      return (rewards + 1) / (observations + 2);
    }),
    ...tagCatalog.map((tag) => Number(mentions.has(tag.id))),
    ...tagCatalog.map((tag) => Number(preferred.has(tag.id) && mentions.has(tag.id))),
    Number(descriptionTags?.short ?? false),
    Math.min(descriptionTags?.charLength ?? 0, 2000) / 2000,
  ];
  const norm = Math.hypot(...features);
  return features.map((value) => value / norm);
}

export function initialModel(dimension) {
  return {
    a: Array.from({ length: dimension }, (_, i) =>
      Array.from({ length: dimension }, (_, j) => Number(i === j)),
    ),
    b: Array(dimension).fill(0),
    observations: 0,
  };
}

// Cholesky solves avoid explicitly inverting the positive definite ridge matrix.
function factor(a) {
  const l = a.map((row) => row.map(() => 0));
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j <= i; j++) {
      let value = a[i][j];
      for (let k = 0; k < j; k++) value -= l[i][k] * l[j][k];
      l[i][j] = i === j ? Math.sqrt(value) : value / l[j][j];
    }
  }
  return l;
}

function solve(l, vector) {
  const y = [];
  const result = [];
  for (let i = 0; i < l.length; i++) {
    let value = vector[i];
    for (let j = 0; j < i; j++) value -= l[i][j] * y[j];
    y[i] = value / l[i][i];
  }
  for (let i = l.length - 1; i >= 0; i--) {
    let value = y[i];
    for (let j = i + 1; j < l.length; j++) value -= l[j][i] * result[j];
    result[i] = value / l[i][i];
  }
  return result;
}
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);

export function scoreArm(model, context, alpha = ALPHA) {
  const l = factor(model.a);
  const estimate = dot(context, solve(l, model.b));
  const uncertainty = Math.sqrt(Math.max(0, dot(context, solve(l, context))));
  return { estimate, uncertainty, score: estimate + alpha * uncertainty };
}

export function chooseArm(models, context, candidates, preference = 'auto', alpha = ALPHA) {
  const scores = candidates.map((arm) => ({
    arm,
    ...scoreArm(
      models[arm] ?? initialModel((Array.isArray(context) ? context : context[arm]).length),
      Array.isArray(context) ? context : context[arm],
      alpha,
    ),
  }));
  const maximum = Math.max(...scores.map((item) => item.score));
  const ties = scores.filter((item) => Math.abs(item.score - maximum) < 1e-10);
  // Declared preference breaks equal UCB scores, including the first request.
  const chosen = ties.find((item) => item.arm === preference) ?? ties[randomInt(ties.length)];
  return { arm: chosen.arm, scores };
}

export function updateModel(model, context, reward) {
  return {
    a: model.a.map((row, i) => row.map((value, j) => value + context[i] * context[j])),
    b: model.b.map((value, i) => value + reward * context[i]),
    observations: model.observations + 1,
  };
}
