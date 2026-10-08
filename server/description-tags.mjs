import { extractTags } from './tags.mjs';

// Mentions describe this exact text, not every fact known about the recipe.
// The dictionary is deliberately conservative; this is not semantic verification.
export function describeText(text, sourceTags = [], requestedStyle = null) {
  const allowed = new Map(sourceTags.map((tag) => [tag.id, tag]));
  const mentioned = extractTags({ name: text, ingredients: [text], method: text })
    .filter((tag) => allowed.has(tag.id))
    .map((tag) => ({
      ...tag,
      evidence: { field: 'description', text: tag.evidence.text },
      sourceEvidence: allowed.get(tag.id).evidence,
    }));
  return {
    version: 'description-tags-v1',
    method: 'source-grounded-dictionary',
    mentioned,
    short: text.length <= 100,
    charLength: text.length,
    requestedStyle,
  };
}

export function describeChannels(texts, sourceTags, requestedStyle = null) {
  return Object.fromEntries(
    Object.entries(texts).map(([channel, text]) => [
      channel,
      describeText(text, sourceTags, requestedStyle),
    ]),
  );
}
