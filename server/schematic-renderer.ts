import { createCanvas } from 'canvas';
import type { SchematicComponent, Wire } from '@shared/schema';

/**
 * Renders a schematic design to PNG for visual AI review
 */
export function renderSchematicToPNG(
  components: SchematicComponent[],
  wires: Wire[]
): Buffer {
  const width = 2000;
  const height = 1500;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Grid
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 0.5;
  for (let x = 0; x < width; x += 20) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 20) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Draw wires first (behind components)
  ctx.lineWidth = 2;
  wires.forEach(wire => {
    const fromComp = components.find(c => c.id === wire.fromComponentId);
    const toComp = components.find(c => c.id === wire.toComponentId);

    if (!fromComp || !toComp) return;

    // Color by polarity
    if (wire.polarity === 'positive') {
      ctx.strokeStyle = '#dc2626'; // red
    } else if (wire.polarity === 'negative') {
      ctx.strokeStyle = '#000000'; // black
    } else {
      ctx.strokeStyle = '#3b82f6'; // blue
    }

    // Simple straight line (actual routing would be more complex)
    ctx.beginPath();
    ctx.moveTo(fromComp.x + 80, fromComp.y + 60); // center of component
    ctx.lineTo(toComp.x + 80, toComp.y + 60);
    ctx.stroke();

    // Wire label
    const midX = (fromComp.x + toComp.x) / 2 + 80;
    const midY = (fromComp.y + toComp.y) / 2 + 60;
    ctx.fillStyle = '#000000';
    ctx.font = '10px Arial';
    ctx.fillText(wire.gauge || '', midX, midY);
  });

  // Draw components
  components.forEach(comp => {
    // Component box
    ctx.fillStyle = '#f3f4f6';
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 2;

    const compWidth = getComponentWidth(comp.type);
    const compHeight = getComponentHeight(comp.type);

    ctx.fillRect(comp.x, comp.y, compWidth, compHeight);
    ctx.strokeRect(comp.x, comp.y, compWidth, compHeight);

    // Component label
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(
      comp.name || comp.type,
      comp.x + compWidth / 2,
      comp.y + compHeight / 2
    );

    // Component type
    ctx.font = '10px Arial';
    ctx.fillText(
      comp.type,
      comp.x + compWidth / 2,
      comp.y + compHeight / 2 + 15
    );
  });

  return canvas.toBuffer('image/png');
}

function getComponentWidth(type: string): number {
  const widths: Record<string, number> = {
    'multiplus': 180,
    'mppt': 160,
    'cerbo': 180,
    'bmv': 140,
    'smartshunt': 140,
    'battery': 160,
    'solar-panel': 140,
    'ac-load': 120,
    'dc-load': 120,
    'busbar-positive': 200,
    'busbar-negative': 200,
  };
  return widths[type] || 140;
}

function getComponentHeight(type: string): number {
  const heights: Record<string, number> = {
    'multiplus': 140,
    'mppt': 130,
    'cerbo': 120,
    'bmv': 140,
    'smartshunt': 130,
    'battery': 110,
    'solar-panel': 120,
    'ac-load': 100,
    'dc-load': 100,
    'busbar-positive': 60,
    'busbar-negative': 60,
  };
  return heights[type] || 120;
}

/**
 * Get visual feedback from AI about the schematic layout
 */
export async function getVisualFeedback(
  imageBuffer: Buffer,
  openai: any
): Promise<string> {
  const base64Image = imageBuffer.toString('base64');

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Analyze this electrical schematic design for a Victron energy system. Look for:
1. Component spacing issues (should be 300px horizontal, 250px vertical minimum)
2. Wire routing problems (crossing, cluttered areas)
3. Layout organization (logical flow, professional appearance)
4. Visual balance and symmetry
5. Any components that appear to overlap

Provide specific, actionable feedback on how to improve the layout. Be concise and focus on the most important issues.`
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${base64Image}`
            }
          }
        ]
      }
    ],
    max_tokens: 500
  });

  return response.choices[0].message.content || "No feedback provided";
}
