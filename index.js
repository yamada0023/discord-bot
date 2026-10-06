const http = require('http');
const { createCanvas } = require('canvas');

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
  EmbedBuilder,
  AttachmentBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType
} = require('discord.js');

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

// --- 設定データ保持用変数 ---
let verifyRoleId = '1537841157315231896'; // 画像認証ロールID
let userInfoChannelId = null; // ログチャンネルID
let roleIds = ['1537841157315231896']; // ロールパネル用ロールIDリスト

// 一時データ（画像認証コード保持）
const activeCaptchas = new Map();

// --- 便利関数: ログ送信 ---
async function sendLog(guild, member, title, description, color = 0x00FF00) {
  if (!userInfoChannelId) return;
  const logChannel = guild.channels.cache.get(userInfoChannelId);
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .setDescription(description)
    .setTimestamp();

  await logChannel.send({ embeds: [embed] }).catch(err => console.error('ログ送信失敗:', err));
}

// --- 画像認証用の画像生成 ---
function generateCaptcha() {
  const canvas = createCanvas(300, 100);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#23272A';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 7; i++) {
    ctx.strokeStyle = `rgba(${Math.random()*255}, ${Math.random()*255}, ${Math.random()*255}, 0.5)`;
    ctx.lineWidth = Math.random() * 3;
    ctx.beginPath();
    ctx.moveTo(Math.random() * canvas.width, Math.random() * canvas.height);
    ctx.lineTo(Math.random() * canvas.width, Math.random() * canvas.height);
    ctx.stroke();
  }

  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let text = '';
  for (let i = 0; i < 6; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  ctx.font = 'bold 36px sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.save();
  ctx.translate(150, 50);
  ctx.rotate((Math.random() - 0.5) * 0.2);
  ctx.fillText(text, 0, 0);
  ctx.restore();

  return { text, buffer: canvas.toBuffer() };
}

// --- ロール選択パネルのコンポーネント生成 ---
function buildRolePanelComponents(guild) {
  const rows = [];
  let currentRow = new ActionRowBuilder();

  for (const rId of roleIds) {
    const role = guild.roles.cache.get(rId);
    const labelName = role ? role.name : `未設定 (${rId})`;

    const button = new ButtonBuilder()
      .setCustomId(`toggle_role_${rId}`)
      .setLabel(`🏷️ ${labelName}`)
      .setStyle(ButtonStyle.Primary);

    currentRow.addComponents(button);

    if (currentRow.components.length === 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
  }

  if (currentRow.components.length > 0) {
    rows.push(currentRow);
  }

  return rows;
}

// --- 管理画面 Embed & コンポーネント生成 ---
// 1. 画像認証 管理画面
function buildVerifyAdminPanel() {
  const embed = new EmbedBuilder()
    .setTitle('⚙️ 画像認証 管理ダッシュボード')
    .setColor(0x5865F2)
    .addFields(
      { name: '認証付与ロール', value: verifyRoleId ? `<@&${verifyRoleId}>` : '未設定' },
      { name: 'ログチャンネル', value: userInfoChannelId ? `<#${userInfoChannelId}>` : '未設定' }
    );

  const roleSelectRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('select_verify_role')
      .setPlaceholder('付与するロールを選択してください')
      .setMinValues(1)
      .setMaxValues(1)
  );

  const channelSelectRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('select_log_channel')
      .setPlaceholder('ログ出力先のテキストチャンネルを選択')
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(0)
      .setMaxValues(1)
  );

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_deploy_verify_panel').setLabel('ここに画像認証パネルを設置').setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [roleSelectRow, channelSelectRow, buttonRow] };
}

// 2. ロール付与 管理画面
function buildRoleAdminPanel() {
  const roleDisplay = roleIds.map(id => `<@&${id}>`).join('\n') || '未設定';

  const embed = new EmbedBuilder()
    .setTitle('⚙️ ロールパネル 管理ダッシュボード')
    .setColor(0x5865F2)
    .addFields(
      { name: '対象ロール一覧 (複数指定可)', value: roleDisplay },
      { name: 'ログチャンネル', value: userInfoChannelId ? `<#${userInfoChannelId}>` : '未設定' }
    );

  const roleSelectRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('select_multi_roles')
      .setPlaceholder('パネルに表示するロールを選択 (複数可)')
      .setMinValues(1)
      .setMaxValues(25)
  );

  const channelSelectRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('select_log_channel')
      .setPlaceholder('ログ出力先のテキストチャンネルを選択')
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(0)
      .setMaxValues(1)
  );

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_deploy_role_panel').setLabel('ここにロール選択パネルを設置').setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [roleSelectRow, channelSelectRow, buttonRow] };
}

