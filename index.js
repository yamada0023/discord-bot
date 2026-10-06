const http = require('http');
const fs = require('fs');
const path = require('path');

// ============================================================
// Webサーバー
// Render等の常時起動・Keep-Alive用
// ============================================================

http.createServer((req, res) => {
  res.write("Bot is alive!");
  res.end();
}).listen(process.env.PORT || 3000);


// ============================================================
// Discord.js
// ============================================================

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
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType
} = require('discord.js');


// ============================================================
// Discord Client
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction
  ]
});


// ============================================================
// 設定
// ============================================================

let verifyRoleId = '1537841157315231896';
let userInfoChannelId = null;
let roleIds = [
  '1537841157315231896'
];

// ============================================================
// 永続設定（サーバーごと）
// ============================================================
const DATA_DIR = path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'bot-settings.json');

function loadSettings() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(SETTINGS_FILE)) return {};
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (error) {
    console.error('[設定] 読み込みエラー:', error);
    return {};
  }
}

const botSettings = loadSettings();

function defaultGuildSettings() {
  return {
    verifyRoleId: '1537841157315231896',
    userInfoChannelId: null,
    roleIds: ['1537841157315231896'],
    logChannelId: null
  };
}

function getGuildSettings(guildId) {
  if (!botSettings[guildId]) botSettings[guildId] = defaultGuildSettings();
  return botSettings[guildId];
}

function saveSettings() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(botSettings, null, 2), 'utf8');
  } catch (error) {
    console.error('[設定] 保存エラー:', error);
  }
}

function applyGuildSettings(guild) {
  const settings = getGuildSettings(guild.id);
  verifyRoleId = settings.verifyRoleId || verifyRoleId;
  userInfoChannelId = settings.userInfoChannelId || null;
  roleIds = Array.isArray(settings.roleIds) && settings.roleIds.length
    ? settings.roleIds
    : roleIds;
  return settings;
}

function saveCurrentGuildSettings(guild) {
  const settings = getGuildSettings(guild.id);
  settings.verifyRoleId = verifyRoleId;
  settings.userInfoChannelId = userInfoChannelId;
  settings.roleIds = roleIds;
  saveSettings();
}

// ============================================================
// 各種キャッシュ・マップ
// ============================================================
const activeCaptchas = new Map();
const statsChannels = new Map();
const memberStatsCache = new Map();
const statsUpdateTimers = new Map();
const memberRefreshTimers = new Map();


// ============================================================
// 認証ログ
// ============================================================

async function sendLog(guild, member, title, description, color = 0x00FF00) {
  const settings = getGuildSettings(guild.id);
  const targetChannelId = settings.logChannelId || userInfoChannelId;
  if (!targetChannelId) return;

  try {
    const logChannel = guild.channels.cache.get(targetChannelId);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(color)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setDescription(description)
      .setTimestamp();

    await logChannel.send({ embeds: [embed] });
  } catch (error) {
    console.error('ログ送信失敗:', error);
  }
}


// ============================================================
// 認証コード生成
// ============================================================

function generateCaptchaCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let text = '';
  for (let i = 0; i < 6; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}


// ============================================================
// パネル生成用関数
// ============================================================

