import { prisma } from '../lib/prisma';

async function run() {
  console.log("Adding Micro Tools to Tool Library...");
  
  const tools = [
    {
      name: "0.58mm Micro Twist Drill",
      category: "drilling",
      type: "drill",
      description: "Micro drill for precision holes (e.g. bore_left)",
      unit: "mm",
      isActive: true,
      geometry: {
        create: {
          diameter: 0.58,
          fluteLength: 3,
          overallLength: 38,
          shankDiameter: 3.175,
          fluteCount: 2,
          pointAngle: 118
        }
      },
      offsets: {
        create: {
          lengthOffset: 101,
          diameterOffset: 101,
          compensationType: "off"
        }
      },
      assembly: {
        create: {
          stickoutLength: 10
        }
      }
    },
    {
      name: "0.51mm Micro Twist Drill",
      category: "drilling",
      type: "drill",
      description: "Micro drill for precision holes (e.g. bore_right)",
      unit: "mm",
      isActive: true,
      geometry: {
        create: {
          diameter: 0.51,
          fluteLength: 3,
          overallLength: 38,
          shankDiameter: 3.175,
          fluteCount: 2,
          pointAngle: 118
        }
      },
      offsets: {
        create: {
          lengthOffset: 102,
          diameterOffset: 102,
          compensationType: "off"
        }
      },
      assembly: {
        create: {
          stickoutLength: 10
        }
      }
    },
    {
      name: "Micro OD Turning Tool",
      category: "turning",
      type: "turning_tool",
      description: "Small profile turning tool for micro OD turning",
      unit: "mm",
      isActive: true,
      geometry: {
        create: {
          diameter: 1.0,
          fluteLength: 5,
          overallLength: 50,
          shankDiameter: 8,
          fluteCount: 1
        }
      },
      offsets: {
        create: {
          lengthOffset: 103,
          diameterOffset: 103,
          compensationType: "off"
        }
      },
      assembly: {
        create: {
          stickoutLength: 15
        }
      }
    },
    {
      name: "Micro Facing Tool",
      category: "turning",
      type: "turning_tool",
      description: "Small profile facing tool for micro features",
      unit: "mm",
      isActive: true,
      geometry: {
        create: {
          diameter: 1.0,
          fluteLength: 5,
          overallLength: 50,
          shankDiameter: 8,
          fluteCount: 1
        }
      },
      offsets: {
        create: {
          lengthOffset: 104,
          diameterOffset: 104,
          compensationType: "off"
        }
      },
      assembly: {
        create: {
          stickoutLength: 15
        }
      }
    }
  ];

  for (const t of tools) {
    const existing = await prisma.tool.findUnique({ where: { name: t.name } });
    if (!existing) {
      await prisma.tool.create({ data: t });
      console.log(`Created ${t.name}`);
    } else {
      console.log(`${t.name} already exists.`);
    }
  }
}

run().catch(console.error);
