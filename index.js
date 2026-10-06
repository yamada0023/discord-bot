const http = require('http');

// Webサーバーの起動 (Render等の常時起動用)
http.createServer((req, res) => {
  res.write("Bot is alive!");
  res.end();
}).listen(process.env.PORT || 3000);

const { 
  Client, 
  GatewayIntentBits, 
  Partials,
  Events,
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  AttachmentBuilder,
  EmbedBuilder,
  PermissionFlagsBits
} = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction
  ]
});

// メモリ上で設定を保持する変数
let verifyRoleId = '1537841157315231896'; // デフォルト認証ロールID
let userInfoChannelId = null; // ログ用チャンネルID
let minAccountAgeDays = 3; // サブ垢対策（最低日数）

// キャプチャ認証用の文字保存用マップ
const captchaStore = new Map();

// ランダムな文字列（5桁）を生成する関数
function generateCaptchaText() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let text = '';
  for (let i = 0; i < 5; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

// キャプチャ画像を生成する関数
function createCaptchaImage(text) {
  const canvas = createCanvas(200, 70);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, 200, 70);

  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = `#${Math.floor(Math.random()*16777215).toString(16)}`;
    ctx.beginPath();
    ctx.moveTo(Math.random() * 200, Math.random() * 70);
    ctx.lineTo(Math.random() * 200, Math.random() * 70);
    ctx.stroke();
  }

  ctx.font = 'bold 36px sans-serif';
  ctx.fillStyle = '#333333';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 100, 35);

  return canvas.toBuffer('image/png');
}

// 共通ログ出力処理
async function sendLog(guild, member, method) {
  if (!userInfoChannelId) return;
  const logChannel = guild.channels.cache.get(userInfoChannelId);
  if (!logChannel) return;

  const createdDays = Math.floor((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));
  
  const embed = new EmbedBuilder()
    .setTitle('✅ 認証ログ')
    .setColor(0x00FF00)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: 'ユーザー', value: `${member.user.tag} (<@${member.id}>)`, inline: true },
      { name: '認証方法', value: method, inline: true },
      { name: 'アカウント作成経過', value: `${createdDays} 日前`, inline: true }
    )
    .setTimestamp();

  await logChannel.send({ embeds: [embed] }).catch(err => console.error('ログ送信失敗:', err));
}

// 管理者パネルのコンポーネント生成
function buildAdminPanel() {
  const embed = new EmbedBuilder()
    .setTitle('⚙️ Bot管理ダッシュボード')
    .setColor(0x5865F2)
    .setDescription('ボタンを押してDiscord上で各種設定を行えます。')
    .addFields(
      { name: '現在の付与ロールID', value: verifyRoleId ? `<@&${verifyRoleId}> (\`${verifyRoleId}\`)` : '未設定', inline: false },
      { name: '現在のログチャンネル', value: userInfoChannelId ? `<#${userInfoChannelId}> (\`${userInfoChannelId}\`)` : '未設定', inline: false },
      { name: 'サブ垢対策（拒否対象）', value: `作成から \`${minAccountAgeDays}\` 日未満`, inline: false }
    );

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_set_role').setLabel('ロールID変更').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_set_log').setLabel('ログチャンネル変更').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_set_days').setLabel('サブ垢拒否日数変更').setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_deploy_captcha').setLabel('ここに認証パネルを設置').setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [row1, row2] };
}

// Bot起動時
client.on(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setStatus('online');
  client.user.setActivity('認証管理中', { type: 0 });
});

// コマンド処理
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;

  // 管理パネル呼び出しコマンド: !admin
  if (message.content === '!admin') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ このコマンドは管理者のみ使用できます。');
    }
    await message.channel.send(buildAdminPanel());
  }
});