function buildRolePanelComponents(guild) {
  const settings = getGuildSettings(guild.id);
  const currentRoles = settings.roleIds || roleIds;
  const rows = [];
  let currentRow = new ActionRowBuilder();

  for (const roleId of currentRoles) {
    const role = guild.roles.cache.get(roleId);
    const labelName = role ? role.name : `未設定 (${roleId})`;

    const button = new ButtonBuilder()
      .setCustomId(`toggle_role_${roleId}`)
      .setLabel(`🏷️ ${labelName}`)
      .setStyle(ButtonStyle.Primary);

    currentRow.addComponents(button);

    if (currentRow.components.length >= 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
  }

  if (currentRow.components.length > 0) {
    rows.push(currentRow);
  }

  return rows;
}

function buildVerifyAdminPanel(guild) {
  const settings = getGuildSettings(guild.id);
  const embed = new EmbedBuilder()
    .setTitle('⚙️ メンバー認証 管理ダッシュボード')
    .setColor(0x5865F2)
    .addFields(
      {
        name: '認証付与ロール',
        value: settings.verifyRoleId ? `<@&${settings.verifyRoleId}>` : '未設定'
      },
      {
        name: 'ログチャンネル',
        value: (settings.logChannelId || userInfoChannelId) ? `<#${settings.logChannelId || userInfoChannelId}>` : '未設定'
      }
    );

  const roleSelectRow = new ActionRowBuilder()
    .addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId('select_verify_role')
        .setPlaceholder('付与するロールを選択してください')
        .setMinValues(1)
        .setMaxValues(1)
    );

  const channelSelectRow = new ActionRowBuilder()
    .addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('select_log_channel')
        .setPlaceholder('ログ出力先のテキストチャンネルを選択')
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1)
    );

  const buttonRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('admin_deploy_verify_panel')
        .setLabel('ここに認証パネルを設置')
        .setStyle(ButtonStyle.Success)
    );

  return {
    embeds: [embed],
    components: [roleSelectRow, channelSelectRow, buttonRow]
  };
}

function buildRoleAdminPanel(guild) {
  const settings = getGuildSettings(guild.id);
  const currentRoles = settings.roleIds || roleIds;
  const roleDisplay = currentRoles.length > 0
    ? currentRoles.map(id => `<@&${id}>`).join('\n')
    : '未設定';

  const embed = new EmbedBuilder()
    .setTitle('⚙️ ロールパネル 管理ダッシュボード')
    .setColor(0x5865F2)
    .addFields({
      name: '対象ロール一覧 (複数指定可)',
      value: roleDisplay
    });

  const roleSelectRow = new ActionRowBuilder()
    .addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId('select_multi_roles')
        .setPlaceholder('パネルに表示するロールを選択')
        .setMinValues(1)
        .setMaxValues(25)
    );

  const buttonRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('admin_deploy_role_panel')
        .setLabel('ここにロール選択パネルを設置')
        .setStyle(ButtonStyle.Success)
    );

  return {
    embeds: [embed],
    components: [roleSelectRow, buttonRow]
  };
}


// ============================================================
// 統計関連関数
// ============================================================

async function refreshMemberStats(guild) {
  try {
    const members = await guild.members.fetch();
    let humanCount = 0;
    let botCount = 0;

    for (const member of members.values()) {
      if (member.user.bot) botCount++;
      else humanCount++;
    }

    const totalMembers = Math.max(members.size, guild.memberCount || 0);
    const result = { totalMembers, humanCount, botCount };
    memberStatsCache.set(guild.id, result);
    return result;
  } catch (error) {
    console.error(`[統計取得] エラー (${guild.name}):`, error);
    return memberStatsCache.get(guild.id) || {
      totalMembers: guild.memberCount || 0,
      humanCount: 0,
      botCount: 0
    };
  }
}

async function getServerStats(guild) {
  const cached = memberStatsCache.get(guild.id);
  const totalMembers = cached ? cached.totalMembers : guild.memberCount;
  const humanCount = cached ? cached.humanCount : guild.members.cache.filter(m => !m.user.bot).size;
  const botCount = cached ? cached.botCount : guild.members.cache.filter(m => m.user.bot).size;
  const voiceCount = guild.members.cache.filter(member => member.voice && member.voice.channel).size;

  return { totalMembers, humanCount, botCount, voiceCount };
}

