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
    // サーバー
    GatewayIntentBits.Guilds,
    // メンバー情報
    GatewayIntentBits.GuildMembers,
    // メッセージ
    GatewayIntentBits.GuildMessages,
    // リアクション
    GatewayIntentBits.GuildMessageReactions,
    // メッセージ内容
    GatewayIntentBits.MessageContent,
    // VC
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

// 認証ロール
let verifyRoleId = '1537841157315231896';

// 認証ログチャンネル
let userInfoChannelId = null;

// ロールパネル
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
    logChannelId: null,
    ticketCategoryId: null,
    ticketSupportRoleId: null,
    ticketPanelChannelId: null
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
// 認証コード
// ============================================================

const activeCaptchas = new Map();


// ============================================================
// 統計VC
// ============================================================

const statsChannels = new Map();


// ============================================================
// メンバー統計キャッシュ
// ============================================================

const memberStatsCache = new Map();


// ============================================================
// 統計更新タイマー
// ============================================================

const statsUpdateTimers = new Map();


// ============================================================
// メンバー再取得タイマー
// ============================================================

const memberRefreshTimers = new Map();


// ============================================================
// 認証ログ
// ============================================================

async function sendLog(
  guild,
  member,
  title,
  description,
  color = 0x00FF00
) {
  if (!userInfoChannelId) return;

  try {
    const settings = getGuildSettings(guild.id);
    const targetChannelId = settings.logChannelId || userInfoChannelId;
    const logChannel = guild.channels.cache.get(targetChannelId);

    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(color)
      .setThumbnail(
        member.user.displayAvatarURL({
          dynamic: true
        })
      )
      .setDescription(description)
      .setTimestamp();

    await logChannel.send({
      embeds: [embed]
    });
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
    text += chars.charAt(
      Math.floor(Math.random() * chars.length)
    );
  }
  return text;
}


// ============================================================
// ロールパネル生成
// ============================================================