// インタラクション（ボタン・モーダル処理）
client.on(Events.InteractionCreate, async interaction => {

  // --- 管理パネルのボタン操作 ---
  if (interaction.isButton() && interaction.customId.startsWith('admin_')) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ 管理者権限が必要です。', ephemeral: true });
    }

    if (interaction.customId === 'admin_set_role') {
      const modal = new ModalBuilder().setCustomId('modal_set_role').setTitle('付与するロールIDの設定');
      const input = new TextInputBuilder().setCustomId('input_role').setLabel('ロールIDを入力').setStyle(TextInputStyle.Short).setValue(verifyRoleId).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return await interaction.showModal(modal);
    }

    if (interaction.customId === 'admin_set_log') {
      const modal = new ModalBuilder().setCustomId('modal_set_log').setTitle('ログチャンネルIDの設定');
      const input = new TextInputBuilder().setCustomId('input_log').setLabel('チャンネルIDを入力 (空欄で解除)').setStyle(TextInputStyle.Short).setValue(userInfoChannelId || '').setRequired(false);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return await interaction.showModal(modal);
    }

    if (interaction.customId === 'admin_set_days') {
      const modal = new ModalBuilder().setCustomId('modal_set_days').setTitle('サブ垢判定の最低日数設定');
      const input = new TextInputBuilder().setCustomId('input_days').setLabel('最低日数 (例: 3)').setStyle(TextInputStyle.Short).setValue(String(minAccountAgeDays)).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return await interaction.showModal(modal);
    }

    if (interaction.customId === 'admin_deploy_captcha') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('start_captcha').setLabel('画像認証を開始する').setStyle(ButtonStyle.Primary)
      );

      await interaction.channel.send({
        content: '🔒 **サーバー参加認証**\n以下のボタンを押して画像認証（5桁コード入力）を完了してください。',
        components: [row]
      });

      return await interaction.reply({ content: '✅ このチャンネルに認証パネルを設置しました！', ephemeral: true });
    }
  }

  // --- モーダル送信時の処理（管理用） ---
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'modal_set_role') {
      verifyRoleId = interaction.fields.getTextInputValue('input_role').trim();
      await interaction.reply({ content: `✅ ロールIDを \`${verifyRoleId}\` に変更しました。`, ephemeral: true });
      return interaction.message.edit(buildAdminPanel());
    }

    if (interaction.customId === 'modal_set_log') {
      userInfoChannelId = interaction.fields.getTextInputValue('input_log').trim() || null;
      await interaction.reply({ content: `✅ ログチャンネルIDを \`${userInfoChannelId || '未設定'}\` に変更しました。`, ephemeral: true });
      return interaction.message.edit(buildAdminPanel());
    }

    if (interaction.customId === 'modal_set_days') {
      const inputVal = parseInt(interaction.fields.getTextInputValue('input_days').trim());
      if (isNaN(inputVal) || inputVal < 0) {
        return interaction.reply({ content: '❌ 有効な数値を入力してください。', ephemeral: true });
      }
      minAccountAgeDays = inputVal;
      await interaction.reply({ content: `✅ サブ垢拒否条件を \`${minAccountAgeDays}\` 日未満に変更しました。`, ephemeral: true });
      return interaction.message.edit(buildAdminPanel());
    }
  }

  // --- 一般ユーザーの画像キャプチャ認証処理 ---
  if (interaction.isButton() && interaction.customId === 'start_captcha') {
    if (interaction.member.roles.cache.has(verifyRoleId)) {
      return interaction.reply({ content: 'すでに認証済みです！', ephemeral: true });
    }

    // サブ垢チェック
    const createdTimestamp = interaction.user.createdTimestamp;
    const accountAgeDays = (Date.now() - createdTimestamp) / (1000 * 60 * 60 * 24);

    if (accountAgeDays < minAccountAgeDays) {
      return interaction.reply({ 
        content: `⚠️ **認証失敗**: アカウント作成から ${minAccountAgeDays} 日未満のアカウントは認証できません。（サブアカウント防止措置）`, 
        ephemeral: true 
      });
    }

    const captchaText = generateCaptchaText();
    captchaStore.set(interaction.user.id, captchaText);

    const imageBuffer = createCaptchaImage(captchaText);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'captcha.png' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('answer_captcha').setLabel('コードを入力する').setStyle(ButtonStyle.Success)
    );

    await interaction.reply({
      content: '画像の5桁の英数字を覚えてから「コードを入力する」を押してください。',
      files: [attachment],
      components: [row],
      ephemeral: true
    });
  }

  if (interaction.isButton() && interaction.customId === 'answer_captcha') {
    const modal = new ModalBuilder().setCustomId('captcha_modal').setTitle('画像認証コードの入力');
    const input = new TextInputBuilder().setCustomId('captcha_input').setLabel('画像に表示されている文字を入力').setStyle(TextInputStyle.Short).setMaxLength(5).setMinLength(5).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === 'captcha_modal') {
    const userInput = interaction.fields.getTextInputValue('captcha_input').toUpperCase();
    const correctText = captchaStore.get(interaction.user.id);

    if (userInput === correctText) {
      captchaStore.delete(interaction.user.id);
      const role = interaction.guild.roles.cache.get(verifyRoleId);
      if (role) {
        await interaction.member.roles.add(role);
        await interaction.reply({ content: '✅ 認証成功！ロールが付与されました。', ephemeral: true });
        await sendLog(interaction.guild, interaction.member, '画像キャプチャ認証');
      } else {
        await interaction.reply({ content: '⚠️ ロールが見つかりませんでした。設定を確認してください。', ephemeral: true });
      }
    } else {
      await interaction.reply({ content: '❌ コードが違います。もう一度ボタンを押してやり直してください。', ephemeral: true });
    }
  }
});

client.login(process.env.TOKEN);