async function updateStatsChannels(guild) {
  try {
    if (!guild) return;
    const stats = await getServerStats(guild);
    let channelIds = statsChannels.get(guild.id);

    if (!channelIds) {
      const channels = guild.channels.cache;
      const totalChannel = channels.find(c => c.type === ChannelType.GuildVoice && c.name.startsWith('📊 総メンバー数'));
      const humanChannel = channels.find(c => c.type === ChannelType.GuildVoice && c.name.startsWith('📊 人間'));
      const botChannel = channels.find(c => c.type === ChannelType.GuildVoice && c.name.startsWith('📊 Bot'));
      const voiceChannel = channels.find(c => c.type === ChannelType.GuildVoice && c.name.startsWith('📊 VC参加中'));

      if (totalChannel && humanChannel && botChannel && voiceChannel) {
        channelIds = {
          total: totalChannel.id,
          human: humanChannel.id,
          bot: botChannel.id,
          voice: voiceChannel.id
        };
        statsChannels.set(guild.id, channelIds);
      } else {
        return;
      }
    }

    const totalChannel = guild.channels.cache.get(channelIds.total);
    const humanChannel = guild.channels.cache.get(channelIds.human);
    const botChannel = guild.channels.cache.get(channelIds.bot);
    const voiceChannel = guild.channels.cache.get(channelIds.voice);

    if (totalChannel && totalChannel.name !== `📊 総メンバー数: ${stats.totalMembers}`) {
      await totalChannel.setName(`📊 総メンバー数: ${stats.totalMembers}`);
    }
    if (humanChannel && humanChannel.name !== `📊 人間: ${stats.humanCount}`) {
      await humanChannel.setName(`📊 人間: ${stats.humanCount}`);
    }
    if (botChannel && botChannel.name !== `📊 Bot: ${stats.botCount}`) {
      await botChannel.setName(`📊 Bot: ${stats.botCount}`);
    }
    if (voiceChannel && voiceChannel.name !== `📊 VC参加中: ${stats.voiceCount}`) {
      await voiceChannel.setName(`📊 VC参加中: ${stats.voiceCount}`);
    }
  } catch (error) {
    console.error(`[統計VC] 更新エラー (${guild.name}):`, error);
  }
}


// ============================================================
// イベント: 準備完了
// ============================================================

client.once(Events.ClientReady, async (c) => {
  console.log(`[ログイン成功] ${c.user.tag} としてログインしました！`);
  
  // スラッシュコマンドの登録
  const commands = [
    new SlashCommandBuilder()
      .setName('clear')
      .setDescription('指定した件数のメッセージを一括削除します')
      .addIntegerOption(option =>
        option.setName('count').setDescription('削除するメッセージ数 (1〜100)').setRequired(true).setMinValue(1).setMaxValue(100)
      ),
    new SlashCommandBuilder()
      .setName('role-panel')
      .setDescription('ロール選択パネルを設置します'),
    new SlashCommandBuilder()
      .setName('setup-role')
      .setDescription('ロール付与パネルの設定管理画面を表示します'),
    new SlashCommandBuilder()
      .setName('setup-verify')
      .setDescription('認証の設定管理画面を表示します'),
    new SlashCommandBuilder()
      .setName('verify')
      .setDescription('認証パネルを設置します')
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
    console.log('[スラッシュコマンド] 登録が完了しました。');
  } catch (error) {
    console.error('[スラッシュコマンド] 登録エラー:', error);
  }
});


// ============================================================
// イベント: インタラクション処理（コマンド・ボタン・メニュー）
// ============================================================

