import { z } from "zod";

export const mealTypes = [
  "breakfast",
  "snack",
  "lunch",
  "dinner",
  "dessert",
];

export const recipeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  mealTypes: z.array(z.enum(mealTypes)).default([]),
  servings: z.string().default(""),
  prepTimeMinutes: z.number().int().min(0).nullable(),
  cookTimeMinutes: z.number().int().min(0).nullable(),
  ingredients: z.array(z.string().min(1)).min(1),
  steps: z.array(z.string().min(1)).min(1),
  tags: z.array(z.string().min(1)).default([]),
  notes: z.string().default(""),
  source: z.string().default("ChatGPT"),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const dayPlanSchema = z.object({
  breakfast: z
    .object({
      recipeId: z.string().nullable().default(null),
      required: z.boolean().default(true),
    })
    .default({ recipeId: null, required: true }),
  snackAm: z
    .object({
      recipeId: z.string().nullable().default(null),
      required: z.boolean().default(true),
    })
    .default({ recipeId: null, required: true }),
  lunch: z
    .object({
      recipeId: z.string().nullable().default(null),
      required: z.boolean().default(true),
    })
    .default({ recipeId: null, required: true }),
  snackPm: z
    .object({
      recipeId: z.string().nullable().default(null),
      required: z.boolean().default(true),
    })
    .default({ recipeId: null, required: true }),
  dinner: z
    .object({
      recipeId: z.string().nullable().default(null),
      required: z.boolean().default(true),
    })
    .default({ recipeId: null, required: true }),
  dessert: z
    .object({
      recipeId: z.string().nullable().default(null),
      required: z.boolean().default(true),
    })
    .default({ recipeId: null, required: true }),
});

export const mealPlanSchema = z.object({
  weekStart: z.string().min(1),
  days: z.record(dayPlanSchema),
  updatedAt: z.string().min(1),
});
