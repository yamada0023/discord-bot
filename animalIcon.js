const { createCanvas } = require('@napi-rs/canvas');

// 完全ランダムな未知の生き物アイコンを生成してバッファを返す関数
function generateAnimalIcon() {
  const canvas = createCanvas(400, 400);
  const ctx = canvas.getContext('2d');

  // 1. パステル〜ビビッドな背景色をランダムに選択
  const bgColors = [
    '#FFD1DC', '#FFECB3', '#D0F0C0', '#B5EAD7', '#C7CEEA', 
    '#F3C6FB', '#FFE5EC', '#E2F0CB', '#B5D8F7', '#FFF1C1'
  ];
  const bgColor = bgColors[Math.floor(Math.random() * bgColors.length)];
  
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, 400, 400);

  // 背景にキラキラ（星や泡）をランダムに散りばめる
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  for (let i = 0; i < 8; i++) {
    const hx = Math.random() * 360 + 20;
    const hy = Math.random() * 360 + 20;
    if (Math.random() > 0.5) {
      drawStar(ctx, hx, hy, 4, 10, 5);
    } else {
      ctx.beginPath();
      ctx.arc(hx, hy, Math.random() * 8 + 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 2. 体（顔）の色（豊富なパステルカラーからランダム）
  const bodyColors = [
    '#D7CCC8', '#FFE0B2', '#F8BBD0', '#E1BEE7', '#CFD8DC', 
    '#C8E6C9', '#B2EBF2', '#D1C4E9', '#FFCCBC', '#F0F4C3'
  ];
  const bodyColor = bodyColors[Math.floor(Math.random() * bodyColors.length)];

  // 3. パーツのランダム選択（生き物の特徴を確率で合成）
  // 耳の形状 (0: 丸耳, 1: 三角耳, 2: たれ耳ウサギ風, 3: 小悪魔ツイン角, 4: 猫っけ長耳)
  const earType = Math.floor(Math.random() * 5);
  // 角の有無 (trueなら頭にツノが生える)
  const hasHorns = Math.random() > 0.6;
  // 目のかたち (0: 通常丸目, 1: つぶらな点々目, 2: キラキラおめめ風, 3: じと目)
  const eyeType = Math.floor(Math.random() * 4);
  // 口のかたち (0: にっこり, 1: 「ω」口, 2: ギザギザ口, 3: ぽかん口)
  const mouthType = Math.floor(Math.random() * 4);
  // ほっぺや模様の有無
  const hasCheeks = Math.random() > 0.2;
  const hasPattern = Math.random() > 0.5; // 顔のまわりに模様や毛束

  // --- ツノの描画（ある場合） ---
  if (hasHorns) {
    ctx.fillStyle = '#FFD54F';
    ctx.strokeStyle = '#3E2723';
    ctx.lineWidth = 4;
    // 左右のツノ
    ctx.beginPath();
    ctx.moveTo(150, 110); ctx.lineTo(130, 50); ctx.lineTo(170, 90); ctx.closePath();
    ctx.moveTo(250, 110); ctx.lineTo(270, 50); ctx.lineTo(230, 90); ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // --- 耳の描画 ---
  ctx.fillStyle = bodyColor;
  ctx.strokeStyle = '#3E2723';
  ctx.lineWidth = 5;

  if (earType === 0) {
    // 丸耳
    ctx.beginPath();
    ctx.arc(110, 115, 45, 0, Math.PI * 2);
    ctx.arc(290, 115, 45, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  } else if (earType === 1) {
    // 三角耳
    ctx.beginPath();
    ctx.moveTo(85, 140); ctx.lineTo(130, 50); ctx.lineTo(180, 120); ctx.closePath();
    ctx.moveTo(315, 140); ctx.lineTo(270, 50); ctx.lineTo(220, 120); ctx.closePath();
    ctx.fill(); ctx.stroke();
  } else if (earType === 2) {
    // たれ耳風
    ctx.beginPath();
    ctx.ellipse(120, 130, 25, 55, Math.PI / 4, 0, Math.PI * 2);
    ctx.ellipse(280, 130, 25, 55, -Math.PI / 4, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  } else if (earType === 3) {
    // 小悪魔の羽/角風
    ctx.beginPath();
    ctx.moveTo(90, 120); ctx.lineTo(130, 40); ctx.lineTo(140, 110); ctx.closePath();
    ctx.moveTo(310, 120); ctx.lineTo(270, 40); ctx.lineTo(260, 110); ctx.closePath();
    ctx.fill(); ctx.stroke();
  } else {
    // うさぎ風長耳
    ctx.beginPath();
    ctx.ellipse(145, 80, 22, 65, -Math.PI / 12, 0, Math.PI * 2);
    ctx.ellipse(255, 80, 22, 65, Math.PI / 12, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }

  // --- 頭の毛束や模様 ---
  if (hasPattern) {
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(200, 130, 30, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- 顔のベース（丸） ---
  ctx.beginPath();
  ctx.arc(200, 215, 110, 0, Math.PI * 2);
  ctx.fillStyle = bodyColor;
  ctx.fill();
  ctx.strokeStyle = '#3E2723';
  ctx.lineWidth = 6;
  ctx.stroke();

  // --- ほっぺた ---
  if (hasCheeks) {
    ctx.fillStyle = 'rgba(255, 105, 180, 0.4)';
    ctx.beginPath();
    ctx.arc(130, 230, 20, 0, Math.PI * 2);
    ctx.arc(270, 230, 20, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- 目（生き物の表情を決めるパーツ） ---
  ctx.fillStyle = '#3E2723';
  if (eyeType === 0) {
    // 通常の丸目
    ctx.beginPath();
    ctx.arc(150, 190, 12, 0, Math.PI * 2);
    ctx.arc(250, 190, 12, 0, Math.PI * 2);
    ctx.fill();
    // ハイライト
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(146, 186, 4, 0, Math.PI * 2);
    ctx.arc(246, 186, 4, 0, Math.PI * 2);
    ctx.fill();
  } else if (eyeType === 1) {
    // つぶらな点々目
    ctx.beginPath();
    ctx.arc(150, 190, 6, 0, Math.PI * 2);
    ctx.arc(250, 190, 6, 0, Math.PI * 2);
    ctx.fill();
  } else if (eyeType === 2) {
    // キラキラ星型目（または丸＋大きめハイライト）
    ctx.beginPath();
    ctx.arc(150, 190, 14, 0, Math.PI * 2);
    ctx.arc(250, 190, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(145, 185, 6, 0, Math.PI * 2);
    ctx.arc(245, 185, 6, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // じと目（横線の半円風）
    ctx.strokeStyle = '#3E2723';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(150, 195, 10, Math.PI, 0, false);
    ctx.arc(250, 195, 10, Math.PI, 0, false);
    ctx.stroke();
  }

  // --- 鼻の描画 ---
  ctx.fillStyle = '#3E2723';
  ctx.beginPath();
  ctx.arc(200, 215, 7, 0, Math.PI * 2);
  ctx.fill();

  // --- 口の描画 ---
  ctx.strokeStyle = '#3E2723';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();

  if (mouthType === 0) {
    // にっこり口
    ctx.moveTo(185, 230);
    ctx.quadraticCurveTo(200, 245, 215, 230);
  } else if (mouthType === 1) {
    // ω口
    ctx.moveTo(185, 230);
    ctx.quadraticCurveTo(192, 240, 200, 230);
    ctx.quadraticCurveTo(208, 240, 215, 230);
  } else if (mouthType === 2) {
    // むにゅっとまっすぐ口
    ctx.moveTo(185, 233);
    ctx.lineTo(215, 233);
  } else {
    // 小さなぽかん口（丸）
    ctx.fillStyle = '#3E2723';
    ctx.beginPath();
    ctx.arc(200, 233, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

// 星を描く補助関数
function drawStar(ctx, cx, cy, spikes, outerRadius, innerRadius) {
  let rot = Math.PI / 2 * 3;
  let x = cx;
  let y = cy;
  let step = Math.PI / spikes;

  ctx.beginPath();
  ctx.moveTo(cx, cy - outerRadius);
  for (let i = 0; i < spikes; i++) {
    x = cx + Math.cos(rot) * outerRadius;
    y = cy + Math.sin(rot) * outerRadius;
    ctx.lineTo(x, y);
    rot += step;

    x = cx + Math.cos(rot) * innerRadius;
    y = cy + Math.sin(rot) * innerRadius;
    ctx.lineTo(x, y);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerRadius);
  ctx.closePath();
  ctx.fill();
}

module.exports = { generateAnimalIcon };