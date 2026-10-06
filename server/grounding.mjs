import { ApiError } from './schemas.mjs';

// Bilingual, conservative guardrails. These rules are not a semantic proof.
const rules = [
  ['quantity', 'щепот|немного|небольш[а-яё]* количеств|аз мөлшер|аздап|a pinch|a little'],
  ['light', 'л[её]гк|жеңіл|light'],
  ['fresh', 'свеж|балғын|fresh'],
  ['texture', 'нежн|хруст|бархат|рассыпчат|жұмсақ|нәзік|қытырлақ|үлпілдек|tender|crisp'],
  ['satiety', 'сытн|питательн|тойымды|нәрлі|nutritious'],
  ['slow', 'медлен|баяу|slow'],
  ['sequence', 'затем|после этого|одан кейін|содан соң|then'],
  ['noodles', 'лапш|кеспе|noodle'],
  ['onion', 'лук[а-яё]*|пияз|onion'],
  ['broth', 'бульон|сорпа суы|broth'],
  ['dough', 'тест[аоуы]|қамыр|dough'],
  ['garlic', 'чеснок|сарымсақ|garlic'],
  ['sugar', 'сахар|қант|sugar'],
  ['honey', 'м[её]д|бал(?:мен|дан|ды)?(?![а-яәіңғүұқөһ])|honey'],
  ['sauce', 'соус|тұздық|sauce'],
  ['frying', 'жарен|жареный|обжар|қуыр|fried'],
];
const regexp = (pattern) => new RegExp(`(?<![\\p{L}])(?:${pattern})[\\p{L}]*`, 'iu');
export function checkGrounding(text, recipe) {
  if (
    /состав.{0,30}не указан|без (?:указан|уточнен|уточнён).{0,15}состав|способ приготовления не указан|құрамы.{0,45}көрсетілмеген|тәсілі.{0,20}көрсетілмеген/iu.test(
      text,
    )
  )
    throw new ApiError(
      502,
      'LLM_CONSTRAINT_FAILED',
      'Описание содержит служебное сообщение вместо текста для гостя.',
    );
  const source = [
    recipe.name,
    recipe.subtitle,
    recipe.category,
    ...(recipe.ingredients ?? []),
    recipe.method,
  ]
    .filter(Boolean)
    .join(' ');
  for (const [kind, pattern] of rules) {
    const re = regexp(pattern);
    if (re.test(text) && !re.test(source))
      throw new ApiError(
        502,
        'UNSUPPORTED_FACT',
        `Описание добавляет неподтверждённые сведения (${kind}). Попробуйте ещё раз.`,
      );
  }
  const numbers = new Set(source.match(/\d+(?:[.,]\d+)?/g) ?? []);
  if ((text.match(/\d+(?:[.,]\d+)?/g) ?? []).some((number) => !numbers.has(number)))
    throw new ApiError(
      502,
      'UNSUPPORTED_FACT',
      'В описании указано число, которого нет в исходных данных.',
    );
}
