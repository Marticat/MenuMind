export type Page = 'studio' | 'channels' | 'brand' | 'docs' | 'library';
export type Tone = 'editorial' | 'bistro' | 'concierge';
export type ChannelId = 'yandex' | 'wolt' | 'website' | 'print';
export interface Recipe {
  id: string;
  name: string;
  subtitle: string;
  ingredients: string[];
  method: string;
  category: string;
  weight: number;
  price: number;
  image?: string;
  pairing: string;
}
export interface Settings {
  restraint: number;
  sensory: number;
  strictness: number;
  limits: Record<ChannelId, number>;
  samples: string[];
}
export interface Result {
  sourceFingerprint: string;
  id: string;
  recipeId: string;
  name: string;
  texts: Record<ChannelId, string>;
  variant: string;
  tone: Tone;
  createdAt: string;
  price: number;
  weight: number;
  image?: string;
  pairing: string;
}
export const channels: {
  id: ChannelId;
  name: string;
  label: string;
  subtitle: string;
  code: string;
}[] = [
  {
    id: 'yandex',
    name: 'Яндекс.Еда',
    label: 'Премиум рестораны',
    subtitle: 'Кратко. Точно. С аппетитом.',
    code: 'ADAPT–01',
  },
  {
    id: 'wolt',
    name: 'Wolt Delivery',
    label: 'Nordic & Europe fleet',
    subtitle: 'Суть блюда в нескольких строках.',
    code: 'ADAPT–02',
  },
  {
    id: 'website',
    name: 'White-label & Сайт',
    label: 'Maison Delacroix digital',
    subtitle: 'Место для истории и деталей.',
    code: 'ADAPT–03',
  },
  {
    id: 'print',
    name: 'Печатное банкетное',
    label: 'Сезонные сеты & каллиграфия',
    subtitle: 'Ритм классической карты меню.',
    code: 'PRINT–04',
  },
];
export const tones: { id: Tone; title: string; desc: string }[] = [
  {
    id: 'editorial',
    title: 'Критик начала XX века / Refined Editorial',
    desc: 'Сдержанный литературный слог, академическая строгость, акцент на технику и гастрономическую родословную.',
  },
  {
    id: 'bistro',
    title: 'Современное гастро-бистро',
    desc: 'Чистая фактура продукта, лаконичный ритм, акцент на ремесленные техники и сезонность.',
  },
  {
    id: 'concierge',
    title: 'Клубный консьерж & Grand Cru',
    desc: 'Фокус на редкие винтажи, эногастрономические сочетания и клубный этикет подачи.',
  },
];
export const defaultRecipes: Recipe[] = [
  {
    id: 'RCP-8841-BRX',
    name: 'Томлёная говяжья щека',
    subtitle: 'с пюре из печёного сельдерея',
    ingredients: [
      'Фермерская говяжья щека',
      'Корень сельдерея',
      'Сливочное масло 82,5%',
      'Демиглас',
      'Бадьян',
      'Порто Tawny 10yo',
      'Микрозелень кервеля',
    ],
    method:
      'Томление в течение 24 часов при 74 °C. Глазирование редукцией портвейна. Эмульгирование пюре до кремовой текстуры.',
    category: 'Основное',
    weight: 328,
    price: 1450,
    image: '/dish.jpg',
    pairing: 'Barolo DOCG 2018 или плотный сира долины Роны.',
  },
  {
    id: 'RCP-8842-SEA',
    name: 'Гребешок Сен-Жак',
    subtitle: 'с цветной капустой и beurre blanc',
    ingredients: [
      'Морской гребешок',
      'Цветная капуста',
      'Сливочное масло',
      'Белое вино',
      'Лук-шалот',
    ],
    method:
      'Быстрая обжарка гребешка на сливочном масле. Пюре из цветной капусты, соус beurre blanc.',
    category: 'Закуска',
    weight: 180,
    price: 1890,
    pairing: 'Chablis Premier Cru, подача при 10–12 °C.',
  },
  {
    id: 'RCP-8843-VEG',
    name: 'Ризотто с лесными грибами',
    subtitle: 'с пармезаном выдержки 24 месяца',
    ingredients: ['Рис карнароли', 'Белые грибы', 'Пармезан', 'Сливочное масло', 'Овощной бульон'],
    method:
      'Постепенное введение горячего бульона. Мантекатура со сливочным маслом и выдержанным пармезаном.',
    category: 'Основное',
    weight: 290,
    price: 980,
    pairing: 'Pinot Noir с мягкими танинами.',
  },
];
export const defaultSettings: Settings = {
  restraint: 88,
  sensory: 64,
  strictness: 100,
  limits: { yandex: 250, wolt: 180, website: 450, print: 300 },
  samples: [
    'Гребешок Сен-Жак, слегка прихваченный на томлёном масле Нуазет. Чистая сладость моллюска оттеняется хрустящей кольраби и каплями настоянной вербены.',
    'Косуля с брусничным демигласом, где лесная терпкость уравновешена бархатом корнеплодов. Никакой вычурности — только дисциплина огня и времени.',
  ],
};
export const forbidden = [
  'изысканный',
  'незабываемый',
  'волшебный',
  'лучший',
  'сочный',
  'пальчики оближешь',
];
export function constrain(text: string, max: number) {
  if (text.length <= max) return text;
  const part = text.slice(0, max - 1);
  const end = part.lastIndexOf(' ');
  return part.slice(0, end > 0 ? end : part.length).replace(/[.,;:—\s]+$/, '') + '…';
}
export function generationFingerprint(recipe: Recipe, tone: Tone, settings: Settings) {
  return JSON.stringify({ recipe, tone, settings });
}
export function generate(recipe: Recipe, tone: Tone, settings: Settings): Result {
  const ingredients = recipe.ingredients
    .slice(1, 4)
    .map((i) => i.toLocaleLowerCase('ru'))
    .join(', ');
  let compact = `${recipe.name} ${recipe.subtitle}. ${recipe.method}`;
  let full = `${recipe.name} ${recipe.subtitle}. ${recipe.method} В составе: ${ingredients}.`;
  if (tone === 'bistro') {
    compact = `${recipe.name}. ${ingredients}. ${recipe.subtitle}.`;
    full = `${recipe.name}: ${recipe.ingredients.join(', ').toLocaleLowerCase('ru')}. ${recipe.method}`;
  } else if (tone === 'concierge') {
    compact = `${recipe.name} ${recipe.subtitle}. К блюду рекомендуем: ${recipe.pairing}`;
    full = `${recipe.name} ${recipe.subtitle}. ${recipe.method} Рекомендация сомелье: ${recipe.pairing}`;
  }
  if (settings.sensory < 35) full = `${recipe.name}. ${recipe.method}`;
  if (settings.restraint < 40)
    full = `${recipe.name} ${recipe.subtitle} — акцент нашей карты. ${recipe.method}`;
  const clean = (text: string) => {
    const plain = text.replace(
      /[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D\u20E3]/gu,
      '',
    );
    return (
      settings.strictness >= 70
        ? forbidden.reduce((s, word) => s.replace(new RegExp(word, 'gi'), ''), plain)
        : plain
    )
      .replace(/ {2,}/g, ' ')
      .trim();
  };
  return {
    sourceFingerprint: generationFingerprint(recipe, tone, settings),
    id: crypto.randomUUID(),
    recipeId: recipe.id,
    name: recipe.name,
    texts: {
      yandex: constrain(clean(compact), settings.limits.yandex),
      wolt: constrain(clean(`${recipe.name}. ${ingredients}.`), settings.limits.wolt),
      website: constrain(clean(full), settings.limits.website),
      print: constrain(
        clean(`${recipe.name} / ${recipe.subtitle}. ${ingredients}.`),
        settings.limits.print,
      ),
    },
    variant: constrain(
      clean(`${recipe.name}. ${recipe.ingredients.slice(1, 4).join(', ')}. ${recipe.subtitle}.`),
      settings.limits.yandex,
    ),
    tone,
    createdAt: new Date().toISOString(),
    price: recipe.price,
    weight: recipe.weight,
    image: recipe.image,
    pairing: recipe.pairing,
  };
}
export function initialResult(): Result {
  const r = generate(defaultRecipes[0], 'editorial', defaultSettings);
  r.texts.yandex =
    'Томлёная в течение двадцати четырёх часов говяжья щека. Подаётся с бархатистым пюре из запечённого корня сельдерея и густым соусом на основе выдержанного портвейна и демигласа.';
  r.texts.wolt =
    'Томлёная су-вид говяжья щека с глазурью из порто, крем из печёного сельдерея и кервель.';
  r.texts.website =
    'Блюдо длительного томления в медной посуде. Мягкая текстура говяжьих щёк раскрывается в дуэте с земляными нотами печёного корня сельдерея и густой редукцией десятилетнего портвейна Tawny. Завершающий акцент — пряный кервель.';
  r.variant =
    'Фермерская говядина 24-часового томления, шелковистый сельдерей, демиглас с нотами бадьяна.';
  return r;
}
export function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function saveStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function download(data: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
