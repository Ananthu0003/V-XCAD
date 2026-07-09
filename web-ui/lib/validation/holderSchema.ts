import { z } from "zod";

export const holderSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(50, "Name is too long"),
  type: z.enum([
    'weldon', 
    'er_collet', 
    'tg_collet', 
    'shrink_fit', 
    'hydraulic', 
    'shell_mill_arbor', 
    'drill_chuck', 
    'tapping_chuck', 
    'custom'
  ]),
  gaugeLength: z.number().min(0, "Gauge length must be positive"),
  diameter: z.number().min(0, "Diameter must be positive"),
  shankSize: z.number().nullable().optional(),
  taperType: z.enum([
    'cat40',
    'cat50',
    'bt30',
    'bt40',
    'bt50',
    'hsk63a',
    'hsk100a',
    'iso30',
    'iso40',
    'straight',
    'morse',
    'other'
  ]).nullable().optional(),
  manufacturer: z.string().max(50).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  isActive: z.boolean(),
});

export type HolderFormValues = z.infer<typeof holderSchema>;
