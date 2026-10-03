import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  console.log("Adding Long Reach 12mm Flat End Mill...");
  
  const payload = {
    name: "12mm Long Reach Flat End Mill - 4F",
    category: "milling",
    type: "flat_end_mill",
    description: "Long reach tool for deep pockets and contours.",
    unit: "mm",
    isActive: true,
    geometry: {
      create: {
        diameter: 12,
        fluteLength: 30,
        overallLength: 120,
        shankDiameter: 12,
        fluteCount: 4,
      }
    },
    offsets: {
      create: {
        lengthOffset: 50,
        diameterOffset: 50,
        compensationType: "computer",
      }
    },
    assembly: {
      create: {
        stickoutLength: 80, // Needs to be > 75mm
      }
    },
    cuttingData: {
      create: {
        spindleRpm: 1200,
        feedRate: 900,
        plungeRate: 162,
        retractRate: 324,
        coolant: "mist",
        stepdown: 4.2,
        stepover: 3.0,
      }
    }
  };

  const existingTool = await prisma.tool.findUnique({ where: { name: payload.name } });
  if (!existingTool) {
    await prisma.tool.create({ data: payload });
    console.log("Successfully created long reach tool!");
  } else {
    console.log("Tool already exists. Updating stickout to 80mm...");
    await prisma.toolAssembly.update({
      where: { toolId: existingTool.id },
      data: { stickoutLength: 80 }
    });
    console.log("Updated existing long reach tool.");
  }
}

run().catch(console.error);
