import { prisma } from '../lib/prisma';

async function run() {
  console.log("Updating Micro Tools with Cutting Data...");
  
  const updates = [
    {
      name: "0.58mm Micro Twist Drill",
      cuttingData: {
        create: {
          spindleRpm: 10000,
          feedRate: 150,
          plungeRate: 50,
          retractRate: 500,
          coolant: "flood",
          stepdown: 0.2,
          stepover: 0.0
        }
      }
    },
    {
      name: "0.51mm Micro Twist Drill",
      cuttingData: {
        create: {
          spindleRpm: 10000,
          feedRate: 120,
          plungeRate: 40,
          retractRate: 500,
          coolant: "flood",
          stepdown: 0.15,
          stepover: 0.0
        }
      }
    },
    {
      name: "Micro OD Turning Tool",
      cuttingData: {
        create: {
          spindleRpm: 4000,
          feedRate: 100,
          plungeRate: 50,
          retractRate: 300,
          coolant: "flood",
          stepdown: 0.2,
          stepover: 0.2
        }
      }
    },
    {
      name: "Micro Facing Tool",
      cuttingData: {
        create: {
          spindleRpm: 4000,
          feedRate: 100,
          plungeRate: 50,
          retractRate: 300,
          coolant: "flood",
          stepdown: 0.2,
          stepover: 0.2
        }
      }
    }
  ];

  for (const t of updates) {
    const existing = await prisma.tool.findUnique({ where: { name: t.name } });
    if (existing) {
      await prisma.tool.update({
        where: { id: existing.id },
        data: {
          cuttingData: t.cuttingData
        }
      });
      console.log(`Updated cutting data for ${t.name}`);
    }
  }
}

run().catch(console.error);