// --- スラッシュコマンド登録 ---
client.on(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setStatus('online');
  client.user.setActivity('認証＆ロール管理', { type: 0 });

  const commands = [
    new SlashCommandBuilder().setName('setup-verify').setDescription('画像認証の設定管理画面を表示します'),
    new SlashCommandBuilder().setName('verify').setDescription('画像認証パネルを設置します'),
    new SlashCommandBuilder().setName('setup-role').setDescription('ロール付与パネルの設定管理画面を表示します'),
    new SlashCommandBuilder().setName('role-panel').setDescription('ロール選択パネルを設置します')
  ].map(command => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('すべてのスラッシュコマンドの登録が完了しました！');
  } catch (error) {
    console.error('スラッシュコマンド登録エラー:', error);
  }
});

// --- インタラクション処理 ---
client.on(Events.InteractionCreate, async interaction => {

  // --- スラッシュコマンド ---
  if (interaction.isChatInputCommand()) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ このコマンドは管理者専用です。', ephemeral: true });
    }

    if (interaction.commandName === 'setup-verify') {
      return interaction.reply(buildVerifyAdminPanel());
    }

    if (interaction.commandName === 'verify') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('start_captcha_verify').setLabel('🔒 画像認証を開始').setStyle(ButtonStyle.Success)
      );
      return interaction.reply({
        content: '📋 **メンバー認証**\n以下のボタンを押して画像認証を行ってください。',
        components: [row]
      });
    }

    if (interaction.commandName === 'setup-role') {
      return interaction.reply(buildRoleAdminPanel());
    }

    if (interaction.commandName === 'role-panel') {
      const components = buildRolePanelComponents(interaction.guild);
      if (components.length === 0) {
        return interaction.reply({ content: '⚠️ ロールが選択されていません。`/setup-role` で設定してください。', ephemeral: true });
      }
      return interaction.reply({
        content: '📋 **ロール選択**\n以下のボタンを押してロールを取得・解除できます。',
        components: components
      });
    }
  }

  // --- ドロップダウンメニューの操作 ---
  if (interaction.isRoleSelectMenu()) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ 管理者権限が必要です。', ephemeral: true });
    }

    // 画像認証ロール選択
    if (interaction.customId === 'select_verify_role') {
      verifyRoleId = interaction.values[0];
      await interaction.update(buildVerifyAdminPanel());
      return;
    }

    // ロールパネル用一括ロール選択
    if (interaction.customId === 'select_multi_roles') {
      roleIds = interaction.values;
      await interaction.update(buildRoleAdminPanel());
      return;
    }
  }

  if (interaction.isChannelSelectMenu()) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ 管理者権限が必要です。', ephemeral: true });
    }

    // ログチャンネル選択
    if (interaction.customId === 'select_log_channel') {
      userInfoChannelId = interaction.values[0] || null;
      
      // 更新元メッセージに応じて管理パネルを再構築
      if (interaction.message.embeds[0]?.title?.includes('画像認証')) {
        await interaction.update(buildVerifyAdminPanel());
      } else {
        await interaction.update(buildRoleAdminPanel());
      }
      return;
    }
  }

  // --- 管理パネル ボタン操作 ---
  if (interaction.isButton() && interaction.customId.startsWith('admin_')) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ 管理者権限が必要です。', ephemeral: true });
    }

    // 画像認証パネル設置
    if (interaction.customId === 'admin_deploy_verify_panel') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('start_captcha_verify').setLabel('🔒 画像認証を開始').setStyle(ButtonStyle.Success)
      );
      await interaction.channel.send({
        content: '📋 **メンバー認証**\n以下のボタンを押して画像認証を行ってください。',
        components: [row]
      });
      return await interaction.reply({ content: '✅ 画像認証パネルを設置しました！', ephemeral: true });
    }

    // ロール選択パネル設置
    if (interaction.customId === 'admin_deploy_role_panel') {
      const components = buildRolePanelComponents(interaction.guild);
      if (components.length === 0) return interaction.reply({ content: '⚠️ ロールが選択されていません。', ephemeral: true });

      await interaction.channel.send({
        content: '📋 **ロール選択**\n以下のボタンを押してロールを取得・解除できます。',
        components: components
      });
      return await interaction.reply({ content: '✅ ロール選択パネルを設置しました！', ephemeral: true });
    }
  }

  // --- モーダル送信処理 ---
  if (interaction.isModalSubmit() && interaction.customId === 'modal_submit_captcha') {
    const userAnswer = interaction.fields.getTextInputValue('input_captcha_answer').trim().toUpperCase();
    const correctAnswer = activeCaptchas.get(interaction.user.id);

    if (!correctAnswer) {
      return interaction.reply({ content: '❌ 認証セッションの期限が切れました。もう一度ボタンを押してください。', ephemeral: true });
    }

    if (userAnswer === correctAnswer) {
      activeCaptchas.delete(interaction.user.id);
      const role = interaction.guild.roles.cache.get(verifyRoleId);

      if (!role) {
        return interaction.reply({ content: '⚠️ 認証用ロールが見つかりませんでした。', ephemeral: true });
      }

      try {
        await interaction.member.roles.add(role);
        await interaction.reply({ content: `🎉 **認証成功！** <@&${verifyRoleId}> ロールが付与されました。`, ephemeral: true });
        await sendLog(interaction.guild, interaction.member, '🔒 画像認証成功', `ユーザー: ${interaction.user.tag} (<@${interaction.user.id}>)`);
      } catch (err) {
        console.error(err);
        await interaction.reply({ content: '❌ ロールの付与に失敗しました。Botの権限順位を確認してください。', ephemeral: true });
      }
    } else {
      await interaction.reply({ content: '❌ コードが一致しません。もう一度ボタンを押してやり直してください。', ephemeral: true });
    }
  }

  // --- 一般ユーザー用ボタン操作 ---
  if (interaction.isButton()) {
    // 1. 画像認証ボタン押下
    if (interaction.customId === 'start_captcha_verify') {
      const { text, buffer } = generateCaptcha();
      activeCaptchas.set(interaction.user.id, text);

      const attachment = new AttachmentBuilder(buffer, { name: 'captcha.png' });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('open_captcha_modal').setLabel('回答を入力する').setStyle(ButtonStyle.Primary)
      );

      return await interaction.reply({
        content: '画像の文字を入力してください（大文字・小文字区別なし）:',
        files: [attachment],
        components: [row],
        ephemeral: true
      });
    }

    // 2. 画像認証 回答入力モーダル呼び出し
    if (interaction.customId === 'open_captcha_modal') {
      const modal = new ModalBuilder().setCustomId('modal_submit_captcha').setTitle('画像認証');
      const input = new TextInputBuilder().setCustomId('input_captcha_answer').setLabel('画像に表示されている文字').setStyle(TextInputStyle.Short).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return await interaction.showModal(modal);
    }

    // 3. ロール選択ボタン押下 (トロール切り替え)
    if (interaction.customId.startsWith('toggle_role_')) {
      const targetRoleId = interaction.customId.replace('toggle_role_', '');
      const role = interaction.guild.roles.cache.get(targetRoleId);

      if (!role) {
        return interaction.reply({ content: '⚠️ ロールが見つかりません。', ephemeral: true });
      }

      try {
        if (interaction.member.roles.cache.has(targetRoleId)) {
          await interaction.member.roles.remove(role);
          await interaction.reply({ content: `❌ **${role.name}** ロールを解除しました。`, ephemeral: true });
          await sendLog(interaction.guild, interaction.member, '🏷️ ロール解除', `ユーザー: ${interaction.user.tag}\nロール: **${role.name}**`, 0xFF0000);
        } else {
          await interaction.member.roles.add(role);
          await interaction.reply({ content: `✅ **${role.name}** ロールが付与されました！`, ephemeral: true });
          await sendLog(interaction.guild, interaction.member, '🏷️ ロール付与', `ユーザー: ${interaction.user.tag}\nロール: **${role.name}**`, 0x00FF00);
        }
      } catch (error) {
        console.error(error);
        await interaction.reply({ content: '❌ ロールの操作に失敗しました。Botの権限順位を確認してください。', ephemeral: true });
      }
    }
  }
});

client.login(process.env.TOKEN);