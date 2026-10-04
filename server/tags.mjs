// Conservative dictionary extraction: evidence is always an actual source field.
// Dietary suitability and absence of allergens are deliberately not inferred.
export const tagRules = [
  ['beef', 'Говядина', 'ingredient', 'говя[дж]|сиыр|beef'],
  ['chicken', 'Курица', 'ingredient', 'куриц|курин|тауық|chicken'],
  ['lamb', 'Баранина', 'ingredient', 'баран|қой|lamb'],
  ['fish', 'Рыба', 'ingredient', 'рыб|лосос|семг|сёмг|тунец|балық|албырт|salmon|tuna|fish'],
  ['mushrooms', 'Грибы', 'ingredient', 'гриб|шампиньон|саңырауқұлақ|mushroom'],
  [
    'vegetables',
    'Овощи',
    'ingredient',
    'овощ|тыкв|томат|помидор|морков|көкөніс|асқабақ|қызанақ|сәбіз|vegetable|tomato|carrot|pumpkin',
  ],
  ['rice', 'Рис', 'ingredient', 'рис|карнароли|күріш|rice'],
  [
    'milk',
    'Молочные продукты',
    'allergen',
    'молок|сливоч|сыр|пармезан|сүт|ірімшік|кілегей|milk|cream|cheese|butter',
  ],
  ['egg', 'Яйцо', 'allergen', 'яйц|яич|жұмыртқа|egg'],
  ['nuts', 'Орехи', 'allergen', 'орех|миндал|фундук|грецк|жаңғақ|бадам|almond|walnut|hazelnut'],
  ['peanut', 'Арахис', 'allergen', 'арахис|жержаңғақ|peanut'],
  [
    'gluten',
    'Злаки с глютеном',
    'allergen',
    'пшенич|пшениц|мука|паста|лапша|бидай|ұн|кеспе|wheat|flour|pasta',
  ],
  ['celery', 'Сельдерей', 'allergen', 'сельдер|балдыркөк|celery'],
  [
    'shellfish',
    'Моллюски и ракообразные',
    'allergen',
    'гребеш|кревет|мидии|устриц|асшаян|scallop|shrimp|mussel|oyster',
  ],
  ['soy', 'Соя', 'allergen', 'соев|соя|тофу|soy|tofu'],
  ['sesame', 'Кунжут', 'allergen', 'кунжут|күнжіт|sesame'],
  ['roasted', 'Запекание', 'technique', 'запек|запеч|печен|печён|пеште|roast|baked'],
  ['braised', 'Томление', 'technique', 'томл|тушен|тушён|бұқтыр|brais|stew'],
  ['grilled', 'Гриль', 'technique', 'грил|grill'],
];
export const tagCatalog = tagRules.map(([id, label, kind]) => ({ id, label, kind }));
export function extractTags(recipe) {
  const fields = [
    ['name', recipe.name ?? ''],
    ['category', recipe.category ?? ''],
    ['ingredients', (recipe.ingredients ?? []).join('; ')],
    ['method', recipe.method ?? ''],
  ];
  return tagRules.flatMap(([id, label, kind, pattern]) => {
    const regexp = new RegExp(`(?<![\\p{L}])(?:${pattern})[\\p{L}]*`, 'iu');
    const match = fields
      .filter(([field]) => kind !== 'allergen' || field === 'ingredients')
      .map(([field, value]) => ({ field, match: value.match(regexp)?.[0] }))
      .find((item) => item.match);
    return match
      ? [{ id, label, kind, evidence: { field: match.field, text: match.match }, confirmed: false }]
      : [];
  });
}
export function rankRecipes(recipes, profile, feedback = {}) {
  const liked = new Set(profile.preferredTags);
  const avoided = new Set(profile.avoidedTags);
  return recipes
    .map((recipe) => {
      const matched = recipe.tags.filter((t) => liked.has(t.id));
      const excluded = recipe.tags.filter((t) => avoided.has(t.id));
      const score = matched.length * 3 - excluded.length * 6 + (feedback[recipe.id] ?? 0);
      return {
        ...recipe,
        score,
        reasons: [
          ...matched.map((t) => `Предпочтение: ${t.label}`),
          ...excluded.map((t) => `Нежелательный тег: ${t.label}`),
          ...(feedback[recipe.id] ? ['Учтена ваша оценка описания'] : []),
        ],
      };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ru'));
}
