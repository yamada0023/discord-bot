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
  EmbedBuilder 
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
let verifyRoleId = '1537841157315231896'; // デフォルトの認証ロールID
let userInfoChannelId = null; // デフォルトのログ/ユーザー情報出力チャンネルID

// ★サブ垢対策：アカウント作成から必要な最低日数（3日未満は拒否）
const MIN_ACCOUNT_AGE_DAYS = 3; 

// リアクション用絵文字のリスト (10個まで対応)
const EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

// キャプチャ認証用の文字保存用マップ
const captchaStore = new Map();

// ランダムな文字列（5桁）を生成する関数
function generateCaptchaText() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 見間違いやすい0, O, 1, Iを除外
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

  // 背景
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, 200, 70);

  // ノイズ線を描画（Bot対策）
  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = `#${Math.floor(Math.random()*16777215).toString(16)}`;
    ctx.beginPath();
    ctx.moveTo(Math.random() * 200, Math.random() * 70);
    ctx.lineTo(Math.random() * 200, Math.random() * 70);
    ctx.stroke();
  }

  // 文字を描画
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

// Bot起動時の処理
client.on(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setStatus('online');
  client.user.setActivity('稼働中', { type: 0 });
});

// メッセージ作成イベント（管理コマンド群）
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;

  // 1. 認証ロールID設定コマンド: !verify <RoleID>
  if (message.content.startsWith('!verify')) {
    const args = message.content.split(' ');
    if (args[1]) {
      verifyRoleId = args[1];
      await message.channel.send(`認証ロールIDを \`${verifyRoleId}\` に設定しました。`);
    } else {
      await message.channel.send(`現在の認証ロールIDは \`${verifyRoleId}\` です。`);
    }
  }

  // 2. ログチャンネルID設定コマンド: !userinfo <ChannelID>
  if (message.content.startsWith('!userinfo')) {
    const args = message.content.split(' ');
    if (args[1]) {
      userInfoChannelId = args[1];
      await message.channel.send(`ログ用チャンネルIDを \`${userInfoChannelId}\` に設定しました。`);
    } else {
      await message.channel.send(`現在のログ用チャンネルIDは \`${userInfoChannelId || '未設定'}\` です。`);
    }
  }

  // 3. 画像キャプチャ認証パネル設置コマンド: !setup-captcha
  if (message.content === '!setup-captcha') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('start_captcha')
        .setLabel('画像認証を開始する')
        .setStyle(ButtonStyle.Primary)
    );

    await message.channel.send({
      content: '🔒 **サーバー参加認証（強固）**\n以下のボタンを押して画像認証（5桁コード入力）を完了してください。',
      components: [row]
    });
  }
});

// ボタン・モーダル操作（画像キャプチャ認証＆サブ垢チェック）の検知
client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isButton() && interaction.customId === 'start_captcha') {
    // 既にロールを持っている場合
    if (interaction.member.roles.cache.has(verifyRoleId)) {
      return interaction.reply({ content: 'すでに認証済みです！', ephemeral: true });
    }

    // ★サブ垢判定（作成日数の確認）
    const createdTimestamp = interaction.user.createdTimestamp;
    const now = Date.now();
    const accountAgeDays = (now - createdTimestamp) / (1000 * 60 * 60 * 24);

    if (accountAgeDays < MIN_ACCOUNT_AGE_DAYS) {
      return interaction.reply({ 
        content: `⚠️ **認証失敗**: アカウント作成から ${MIN_ACCOUNT_AGE_DAYS} 日未満のアカウントは認証できません。（サブアカウント・スパム防止措置）`, 
        ephemeral: true 
      });
    }

    const captchaText = generateCaptchaText();
    captchaStore.set(interaction.user.id, captchaText);

    const imageBuffer = createCaptchaImage(captchaText);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'captcha.png' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('answer_captcha')
        .setLabel('コードを入力する')
        .setStyle(ButtonStyle.Success)
    );

    await interaction.reply({
      content: '画像の5桁の英数字を覚えてから「コードを入力する」を押してください。',
      files: [attachment],
      components: [row],
      ephemeral: true
    });
  }

  if (interaction.isButton() && interaction.customId === 'answer_captcha') {
    const modal = new ModalBuilder()
      .setCustomId('captcha_modal')
      .setTitle('画像認証コードの入力');

    const input = new TextInputBuilder()
      .setCustomId('captcha_input')
      .setLabel('画像に表示されている文字を入力')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(5)
      .setMinLength(5)
      .setRequired(true);

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
        
        // ログ出力
        await sendLog(interaction.guild, interaction.member, '画像キャプチャ認証');
      } else {
        await interaction.reply({ content: '⚠️ ロールが見つかりませんでした。設定を確認してください。', ephemeral: true });
      }
    } else {
      await interaction.reply({ content: '❌ コードが違います。もう一度ボタンを押してやり直してください。', ephemeral: true });
    }
  }
});

// リアクション追加時の認証ロール付与処理（従来の簡易認証機能）
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;

  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error('リアクションの取得に失敗しました:', error);
      return;
    }
  }

  // サブ垢判定（リアクション認証時にも適用）
  const accountAgeDays = (Date.now() - user.createdTimestamp) / (1000 * 60 * 60 * 24);
  if (accountAgeDays < MIN_ACCOUNT_AGE_DAYS) {
    console.log(`${user.tag} は作成から ${MIN_ACCOUNT_AGE_DAYS} 日未満のためロール付与を拒否しました。`);
    return;
  }

  if (verifyRoleId) {
    try {
      const guild = reaction.message.guild;
      const member = await guild.members.fetch(user.id);
      const role = guild.roles.cache.get(verifyRoleId);
      if (role && !member.roles.cache.has(verifyRoleId)) {
        await member.roles.add(role);
        console.log(`${user.tag} にロールが付与されました。`);
        
        // ログ出力
        await sendLog(guild, member, '絵文字リアクション認証');
      }
    } catch (error) {
      console.error('ロールの付与に失敗しました:', error);
    }
  }
});

client.login(process.env.TOKEN);