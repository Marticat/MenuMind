export type Page =
  'studio' | 'channels' | 'brand' | 'docs' | 'library' | 'profile' | 'history' | 'personalization';
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
  tags?: import('./api').Tag[];
}
export interface Settings {
  restraint: number;
  sensory: number;
  strictness: number;
  limits: Record<ChannelId, number>;
  samples: string[];
}
export interface Result {
  language?: 'ru' | 'kk';
  provider?: string;
  providerModel?: string | null;
  localInference?: {
    modelVersion: string;
    adapterSha256: string;
    channelMode: 'shared';
    style: 'neutral';
    deterministic: true;
  };
  feedback?: number;
  limits?: Record<ChannelId, number>;
  sourceFingerprint: string;
  id: string;
  recipeId: string;
  name: string;
  texts: Record<ChannelId, string>;
  variant: string;
  tone: Tone;
  createdAt: string;
  editedAt?: string;
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
    label: 'Сайт вашего ресторана',
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
    title: 'Сдержанный редакционный',
    desc: 'Название блюда и точное описание состава или приготовления по вашей техкарте.',
  },
  {
    id: 'bistro',
    title: 'Современное гастро-бистро',
    desc: 'Короткая разговорная подача с обращением «В меню» — только указанные факты.',
  },
  {
    id: 'concierge',
    title: 'Вежливый консьерж',
    desc: 'Сдержанное приглашение «Предлагаем» без выдуманных сочетаний и обещаний.',
  },
];
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
export function generationFingerprint(
  recipe: Recipe,
  tone: Tone,
  settings: Settings,
  language: 'ru' | 'kk' = 'ru',
  profile?: import('./api').Profile,
) {
  return JSON.stringify({ recipe, tone, settings, language, profile });
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
