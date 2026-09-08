import type { IllustrateRequest } from "../types";
import { localIllustrationPrompt } from "./localWriter";

type LocalArtInput = Pick<
  IllustrateRequest,
  "excerpt" | "direction" | "style" | "size"
> & {
  book: IllustrateRequest["book"];
  chapterId: string;
};

function hash(value: string): number {
  let result = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0;
}

function rgba(hex: string, alpha: number): string {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function palette(style: string): [string, string, string, string] {
  const name = style.toLowerCase();
  if (name.includes("water"))
    return ["#123b45", "#6fa7a5", "#d2c39c", "#f3e3bd"];
  if (name.includes("wood"))
    return ["#281d24", "#6e3d38", "#c88d58", "#ead0a0"];
  if (name.includes("oil")) return ["#182c3b", "#305b62", "#b56c4e", "#e3bd72"];
  if (name.includes("pencil"))
    return ["#2a3031", "#69726d", "#b2a994", "#e4ded1"];
  if (name.includes("children"))
    return ["#264659", "#5c8e85", "#e9a65f", "#f2d69e"];
  return ["#202e34", "#49655e", "#a78d67", "#ddd0ae"];
}

export interface LocalVisualCues {
  water: boolean;
  forest: boolean;
  interior: boolean;
  urban: boolean;
  travel: boolean;
  figure: boolean;
  object: boolean;
  fire: boolean;
  weather: boolean;
}

/**
 * Keep the no-WebGPU fallback grounded in the actual passage. These cues do
 * not pretend to understand the whole scene; they choose a few visible motifs
 * so a letter, forest, room or journey does not always become the same shore.
 */
export function localVisualCues(excerpt: string): LocalVisualCues {
  const text = excerpt.toLowerCase();
  const has = (pattern: RegExp) => pattern.test(text);
  return {
    water: has(
      /\b(sea|ocean|tide|harbor|harbour|river|lake|shore|wave|rain)\b/u,
    ),
    forest: has(/\b(forest|woods?|tree|garden|grove|moss|pine|leaf|leaves)\b/u),
    interior: has(
      /\b(room|house|home|door|window|hall|kitchen|bed|attic|cellar)\b/u,
    ),
    urban: has(
      /\b(city|street|town|market|shop|building|tower|alley|station)\b/u,
    ),
    travel: has(
      /\b(train|rail|road|journey|car|boat|ship|walked|travel|departure)\b/u,
    ),
    figure: has(
      /\b(person|woman|man|child|girl|boy|keeper|mother|father|stranger|body|face|she|he|they|her|his|their)\b/u,
    ),
    object: has(
      /\b(letter|key|book|photograph|photo|clock|map|lantern|bottle|chair)\b/u,
    ),
    fire: has(/\b(fire|flame|candle|lamp|hearth|glow|warm)\b/u),
    weather: has(/\b(storm|wind|fog|mist|snow|ice|thunder|cloud|rain)\b/u),
  };
}

/**
 * Make a small, private visual study without a network request. It is an
 * intentional starting image, grounded by the passage hash and selected
 * medium, rather than an attempt to disguise a remote model as local.
 */
export async function createLocalIllustration(input: LocalArtInput): Promise<{
  dataUrl: string;
  prompt: string;
}> {
  const [width, height] = input.size.split("x").map(Number);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const prompt = localIllustrationPrompt({
    ...input,
    selection: "",
    idea: input.excerpt,
  });
  if (
    typeof navigator !== "undefined" &&
    /jsdom/i.test(navigator.userAgent || "")
  )
    return { dataUrl: "/assets/tide-illustration.png", prompt };
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = canvas.getContext("2d");
  } catch {
    context = null;
  }
  if (!context || typeof canvas.toDataURL !== "function")
    return { dataUrl: "/assets/tide-illustration.png", prompt };

  const chapter = input.book.chapters.find(
    (item) => item.id === input.chapterId,
  );
  const storyMaterial = [
    input.excerpt,
    chapter?.title,
    chapter?.synopsis,
    ...input.book.bible.map((note) => `${note.name} ${note.details}`),
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 16000);
  const seed = hash(`${storyMaterial}|${input.style}|${input.direction}`);
  const cues = localVisualCues(storyMaterial);
  const directionText = input.direction.toLowerCase();
  const omit = (pattern: RegExp) => pattern.test(directionText);
  const omitHouse = omit(
    /\b(?:no|without|exclude|avoid|omit)\s+(?:a\s+)?house\b/u,
  );
  const mentionsStructure =
    /\b(house|home|cabin|cottage|lighthouse|building|room|door|window)\b/u.test(
      storyMaterial.toLowerCase(),
    );
  const showHouse = !omitHouse && mentionsStructure;
  const omitFigure = omit(
    /\b(?:no|without|exclude|avoid|omit)\s+(?:a\s+)?(?:person|people|figure|character)\b/u,
  );
  if (omitFigure) cues.figure = false;
  const [sky, mid, warm, paper] = palette(input.style);
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, sky);
  gradient.addColorStop(0.58, mid);
  gradient.addColorStop(1, "#101b20");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  const horizon = Math.round(height * (0.58 + (seed % 11) / 100));
  const moonX = Math.round(width * (0.2 + ((seed >>> 5) % 60) / 100));
  const moonY = Math.round(height * (0.18 + ((seed >>> 11) % 18) / 100));
  const moonRadius = Math.max(24, Math.round(Math.min(width, height) * 0.07));
  context.fillStyle = rgba(paper, 0.82);
  context.beginPath();
  context.arc(moonX, moonY, moonRadius, 0, Math.PI * 2);
  context.fill();

  if (cues.forest) {
    context.fillStyle = rgba("#091519", 0.82);
    const treeCount = 8 + (seed % 6);
    for (let tree = 0; tree < treeCount; tree += 1) {
      const x =
        Math.round(((seed >>> (tree % 16)) + tree * width) / treeCount) % width;
      const base = horizon + Math.round(height * 0.23);
      const trunk = Math.max(3, Math.round(width / 95));
      const crown = Math.round(
        height * (0.14 + ((seed + tree * 31) % 12) / 100),
      );
      context.fillRect(x, base - crown * 0.25, trunk, crown);
      context.beginPath();
      context.moveTo(x - crown * 0.46, base - crown * 0.18);
      context.lineTo(x + trunk / 2, base - crown);
      context.lineTo(x + crown * 0.52, base - crown * 0.18);
      context.closePath();
      context.fill();
    }
  }

  if (cues.urban) {
    context.fillStyle = rgba("#10191c", 0.82);
    const buildings = 7;
    for (let building = 0; building < buildings; building += 1) {
      const buildingWidth = Math.round(width / 11);
      const x = building * Math.round(width / buildings) - buildingWidth / 3;
      const buildingHeight = Math.round(
        height * (0.12 + ((seed >>> (building % 12)) % 18) / 100),
      );
      context.fillRect(
        x,
        horizon - buildingHeight,
        buildingWidth,
        buildingHeight,
      );
      context.fillStyle = rgba(warm, 0.28);
      for (let row = 0; row < 2; row += 1) {
        context.fillRect(
          x + buildingWidth * 0.26,
          horizon - buildingHeight + buildingHeight * (0.28 + row * 0.3),
          Math.max(2, buildingWidth * 0.1),
          Math.max(2, buildingHeight * 0.08),
        );
      }
      context.fillStyle = rgba("#10191c", 0.82);
    }
  }

  if (cues.interior) {
    context.fillStyle = rgba(paper, 0.1);
    context.fillRect(width * 0.12, height * 0.18, width * 0.76, height * 0.58);
    context.strokeStyle = rgba(paper, 0.38);
    context.lineWidth = Math.max(1, Math.round(Math.min(width, height) / 360));
    context.strokeRect(
      width * 0.17,
      height * 0.24,
      width * 0.28,
      height * 0.25,
    );
    context.beginPath();
    context.moveTo(width * 0.12, height * 0.76);
    context.lineTo(width * 0.88, height * 0.76);
    context.moveTo(width * 0.22, height * 0.76);
    context.lineTo(width * 0.5, height * 0.56);
    context.lineTo(width * 0.8, height * 0.76);
    context.stroke();
  }

  if (cues.travel) {
    context.strokeStyle = rgba(paper, 0.44);
    context.lineWidth = Math.max(2, Math.round(Math.min(width, height) / 300));
    context.beginPath();
    context.moveTo(width * 0.34, height);
    context.lineTo(width * 0.47, horizon + height * 0.05);
    context.moveTo(width * 0.7, height);
    context.lineTo(width * 0.54, horizon + height * 0.05);
    context.stroke();
  }

  if (cues.figure) {
    const figureX = width * (0.26 + ((seed >>> 9) % 34) / 100);
    const figureBase = height * 0.88;
    const figureSize = Math.max(
      12,
      Math.round(Math.min(width, height) * 0.055),
    );
    context.fillStyle = rgba("#081216", 0.86);
    context.beginPath();
    context.arc(
      figureX,
      figureBase - figureSize * 3.1,
      figureSize * 0.72,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.fillRect(
      figureX - figureSize * 0.6,
      figureBase - figureSize * 2.4,
      figureSize * 1.2,
      figureSize * 2.4,
    );
  }

  if (cues.object) {
    const objectX = width * 0.16;
    const objectY = height * 0.8;
    context.fillStyle = rgba(warm, 0.7);
    context.fillRect(objectX, objectY, width * 0.16, height * 0.075);
    context.strokeStyle = rgba(paper, 0.56);
    context.lineWidth = Math.max(1, Math.round(Math.min(width, height) / 400));
    context.strokeRect(objectX, objectY, width * 0.16, height * 0.075);
    context.beginPath();
    context.moveTo(objectX, objectY);
    context.lineTo(objectX + width * 0.08, objectY + height * 0.04);
    context.lineTo(objectX + width * 0.16, objectY);
    context.stroke();
  }

  if (cues.fire) {
    context.fillStyle = rgba(warm, 0.22);
    context.beginPath();
    context.arc(
      width * 0.72,
      height * 0.67,
      Math.min(width, height) * 0.12,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.fillStyle = rgba(warm, 0.86);
    context.beginPath();
    context.moveTo(width * 0.72, height * 0.76);
    context.quadraticCurveTo(
      width * 0.65,
      height * 0.68,
      width * 0.72,
      height * 0.6,
    );
    context.quadraticCurveTo(
      width * 0.8,
      height * 0.7,
      width * 0.72,
      height * 0.76,
    );
    context.fill();
  }

  context.fillStyle = rgba("#0b161b", 0.58);
  context.beginPath();
  context.moveTo(0, horizon + 30);
  for (let x = 0; x <= width; x += Math.max(40, Math.round(width / 12))) {
    const peak = horizon - ((seed + x * 17) % Math.round(height * 0.24));
    context.lineTo(x, peak);
  }
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  context.fill();

  context.fillStyle = rgba("#081216", 0.74);
  if (showHouse) {
    const houseX = Math.round(width * (0.52 + ((seed >>> 7) % 20) / 100));
    const houseY = horizon - Math.round(height * 0.08);
    const houseW = Math.round(width * 0.18);
    const houseH = Math.round(height * 0.13);
    context.fillRect(houseX, houseY, houseW, houseH);
    context.beginPath();
    context.moveTo(houseX - houseW * 0.12, houseY);
    context.lineTo(houseX + houseW * 0.48, houseY - houseH * 0.62);
    context.lineTo(houseX + houseW * 1.12, houseY);
    context.closePath();
    context.fill();
    context.fillStyle = rgba(warm, 0.86);
    context.fillRect(
      houseX + houseW * 0.18,
      houseY + houseH * 0.3,
      houseW * 0.12,
      houseH * 0.2,
    );
    context.fillRect(
      houseX + houseW * 0.7,
      houseY + houseH * 0.3,
      houseW * 0.12,
      houseH * 0.2,
    );
  }

  context.strokeStyle = rgba(
    paper,
    input.style.toLowerCase().includes("ink") ? 0.52 : 0.24,
  );
  context.lineWidth = Math.max(1, Math.round(Math.min(width, height) / 420));
  for (let line = 0; line < 34; line += 1) {
    const y =
      horizon + Math.round((seed + line * 29) % Math.max(1, height - horizon));
    context.beginPath();
    context.moveTo((seed + line * 53) % width, y);
    context.lineTo(
      Math.min(width, (((seed >>> 3) + line * 97) % width) + width * 0.22),
      y,
    );
    context.stroke();
  }

  if (input.style.toLowerCase().includes("wood")) {
    context.strokeStyle = rgba(paper, 0.32);
    context.lineWidth = Math.max(2, Math.round(Math.min(width, height) / 260));
    for (
      let line = -height;
      line < width;
      line += Math.max(16, Math.round(width / 30))
    ) {
      context.beginPath();
      context.moveTo(line, height);
      context.lineTo(line + height * 0.7, 0);
      context.stroke();
    }
  }
  if (cues.water || input.style.toLowerCase().includes("water")) {
    context.fillStyle = rgba(paper, 0.08);
    for (let ring = 0; ring < 12; ring += 1) {
      context.beginPath();
      context.ellipse(
        (seed + ring * 113) % width,
        horizon + ((seed + ring * 47) % Math.max(1, height - horizon)),
        18 + ring * 9,
        5 + ring * 2,
        0,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  }
  try {
    return { dataUrl: canvas.toDataURL("image/png"), prompt };
  } catch {
    return { dataUrl: "/assets/tide-illustration.png", prompt };
  }
}
