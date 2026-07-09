import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';

const jsonPath = "c:\\Users\\user\\Downloads\\vexcad_full_cam_tool_library_200_plus (1).json";

function mapType(rawType: string): any {
  const map: Record<string, string> = {
    "Flat End Mill": "flat_end_mill",
    "Ball End Mill": "ball_end_mill",
    "Bull Nose End Mill": "bull_nose_end_mill",
    "Chamfer Mill": "chamfer_mill",
    "Face Mill": "face_mill",
    "Roughing End Mill": "flat_end_mill",
    "Twist Drill": "drill",
    "Center Drill": "drill",
    "Spot Drill": "drill",
    "Reamer": "reamer",
    "Spiral Tap": "thread_mill",
    "Single Profile Thread Mill": "thread_mill",
    "T-Slot Cutter": "t_slot_cutter",
    "Dovetail Cutter": "dovetail_cutter",
    "Keyseat Cutter": "t_slot_cutter",
    "Engraving/V-Bit": "chamfer_mill",
    "Slitting Saw": "custom_profile_tool",
    "Adjustable Boring Head": "boring_bar"
  };

  for (const key of Object.keys(map)) {
    if (rawType.includes(key)) {
      return map[key];
    }
  }

  return "flat_end_mill";
}

async function run() {
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const tools = data.tools || [];
  
  console.log(`Found ${tools.length} tools to import/update`);
  
  let success = 0;
  let failed = 0;

  for (const t of tools) {
    try {
      const typeStr = mapType(t.type);
      
      const payload: any = {
        category: t.category === "milling" ? "milling" : (t.category === "drilling" ? "drilling" : "milling"),
        type: typeStr,
        description: t.notes || "",
        unit: t.units === "mm" ? "mm" : "inch",
        isActive: t.status === "active",
        
        geometry: {
          diameter: t.geometry.diameter_mm,
          fluteLength: t.geometry.flute_length_mm,
          overallLength: t.geometry.overall_length_mm,
          shankDiameter: t.geometry.shank_diameter_mm,
          fluteCount: t.geometry.flute_count,
        },
        
        offsets: {
          lengthOffset: t.assembly?.length_offset_register || 1,
          diameterOffset: t.assembly?.diameter_offset_register || 1,
          compensationType: t.assembly?.compensation === "computer" ? "computer" : "off",
        },
        
        assembly: {
          stickoutLength: t.geometry.stickout_mm,
        }
      };

      if (t.geometry.corner_radius_mm > 0) {
        if (typeStr === "ball_end_mill") {
          payload.geometry.ballRadius = t.geometry.corner_radius_mm;
        } else {
          payload.geometry.cornerRadius = t.geometry.corner_radius_mm;
        }
      }
      
      if (t.geometry.included_angle_deg) {
        payload.geometry.includedAngle = t.geometry.included_angle_deg;
      }
      if (typeStr === "drill" && !payload.geometry.pointAngle) {
        payload.geometry.pointAngle = 118; // default point angle
      }

      const aluData = t.cutting_data?.aluminum_6061;
      if (aluData) {
        payload.cuttingData = {
          spindleRpm: aluData.spindle_rpm,
          feedRate: aluData.feed_mm_min,
          plungeRate: aluData.plunge_mm_min,
          retractRate: aluData.plunge_mm_min * 2,
          coolant: t.coolant ? t.coolant.toLowerCase() : 'off',
          stepdown: aluData.stepdown_mm,
          stepover: aluData.stepover_mm,
        };
      } else {
        payload.cuttingData = {
          spindleRpm: 5000,
          feedRate: 1000,
          plungeRate: 300,
          retractRate: 600,
          coolant: 'off',
        };
      }

      const existingTool = await prisma.tool.findUnique({ where: { name: t.name } });

      if (existingTool) {
        await prisma.tool.update({
          where: { id: existingTool.id },
          data: {
            ...payload,
            geometry: {
              upsert: { create: payload.geometry, update: payload.geometry }
            },
            offsets: {
              upsert: { create: payload.offsets, update: payload.offsets }
            },
            assembly: {
              upsert: { create: payload.assembly, update: payload.assembly }
            },
            cuttingData: {
              upsert: { create: payload.cuttingData, update: payload.cuttingData }
            }
          }
        });
        console.log(`Updated: ${t.name} (type: ${typeStr})`);
      } else {
        await prisma.tool.create({
          data: {
            name: t.name,
            ...payload,
            geometry: { create: payload.geometry },
            offsets: { create: payload.offsets },
            assembly: { create: payload.assembly },
            cuttingData: { create: payload.cuttingData }
          }
        });
        console.log(`Imported: ${t.name} (type: ${typeStr})`);
      }
      
      success++;
    } catch (err: any) {
      console.error(`Failed to import/update ${t.name}:`, err.message);
      failed++;
    }
  }
  
  console.log(`Import complete! Success: ${success}, Failed: ${failed}`);
}

run().catch(console.error);
