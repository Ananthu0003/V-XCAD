import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Tool Materials...');
  
  const hss = await prisma.toolMaterial.upsert({
    where: { material_code: 'HSS' },
    update: {},
    create: {
      material_code: 'HSS',
      material_name: 'High Speed Steel',
      description: 'General purpose, low cost. Good for plastics, wood, soft metals.',
      recommended_workpiece_materials: ['plastic', 'brass'],
      max_surface_speed: 50.0,
      default_feed_multiplier: 1.0,
      cost_factor: 1.0,
    },
  });

  const cobalt = await prisma.toolMaterial.upsert({
    where: { material_code: 'HSS_CO' },
    update: {},
    create: {
      material_code: 'HSS_CO',
      material_name: 'Cobalt HSS',
      description: 'Stainless steel, tough alloys. Higher heat resistance.',
      recommended_workpiece_materials: ['stainless_steel', 'mild_steel'],
      max_surface_speed: 60.0,
      default_feed_multiplier: 1.1,
      cost_factor: 1.5,
    },
  });

  const carbide = await prisma.toolMaterial.upsert({
    where: { material_code: 'CARBIDE' },
    update: {},
    create: {
      material_code: 'CARBIDE',
      material_name: 'Solid Carbide',
      description: 'Standard CNC machining. Excellent for aluminum, steel, stainless steel, brass.',
      recommended_workpiece_materials: ['aluminum_6061', 'mild_steel', 'stainless_steel', 'brass'],
      max_surface_speed: 150.0,
      default_feed_multiplier: 2.0,
      cost_factor: 3.0,
    },
  });

  const carbideInsert = await prisma.toolMaterial.upsert({
    where: { material_code: 'CARBIDE_INSERT' },
    update: {},
    create: {
      material_code: 'CARBIDE_INSERT',
      material_name: 'Carbide Insert',
      description: 'Face mills, turning tools. High production machining.',
      recommended_workpiece_materials: ['mild_steel', 'stainless_steel', 'aluminum_6061'],
      max_surface_speed: 200.0,
      default_feed_multiplier: 2.5,
      cost_factor: 2.5,
    },
  });

  const ceramic = await prisma.toolMaterial.upsert({
    where: { material_code: 'CERAMIC' },
    update: {},
    create: {
      material_code: 'CERAMIC',
      material_name: 'Ceramic',
      description: 'Hardened steel, cast iron. High-speed finishing.',
      recommended_workpiece_materials: ['hardened_steel', 'cast_iron'],
      max_surface_speed: 400.0,
      default_feed_multiplier: 1.5,
      cost_factor: 5.0,
    },
  });

  const cbn = await prisma.toolMaterial.upsert({
    where: { material_code: 'CBN' },
    update: {},
    create: {
      material_code: 'CBN',
      material_name: 'Cubic Boron Nitride (CBN)',
      description: 'Hardened steel finishing. High hardness materials.',
      recommended_workpiece_materials: ['hardened_steel'],
      max_surface_speed: 300.0,
      default_feed_multiplier: 1.0,
      cost_factor: 8.0,
    },
  });

  const pcd = await prisma.toolMaterial.upsert({
    where: { material_code: 'PCD' },
    update: {},
    create: {
      material_code: 'PCD',
      material_name: 'PCD Diamond',
      description: 'Aluminum, Copper, Brass, Graphite, Composite materials.',
      recommended_workpiece_materials: ['aluminum_6061', 'brass'],
      max_surface_speed: 800.0,
      default_feed_multiplier: 3.0,
      cost_factor: 10.0,
    },
  });

  console.log('Seeding Tool Coatings...');

  const uncoated = await prisma.toolCoating.upsert({
    where: { coating_code: 'UNCOATED' },
    update: {},
    create: {
      coating_code: 'UNCOATED',
      coating_name: 'Uncoated',
      description: 'General purpose',
      recommended_materials: ['aluminum_6061', 'plastic', 'brass'],
      surface_speed_multiplier: 1.0,
      wear_resistance_factor: 1.0,
    },
  });

  const tin = await prisma.toolCoating.upsert({
    where: { coating_code: 'TIN' },
    update: {},
    create: {
      coating_code: 'TIN',
      coating_name: 'Titanium Nitride (TiN)',
      description: 'General machining, Gold coating',
      recommended_materials: ['mild_steel'],
      surface_speed_multiplier: 1.2,
      wear_resistance_factor: 1.5,
    },
  });

  const ticn = await prisma.toolCoating.upsert({
    where: { coating_code: 'TICN' },
    update: {},
    create: {
      coating_code: 'TICN',
      coating_name: 'Titanium Carbonitride (TiCN)',
      description: 'Higher wear resistance',
      recommended_materials: ['stainless_steel'],
      surface_speed_multiplier: 1.3,
      wear_resistance_factor: 2.0,
    },
  });

  const tialn = await prisma.toolCoating.upsert({
    where: { coating_code: 'TIALN' },
    update: {},
    create: {
      coating_code: 'TIALN',
      coating_name: 'Titanium Aluminum Nitride (TiAlN)',
      description: 'Steel machining, High temperature',
      recommended_materials: ['mild_steel', 'stainless_steel'],
      surface_speed_multiplier: 1.5,
      wear_resistance_factor: 2.5,
    },
  });

  const altin = await prisma.toolCoating.upsert({
    where: { coating_code: 'ALTIN' },
    update: {},
    create: {
      coating_code: 'ALTIN',
      coating_name: 'Aluminum Titanium Nitride (AlTiN)',
      description: 'Aggressive roughing, High speed machining',
      recommended_materials: ['mild_steel', 'stainless_steel', 'hardened_steel'],
      surface_speed_multiplier: 1.8,
      wear_resistance_factor: 3.0,
    },
  });

  const dlc = await prisma.toolCoating.upsert({
    where: { coating_code: 'DLC' },
    update: {},
    create: {
      coating_code: 'DLC',
      coating_name: 'Diamond-Like Carbon (DLC)',
      description: 'Aluminum, Plastics, Non-ferrous materials',
      recommended_materials: ['aluminum_6061', 'plastic'],
      surface_speed_multiplier: 2.0,
      wear_resistance_factor: 3.0,
    },
  });

  const zrn = await prisma.toolCoating.upsert({
    where: { coating_code: 'ZRN' },
    update: {},
    create: {
      coating_code: 'ZRN',
      coating_name: 'Zirconium Nitride (ZrN)',
      description: 'Aluminum, Brass, Copper',
      recommended_materials: ['aluminum_6061', 'brass'],
      surface_speed_multiplier: 1.4,
      wear_resistance_factor: 1.8,
    },
  });

  const diamond = await prisma.toolCoating.upsert({
    where: { coating_code: 'DIAMOND' },
    update: {},
    create: {
      coating_code: 'DIAMOND',
      coating_name: 'Diamond Coated',
      description: 'Graphite, Composite, Abrasive materials',
      recommended_materials: ['composite', 'graphite'],
      surface_speed_multiplier: 2.5,
      wear_resistance_factor: 10.0,
    },
  });

  console.log('Seeding Tool Holders...');

  const holderTypes = [
    { name: 'ER32 Collet Chuck', type: 'ER Collet', rpm: 24000 },
    { name: 'ER16 Collet Chuck', type: 'ER Collet', rpm: 24000 },
    { name: 'Weldon End Mill Holder', type: 'Weldon', rpm: 15000 },
    { name: 'Shrink Fit Holder', type: 'Shrink Fit', rpm: 30000 },
    { name: 'Hydraulic Chuck', type: 'Hydraulic', rpm: 24000 },
    { name: 'Milling Chuck', type: 'Milling Chuck', rpm: 12000 },
    { name: 'Boring Head', type: 'Boring Head', rpm: 4000 },
  ];

  const holderRecords = [];
  for (const h of holderTypes) {
    const rec = await prisma.toolHolder.upsert({
      where: { holder_name: h.name },
      update: {},
      create: {
        holder_name: h.name,
        holder_type: h.type,
        description: `${h.type} style holder`,
        max_rpm: h.rpm,
      },
    });
    holderRecords.push(rec);
  }

  console.log('Seeding 100+ Tools...');
  
  const toolTypes = ['flat_end_mill', 'ball_nose', 'face_mill', 'drill', 'chamfer_mill'];
  const diameters = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20];
  let toolCount = 0;

  for (const d of diameters) {
    for (const t of toolTypes) {
        // Skip large drills or small face mills to be realistic
        if (t === 'face_mill' && d < 10) continue;
        if (t === 'drill' && d > 12) continue;

        const flutes = t === 'drill' ? 2 : (d < 6 ? 2 : 4);
        
        // HSS variants
        await prisma.toolDefinition.create({
            data: {
                name: `HSS ${t.replace('_', ' ')} Ø${d}mm`,
                type: t,
                diameter: d,
                flutes: flutes,
                stickout: d * 4,
                manufacturer: 'Generic',
                material_id: hss.id,
                coating_id: uncoated.id,
                holder_id: holderRecords[0].id
            }
        });
        toolCount++;

        // Carbide + TiAlN variants (for steel)
        await prisma.toolDefinition.create({
            data: {
                name: `Carbide ${t.replace('_', ' ')} Ø${d}mm TiAlN`,
                type: t,
                diameter: d,
                flutes: flutes,
                stickout: d * 3,
                manufacturer: 'PremiumTooling',
                material_id: carbide.id,
                coating_id: tialn.id,
                holder_id: holderRecords[3].id // Shrink fit
            }
        });
        toolCount++;

        // Carbide + DLC variants (for aluminum)
        if (t !== 'drill') {
            await prisma.toolDefinition.create({
                data: {
                    name: `Carbide ${t.replace('_', ' ')} Ø${d}mm DLC`,
                    type: t,
                    diameter: d,
                    flutes: flutes === 4 ? 3 : flutes, // 3-flute for alu
                    stickout: d * 3,
                    manufacturer: 'AluMaster',
                    material_id: carbide.id,
                    coating_id: dlc.id,
                    holder_id: holderRecords[0].id // ER32
                }
            });
            toolCount++;
        }
    }
  }

  console.log(`Created ${toolCount} Tools.`);

  console.log('Seeding Cutting Data...');
  await prisma.cuttingData.upsert({
    where: {
        tool_material_id_coating_id_workpiece_material: {
            tool_material_id: carbide.id,
            coating_id: dlc.id,
            workpiece_material: 'aluminum_6061'
        }
    },
    update: {},
    create: {
        tool_material_id: carbide.id,
        coating_id: dlc.id,
        workpiece_material: 'aluminum_6061',
        surface_speed: 300,
        feed_per_tooth: 0.05,
        plunge_multiplier: 0.5,
    }
  });

  await prisma.cuttingData.upsert({
    where: {
        tool_material_id_coating_id_workpiece_material: {
            tool_material_id: carbide.id,
            coating_id: tialn.id,
            workpiece_material: 'mild_steel'
        }
    },
    update: {},
    create: {
        tool_material_id: carbide.id,
        coating_id: tialn.id,
        workpiece_material: 'mild_steel',
        surface_speed: 120,
        feed_per_tooth: 0.04,
        plunge_multiplier: 0.3,
    }
  });

  console.log('Seeding completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
