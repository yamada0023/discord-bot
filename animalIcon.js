const { createCanvas } = require('@napi-rs/canvas');

// かわいい動物のアイコンを生成してバッファを返す関数
function generateAnimalIcon() {
  const canvas = createCanvas(400, 400);
  const ctx = canvas.getContext('2d');

  // 1. パステルカラーの背景色をランダムに選択
  const bgColors = ['#FFD1DC', '#FFECB3', '#D0F0C0', '#B5EAD7', '#C7CEEA', '#F3C6FB'];
  const bgColor = bgColors[Math.floor(Math.random() * bgColors.length)];
  
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, 400, 400);

  // 2. 動物の種類をランダムに決定 (0: クマ, 1: ネコ, 2: ウサギ)
  const animalType = Math.floor(Math.random() * 3);

  // 体（顔）の色（少し濃いめのパステル）
  const bodyColors = ['#D7CCC8', '#FFE0B2', '#F8BBD0', '#E1BEE7', '#CFD8DC'];
  const bodyColor = bodyColors[Math.floor(Math.random() * bodyColors.length)];

  // 耳の描画
  ctx.fillStyle = bodyColor;
  if (animalType === 0) {
    // クマの耳（丸）
    ctx.beginPath();
    ctx.arc(110, 110, 50, 0, Math.PI * 2);
    ctx.arc(290, 110, 50, 0, Math.PI * 2);
    ctx.fill();
  } else if (animalType === 1) {
    // ネコの耳（三角）
    ctx.beginPath();
    ctx.moveTo(80, 140);
    ctx.lineTo(130, 50);
    ctx.lineTo(170, 130);
    ctx.closePath();
    ctx.moveTo(320, 140);
    ctx.lineTo(270, 50);
    ctx.lineTo(230, 130);
    ctx.closePath();
    ctx.fill();
  } else {
    // ウサギの耳（長め）
    ctx.beginPath();
    ctx.ellipse(150, 90, 30, 70, -Math.PI / 12, 0, Math.PI * 2);
    ctx.ellipse(250, 90, 30, 70, Math.PI / 12, 0, Math.PI * 2);
    ctx.fill();
  }

  // 顔のベース（丸）
  ctx.beginPath();
  ctx.arc(200, 210, 110, 0, Math.PI * 2);
  ctx.fillStyle = bodyColor;
  ctx.fill();
  ctx.strokeStyle = '#3E2723';
  ctx.lineWidth = 6;
  ctx.stroke();

  // ほっぺた（ピンクの丸）
  ctx.fillStyle = 'rgba(255, 105, 180, 0.4)';
  ctx.beginPath();
  ctx.arc(135, 235, 20, 0, Math.PI * 2);
  ctx.arc(265, 235, 20, 0, Math.PI * 2);
  ctx.fill();

  // 目
  ctx.strokeStyle = '#3E2723';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';

  // 左目
  ctx.beginPath();
  ctx.arc(150, 190, 12, Math.PI, 0, false);
  ctx.stroke();

  // 右目
  ctx.beginPath();
  ctx.arc(250, 190, 12, Math.PI, 0, false);
  ctx.stroke();

  // 鼻と口
  ctx.fillStyle = '#3E2723';
  ctx.beginPath();
  ctx.arc(200, 215, 8, 0, Math.PI * 2);
  ctx.fill();

  // にっこり口
  ctx.beginPath();
  ctx.moveTo(185, 230);
  ctx.quadraticCurveTo(200, 245, 215, 230);
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

module.exports = { generateAnimalIcon };