const sharp = require('sharp');

async function testWebPCrop() {
  try {
    const imagePath = '/tmp/uploads/wiki/Collection_Page_2_-_Shell.webp';
    const image = sharp(imagePath);

    // 读取图片信息
    const metadata = await image.metadata();
    console.log(`Image: ${metadata.width}x${metadata.height}, format: ${metadata.format}`);

    // 缩放以提高处理速度
    const scaleFactor = Math.min(1, 800 / Math.max(metadata.width, metadata.height));
    const scaledWidth = Math.round(metadata.width * scaleFactor);
    const scaledHeight = Math.round(metadata.height * scaleFactor);

    const { data, info } = await image
      .resize(scaledWidth, scaledHeight, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    console.log(`Scaled: ${scaledWidth}x${scaledHeight}, channels: ${info.channels}`);

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

    const backgroundColor = detectBackgroundColor(data, scaledWidth, scaledHeight, info.channels);
    console.log(`Background: RGB(${backgroundColor.r},${backgroundColor.g},${backgroundColor.b})`);

    // 使用Otsu方法计算阈值
    function calculateAdaptiveThreshold(data, width, height, channels, backgroundColor, targetType) {
      const colorDiffs = [];
      const sampleRate = Math.max(1, Math.floor((width * height) / 10000));

      for (let i = 0; i < width * height; i += sampleRate) {
        const r = data[i * channels];
        const g = data[i * channels + 1];
        const b = data[i * channels + 2];

        const diff = Math.abs(r - backgroundColor.r) +
                      Math.abs(g - backgroundColor.g) +
                      Math.abs(b - backgroundColor.b);
        colorDiffs.push(diff);
      }

      colorDiffs.sort((a, b) => a - b);

      const p25 = colorDiffs[Math.floor(colorDiffs.length * 0.25)];
      const p50 = colorDiffs[Math.floor(colorDiffs.length * 0.5)];
      const p75 = colorDiffs[Math.floor(colorDiffs.length * 0.75)];

      console.log(`Color diff stats: 25%=${p25}, 50%=${p50}, 75%=${p75}`);

      // Otsu方法
      let maxVariance = 0;
      let bestThreshold = 0;
      const histogram = new Array(766).fill(0);

      for (const diff of colorDiffs) {
        const idx = Math.min(Math.floor(diff), 765);
        histogram[idx]++;
      }

      const totalPixels = colorDiffs.length;
      let sum = 0;
      for (let i = 0; i < 766; i++) {
        sum += i * histogram[i];
      }

      let sumB = 0;
      let wB = 0;
      for (let t = 0; t < 766; t++) {
        wB += histogram[t];
        if (wB === 0) continue;

        const wF = totalPixels - wB;
        if (wF === 0) break;

        sumB += t * histogram[t];
        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;

        const variance = wB * wF * (mB - mF) * (mB - mF);
        if (variance > maxVariance) {
          maxVariance = variance;
          bestThreshold = t;
        }
      }

      console.log(`Otsu threshold: ${bestThreshold}`);

      if (targetType === 'panel') {
        const adaptiveThreshold = Math.max(60, Math.floor(bestThreshold * 0.7));
        console.log(`Panel threshold: ${adaptiveThreshold} (adjusted from Otsu)`);
        return adaptiveThreshold;
      } else {
        const adaptiveThreshold = Math.max(80, Math.floor(bestThreshold * 1.2));
        console.log(`Icon threshold: ${adaptiveThreshold} (adjusted from Otsu)`);
        return adaptiveThreshold;
      }
    }

    const threshold = calculateAdaptiveThreshold(data, scaledWidth, scaledHeight, info.channels, backgroundColor, 'panel');

    // 创建掩码
    const mask = Buffer.alloc(scaledWidth * scaledHeight);
    let maskCount = 0;

    for (let i = 0; i < scaledWidth * scaledHeight; i++) {
      const r = data[i * info.channels];
      const g = data[i * info.channels + 1];
      const b = data[i * info.channels + 2];

      const colorDiff = Math.abs(r - backgroundColor.r) +
                        Math.abs(g - backgroundColor.g) +
                        Math.abs(b - backgroundColor.b);

      if (colorDiff > threshold) {
        mask[i] = 1;
        maskCount++;
      } else {
        mask[i] = 0;
      }
    }

    console.log(`Mask pixels: ${maskCount} (${(maskCount / (scaledWidth * scaledHeight) * 100).toFixed(2)}%)`);

    // 简单的连通区域分析
    function findBoundingBoxes(mask, width, height) {
      const visited = Buffer.alloc(width * height, 0);
      const boxes = [];
      const minSize = 10;

      function bfs(startX, startY) {
        const queue = [[startX, startY]];
        visited[startY * width + startX] = 1;
        let minX = startX, maxX = startX;
        let minY = startY, maxY = startY;

        while (queue.length > 0) {
          const [x, y] = queue.shift();
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const idx = ny * width + nx;
                if (mask[idx] === 1 && visited[idx] === 0) {
                  visited[idx] = 1;
                  queue.push([nx, ny]);
                }
              }
            }
          }
        }

        return {
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1
        };
      }

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          if (mask[idx] === 1 && visited[idx] === 0) {
            const box = bfs(x, y);
            if (box.width > minSize && box.height > minSize) {
              boxes.push(box);
            }
          }
        }
      }

      return boxes;
    }

    const boxes = findBoundingBoxes(mask, scaledWidth, scaledHeight);
    console.log(`Found ${boxes.length} panels`);

    boxes.forEach((box, i) => {
      const scaledBox = {
        x: Math.round(box.x / scaleFactor),
        y: Math.round(box.y / scaleFactor),
        width: Math.round(box.width / scaleFactor),
        height: Math.round(box.height / scaleFactor)
      };
      console.log(`  Panel ${i + 1}: ${scaledBox.x},${scaledBox.y} ${scaledBox.width}x${scaledBox.height}`);
    });

  } catch (error) {
    console.error('Error:', error);
  }
}

testWebPCrop();
