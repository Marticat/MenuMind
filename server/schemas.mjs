import { z } from 'zod';

export const languageSchema = z.enum(['ru', 'kk']);
export const toneSchema = z.enum(['editorial', 'bistro', 'concierge']);
export const channelSchema = z.enum(['yandex', 'wolt', 'website', 'print']);
const text = (max) => z.string().trim().max(max);
export const recipeSchema = z.object({
  id: text(80)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
  name: text(100).min(1),
  subtitle: text(150).default(''),
  category: text(80).default(''),
  ingredients: z.array(text(200).min(1)).max(60).default([]),
  method: text(1000).default(''),
  price: z.number().min(0).max(1000000).default(0),
  weight: z.number().min(0).max(20000).default(0),
  pairing: text(200).default(''),
  image: z.literal('/dish.jpg').optional(),
});
export const settingsSchema = z.object({
  restraint: z.number().int().min(0).max(100),
  sensory: z.number().int().min(0).max(100),
  strictness: z.number().int().min(0).max(100),
  limits: z.object(
    Object.fromEntries(
      ['yandex', 'wolt', 'website', 'print'].map((key) => [
        key,
        z.number().int().min(40).max(2000),
      ]),
    ),
  ),
  samples: z.array(text(1200).min(1)).max(12),
});
export const profileSchema = z.object({
  restaurantName: text(100).min(1),
  cuisine: text(100),
  brandInstructions: text(1000),
  language: languageSchema,
  tone: toneSchema,
  preferredTags: z.array(text(50).min(1)).max(30),
  avoidedTags: z.array(text(50).min(1)).max(30),
  settings: settingsSchema,
});
export const registerSchema = z.object({
  name: text(80).min(1),
  email: z
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(10).max(128),
  restaurantName: text(100).min(1),
});
export const loginSchema = registerSchema.pick({ email: true, password: true });
export const generationSchema = z
  .object({
    recipeId: text(80).optional(),
    recipe: recipeSchema.optional(),
    language: languageSchema.optional(),
    tone: toneSchema.optional(),
    maxLength: z.number().int().min(40).max(2000).optional(),
    previousId: z.uuid().optional(),
  })
  .refine((v) => Boolean(v.recipeId) !== Boolean(v.recipe), {
    message: 'Передайте recipeId или recipe, но не оба поля.',
  });
export const editSchema = z.object({
  texts: z.object(
    Object.fromEntries(
      ['yandex', 'wolt', 'website', 'print'].map((key) => [key, text(2000).min(1)]),
    ),
  ),
  variant: text(2000).min(1),
});
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const fail = (status, code, message) => {
  throw new ApiError(status, code, message);
};