function buildRolePanelComponents(guild) {
  const rows = [];
  let currentRow = new ActionRowBuilder();

  for (const roleId of roleIds) {
    const role = guild.roles.cache.get(roleId);
    const labelName = role ? role.name : `未設定 (${roleId})`;

    const button = new ButtonBuilder()
      .setCustomId(`toggle_role_${roleId}`)
      .setLabel(`🏷️ ${labelName}`)
      .setStyle(ButtonStyle.Primary);

    currentRow.addComponents(button);

    // 1行5個まで
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


// ============================================================
// 認証管理パネル
// ============================================================

function buildVerifyAdminPanel() {
  const embed = new EmbedBuilder()
    .setTitle('⚙️ メンバー認証 管理ダッシュボード')
    .setColor(0x5865F2)
    .addFields(
      {
        name: '認証付与ロール',
        value: verifyRoleId ? `<@&${verifyRoleId}>` : '未設定'
      },
      {
        name: 'ログチャンネル',
        value: userInfoChannelId ? `<#${userInfoChannelId}>` : '未設定'
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
        .setMinValues(0)
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
    components: [
      roleSelectRow,
      channelSelectRow,
      buttonRow
    ]
  };
}


// ============================================================
// ロール管理パネル
// ============================================================

function buildRoleAdminPanel() {
  const roleDisplay = roleIds.length > 0
    ? roleIds.map(id => `<@&${id}>`).join('\n')
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
    components: [
      roleSelectRow,
      buttonRow
    ]
  };
}


// ============================================================
// 正確なメンバー統計取得
// ============================================================

async function refreshMemberStats(guild) {
  try {
    console.log(`[統計取得] ${guild.name} のメンバー情報を取得中...`);

    const members = await guild.members.fetch();
    let humanCount = 0;
    let botCount = 0;

    for (const member of members.values()) {
      if (member.user.bot) {
        botCount++;
      } else {
        humanCount++;
      }
    }

    const fetchedTotal = members.size;
    const officialTotal = guild.memberCount || 0;
    let totalMembers = fetchedTotal;

    if (officialTotal > totalMembers) {
      console.warn(`[統計警告] ${guild.name} | fetch=${fetchedTotal} | Discord=${officialTotal}`);
      totalMembers = officialTotal;
    }

    const result = {
      totalMembers,
      humanCount,
      botCount
    };

    memberStatsCache.set(guild.id, result);

    console.log(
      `[統計取得完了] ${guild.name}` +
      ` | 総:${totalMembers}` +
      ` | 人間:${humanCount}` +
      ` | Bot:${botCount}`
    );

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


// ============================================================
// サーバー統計
// ============================================================

async function getServerStats(guild) {
  const cached = memberStatsCache.get(guild.id);
  const totalMembers = cached ? cached.totalMembers : guild.memberCount;
  const humanCount = cached ? cached.humanCount : guild.members.cache.filter(m => !m.user.bot).size;
  const botCount = cached ? cached.botCount : guild.members.cache.filter(m => m.user.bot).size;

  const voiceCount = guild.members.cache.filter(
    member => member.voice && member.voice.channel
  ).size;

  return {
    totalMembers,
    humanCount,
    botCount,
    voiceCount
  };
}


// ============================================================
// 統計VC作成
// ============================================================

async function createStatsChannels(guild) {
  try {
    console.log(`[統計VC] ${guild.name} の統計チャンネルを確認中...`);

    const stats = await getServerStats(guild);
    const existingChannels = guild.channels.cache.filter(
      channel => channel.type === ChannelType.GuildVoice && channel.name.startsWith('📊')
    );

    let totalChannel = existingChannels.find(c => c.name.startsWith('📊 総メンバー数'));
    let humanChannel = existingChannels.find(c => c.name.startsWith('📊 人間'));
    let botChannel = existingChannels.find(c => c.name.startsWith('📊 Bot'));
    let voiceChannel = existingChannels.find(c => c.name.startsWith('📊 VC参加中'));

    if (!totalChannel) {
      totalChannel = await guild.channels.create({
        name: `📊 総メンバー数: ${stats.totalMembers}`,
        type: ChannelType.GuildVoice,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.Connect]
          }
        ]
      });
    }

    if (!humanChannel) {
      humanChannel = await guild.channels.create({
        name: `📊 人間: ${stats.humanCount}`,
        type: ChannelType.GuildVoice,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.Connect]
          }
        ]
      });
    }

    if (!botChannel) {
      botChannel = await guild.channels.create({
        name: `📊 Bot: ${stats.botCount}`,
        type: ChannelType.GuildVoice,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.Connect]
          }
        ]
      });
    }

    if (!voiceChannel) {
      voiceChannel = await guild.channels.create({
        name: `📊 VC参加中: ${stats.voiceCount}`,
        type: ChannelType.GuildVoice,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.Connect]
          }
        ]
      });
    }

    statsChannels.set(guild.id, {
      total: totalChannel.id,
      human: humanChannel.id,
      bot: botChannel.id,
      voice: voiceChannel.id
    });

    await updateStatsChannels(guild);
  } catch (error) {
    console.error(`[統計VC] 作成エラー (${guild.name}):`, error);
  }
}


// ============================================================
// 統計VC更新
// ============================================================

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
        return createStatsChannels(guild);
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

    console.log(
      `[統計更新] ${guild.name}` +
      ` | 総:${stats.totalMembers}` +
      ` | 人間:${stats.humanCount}` +
      ` | Bot:${stats.botCount}` +
      ` | VC:${stats.voiceCount}`
    );
  } catch (error) {
    console.error(`[統計VC] 更新エラー (${guild.name}):`, error);
  }
}


// ============================================================
// 統計更新予約
// ============================================================

function scheduleStatsUpdate(guild) {
  if (!guild) return;

  if (statsUpdateTimers.has(guild.id)) {
    clearTimeout(statsUpdateTimers.get(guild.id));
  }

  const timer = setTimeout(async () => {
    statsUpdateTimers.delete(guild.id);
    await updateStatsChannels(guild);
  }, 1000);

  statsUpdateTimers.set(guild.id, timer);
}


// ============================================================
// メンバー情報更新予約
// ============================================================

function scheduleMemberRefresh(guild) {
  if (!guild) return;

  if (memberRefreshTimers.has(guild.id)) {
    clearTimeout(memberRefreshTimers.get(guild.id));
  }

  const timer = setTimeout(async () => {
    memberRefreshTimers.delete(guild.id);
    await refreshMemberStats(guild);
    await updateStatsChannels(guild);
  }, 5000);

  memberRefreshTimers.set(guild.id, timer);
}