export const descriptionStyles = {
  concise: {
    label: 'Кратко',
    instruction:
      'Use one short factual sentence. Keep only the dish identity and essential supplied facts.',
  },
  ingredients: {
    label: 'Акцент на состав',
    instruction:
      'Lead with the supplied ingredients. Describe composition clearly, without inventing sensory qualities.',
  },
  method: {
    label: 'Акцент на приготовление',
    instruction:
      'Lead with the explicitly supplied cooking method, then identify the dish and its ingredients.',
  },
};

export const availableStyles = (recipe) =>
  Object.keys(descriptionStyles).filter(
    (id) =>
      id === 'concise' || (id === 'ingredients' ? recipe.ingredients.length : recipe.method.trim()),
  );
