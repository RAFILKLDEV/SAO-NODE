import { z } from 'zod';

export const MODULE_ID = 'br.sao.rpg.firecast.database';
export const DATA_TYPE = 'br.sao.rpg.database';
export const T20_CURRENT = 'Ambesek.T20';
export const T20_LEGACY = 'Ambesek.Tormenta20';

export const ENTITY_TYPES = ['npc', 'location', 'item', 'monster', 'quest'];
export const ROLE_TYPES = ['owner', 'gm', 'assistant_gm', 'player', 'spectator'];
export const VISIBILITIES = ['public', 'gm', 'discoverable'];
export const ALLOWANCES = ['allow', 'deny'];
export const TARGET_KINDS = [
  'entity',
  'field',
  'objective',
  'location_connection',
  'monster_stat',
  'monster_movement',
  'monster_attack',
  'monster_ability',
  'monster_skill',
  'monster_trait'
];

export const entityTypeSchema = z.enum(ENTITY_TYPES);
export const visibilitySchema = z.enum(VISIBILITIES);
export const roleSchema = z.enum(ROLE_TYPES);

export const referenceSchema = z.object({
  type: z.string().min(1),
  id: z.string().min(1),
  role: z.string().min(1).default('related'),
  chance: z.number().int().min(1).max(100).optional()
});

export const narrativeFieldSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  visibility: visibilitySchema
});

export const baseEntitySchema = z.object({
  id: z.string().min(3),
  name: z.string().min(1),
  active: z.boolean().default(true),
  discoveryRevision: z.number().int().nonnegative().default(0),
  sectionVisibility: z.record(z.string(), visibilitySchema).default({}),
  source: z
    .object({
      kind: z.enum(['local', 'xml']).default('local'),
      packId: z.string().optional(),
      fileName: z.string().optional(),
      importedAt: z.union([z.number(), z.string()]).optional(),
      modifiedLocally: z.boolean().default(true)
    })
    .optional(),
  tags: z.array(z.string()).default([]),
  fields: z.array(narrativeFieldSchema).default([]),
  references: z.array(referenceSchema).default([])
});

export function apiError(code, message, details = undefined) {
  return { error: { code, message, ...(details ? { details } : {}) } };
}
