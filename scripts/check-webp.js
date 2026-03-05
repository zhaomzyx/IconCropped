const sharp = require('sharp');
const fs = require('fs');

const imagePath = '/tmp/uploads/wiki/Collection_Page_2_-_Shell.webp';

async function checkImage() {
  try {
    const metadata = await sharp(imagePath).metadata();
    console.log('Metadata:', JSON.stringify(metadata, null, 2));

    const image = sharp(imagePath);
    const { data, info } = await image
      .resize(200, null, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    console.log('Info:', info);

    // 采样一些像素查看颜色分布
    const samplePixels = [];
    const step = Math.floor((info.width * info.height) / 100);
    for (let i = 0; i < info.width * info.height; i += step) {
      const r = data[i * info.channels];
      const g = data[i * info.channels + 1];
      const b = data[i * info.channels + 2];
      samplePixels.push({ r, g, b });
    }

    console.log('Sample pixels (first 10):', samplePixels.slice(0, 10));

    // 检测背景颜色
    function detectBackgroundColor(data, width, height, channels) {
      const rValues = [];
      const gValues = [];
      const bValues = [];
      const margin = 5;

      for (let y = 0; y < margin && y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * channels;
          rValues.push(data[idx]);
          gValues.push(data[idx + 1]);
          bValues.push(data[idx + 2]);
        }
      }

      rValues.sort((a, b) => a - b);
      gValues.sort((a, b) => a - b);
      bValues.sort((a, b) => a - b);

      return {
        r: rValues[Math.floor(rValues.length / 2)],
        g: gValues[Math.floor(gValues.length / 2)],
        b: bValues[Math.floor(bValues.length / 2)]
      };
    }

    const bg = detectBackgroundColor(data, info.width, info.height, info.channels);
    console.log('Background color:', bg);

    // 计算颜色差异分布
    const colorDiffs = [];
    for (let i = 0; i < info.width * info.height; i++) {
      const r = data[i * info.channels];
      const g = data[i * info.channels + 1];
      const b = data[i * info.channels + 2];

      const diff = Math.abs(r - bg.r) + Math.abs(g - bg.g) + Math.abs(b - bg.b);
      colorDiffs.push(diff);
    }

    colorDiffs.sort((a, b) => a - b);
    console.log('Color diff stats:');
    console.log('  Min:', colorDiffs[0]);
    console.log('  25%:', colorDiffs[Math.floor(colorDiffs.length * 0.25)]);
    console.log('  50% (median):', colorDiffs[Math.floor(colorDiffs.length * 0.5)]);
    console.log('  75%:', colorDiffs[Math.floor(colorDiffs.length * 0.75)]);
    console.log('  90%:', colorDiffs[Math.floor(colorDiffs.length * 0.9)]);
    console.log('  Max:', colorDiffs[colorDiffs.length - 1]);

  } catch (error) {
    console.error('Error:', error);
  }
}

checkImage();
