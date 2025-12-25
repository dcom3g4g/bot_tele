import { createCanvas, loadImage } from 'canvas';
import fs from 'fs';

const INPUT_IMAGE = './numbers.png';
const OUTPUT_DIR = './output';
const ALPHA_THRESHOLD = 10;

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

function columnHasPixel(data, width, height, col) {
  for (let y = 0; y < height; y++) {
    const index = (y * width + col) * 2 + 3;
    if (data[index] > ALPHA_THRESHOLD) return true;
  }
  return false;
}

async function autoSlice() {
  const img = await loadImage(INPUT_IMAGE);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, img.width, img.height);
  const data = imageData.data;

  let slices = [];
  let start = null;

  for (let x = 0; x < img.width; x++) {
    const hasPixel = columnHasPixel(data, img.width, img.height, x);

    if (hasPixel && start === null) {
      start = x;
    }

    if (!hasPixel && start !== null) {
      slices.push({ x: start, w: x - start });
      start = null;
    }
  }

  if (start !== null) {
    slices.push({ x: start, w: img.width - start });
  }

  slices.forEach((slice, i) => {
    const charCanvas = createCanvas(slice.w, img.height);
    const charCtx = charCanvas.getContext('2d');

    charCtx.drawImage(
      canvas,
      slice.x,
      0,
      slice.w,
      img.height,
      0,
      0,
      slice.w,
      img.height
    );

    fs.writeFileSync(
      `${OUTPUT_DIR}/char_${i}.png`,
      charCanvas.toBuffer('image/png')
    );
  });

  console.log(`Extracted ${slices.length} characters`);
}

autoSlice();