client.on(Events.InteractionCreate, async (interaction) => {
  const guild = interaction.guild;
  if (!guild) return;

  // 1. スラッシュコマンド
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === 'clear') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return interaction.reply({ content: 'このコマンドを実行する権限がありません。', ephemeral: true });
      }
      const count = interaction.options.getInteger('count');
      await interaction.deferReply({ ephemeral: true });
      try {
        const deleted = await interaction.channel.bulkDelete(count, true);
        await interaction.editReply({ content: `${deleted.size} 件のメッセージを削除しました。` });
      } catch (error) {
        await interaction.editReply({ content: 'メッセージの削除に失敗しました。' });
      }
    }

    else if (commandName === 'setup-verify') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '管理者権限が必要です。', ephemeral: true });
      }
      const panel = buildVerifyAdminPanel(guild);
      await interaction.reply({ embeds: panel.embeds, components: panel.components, ephemeral: true });
    }

    else if (commandName === 'setup-role') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '管理者権限が必要です。', ephemeral: true });
      }
      const panel = buildRoleAdminPanel(guild);
      await interaction.reply({ embeds: panel.embeds, components: panel.components, ephemeral: true });
    }

    else if (commandName === 'verify' || commandName === 'role-panel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '管理者権限が必要です。', ephemeral: true });
      }
      await interaction.reply({ content: 'ダッシュボードの「ここに設置」ボタンまたは個別の設定コマンドをご利用ください。', ephemeral: true });
    }
  }

  // 2. セレクトメニュー
  else if (interaction.isStringSelectMenu() || interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu()) {
    const settings = getGuildSettings(guild.id);

    if (interaction.customId === 'select_verify_role') {
      const selectedRoleId = interaction.values[0];
      settings.verifyRoleId = selectedRoleId;
      verifyRoleId = selectedRoleId;
      saveSettings();
      await interaction.update(buildVerifyAdminPanel(guild));
    }

    else if (interaction.customId === 'select_log_channel') {
      const selectedChannelId = interaction.values[0];
      settings.logChannelId = selectedChannelId;
      userInfoChannelId = selectedChannelId;
      saveSettings();
      await interaction.update(buildVerifyAdminPanel(guild));
    }

    else if (interaction.customId === 'select_multi_roles') {
      settings.roleIds = interaction.values;
      roleIds = interaction.values;
      saveSettings();
      await interaction.update(buildRoleAdminPanel(guild));
    }
  }

  // 3. ボタン操作
  else if (interaction.isButton()) {
    if (interaction.customId === 'admin_deploy_verify_panel') {
      const embed = new EmbedBuilder()
        .setTitle('🔒 メンバー認証')
        .setDescription('下のボタンを押して認証を開始してください。')
        .setColor(0x00FF00);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('start_verify').setLabel('認証する').setStyle(ButtonStyle.Success)
      );

      await interaction.channel.send({ embeds: [embed], components: [row] });
      await interaction.reply({ content: '認証パネルをこのチャンネルに設置しました！', ephemeral: true });
    }

    else if (interaction.customId === 'admin_deploy_role_panel') {
      const components = buildRolePanelComponents(guild);
      const embed = new EmbedBuilder()
        .setTitle('🏷️ ロール選択パネル')
        .setDescription('ボタンを押してロールの取得・解除を行えます。')
        .setColor(0x5865F2);

      await interaction.channel.send({ embeds: [embed], components: components });
      await interaction.reply({ content: 'ロール選択パネルをこのチャンネルに設置しました！', ephemeral: true });
    }

    else if (interaction.customId === 'start_verify') {
      const code = generateCaptchaCode();
      activeCaptchas.set(interaction.user.id, code);
      await interaction.reply({ content: `認証コード: **${code}** (この機能は簡易認証です)`, ephemeral: true });
      
      // 仮でロールを付与する処理
      const settings = getGuildSettings(guild.id);
      if (settings.verifyRoleId) {
        try {
          await interaction.member.roles.add(settings.verifyRoleId);
          await sendLog(guild, interaction.member, 'メンバー認証成功', `${interaction.user.tag} が認証を完了しました。`);
        } catch (e) {
          console.error('認証ロール付与失敗:', e);
        }
      }
    }

    else if (interaction.customId.startsWith('toggle_role_')) {
      const roleId = interaction.customId.replace('toggle_role_', '');
      const member = interaction.member;

      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
        await interaction.reply({ content: `<@&${roleId}> を外しました。`, ephemeral: true });
      } else {
        await member.roles.add(roleId);
        await interaction.reply({ content: `<@&${roleId}> を付与しました。`, ephemeral: true });
      }
    }
  }
});


// ============================================================
// ログイン処理（Discordへの接続）
// ============================================================

client.login(process.env.DISCORD_TOKEN);