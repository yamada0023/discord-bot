const http = require('http');
const fs = require('fs');
const path = require('path');

// ============================================================
// Webサーバー
// ============================================================

http.createServer((req, res) => {
  res.write("Bot is alive!");
  res.end();
}).listen(process.env.PORT || 3000);


// ============================================================
// Discord.js & @discordjs/voice & Canvas ＆ 外部モジュール
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
  ChannelType,
  AttachmentBuilder
} = require('discord.js');

const {
  joinVoiceChannel,
  getVoiceConnection,
  createAudioPlayer
} = require('@discordjs/voice');

const { createCanvas } = require('@napi-rs/canvas');

// 外部ファイル（tts.js）から読み上げ処理および辞書管理をインポート
const { processQueue, loadDictionary, saveDictionary } = require('./tts.js');


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

const MIN_ACCOUNT_AGE_DAYS = 7;

// ============================================================
// 永続設定（サーバーごと）
// ============================================================
const DATA_DIR = path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'bot-settings.json');
const BIRTHDAYS_FILE = path.join(DATA_DIR, 'birthdays.json');

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
    birthdayChannelId: null,
    readChannelId: null,
    pinnedEmbedMessageId: null, // ピン留め一覧を自動更新するメッセージのIDを保持
    pinnedEmbedChannelId: null  // ピン留め一覧を自動更新するチャンネルのIDを保持
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

function loadBirthdays() {
  try {
    if (!fs.existsSync(BIRTHDAYS_FILE)) return {};
    const raw = fs.readFileSync(BIRTHDAYS_FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (error) {
    console.error('[誕生日] 読み込みエラー:', error);
    return {};
  }
}

const birthdayData = loadBirthdays();

function saveBirthdays() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(BIRTHDAYS_FILE, JSON.stringify(birthdayData, null, 2), 'utf8');
  } catch (error) {
    console.error('[誕生日] 保存エラー:', error);
  }
}


// ============================================================
// 各種キャッシュ・マップ・キュー管理
// ============================================================
const activeCaptchas = new Map();
const vcJoinTimes = new Map();
const readingSessions = new Map();


// ============================================================
// ステータス（人数カウント）チャンネルの自動更新関数
// ============================================================

async function updateServerStats(guild) {
  try {
    await guild.members.fetch();

    const totalMembers = guild.memberCount;
    const botCount = guild.members.cache.filter(m => m.user.bot).size;
    const humanCount = totalMembers - botCount;

    let vcHumanCount = 0;
    const countedUsers = new Set();
    for (const [channelId, channel] of guild.channels.cache) {
      if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
        for (const [memberId, member] of channel.members) {
          if (!member.user.bot && !countedUsers.has(memberId)) {
            countedUsers.add(memberId);
            vcHumanCount++;
          }
        }
      }
    }

    for (const [channelId, channel] of guild.channels.cache) {
      if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
        const name = channel.name;
        if (name.includes('総メンバー数') || name.includes('総メンバー')) {
          await channel.setName(`総メンバー数: ${totalMembers}`).catch(() => {});
        } else if (name.includes('人間:')) {
          await channel.setName(`人間: ${humanCount}`).catch(() => {});
        } else if (name.includes('Bot:')) {
          await channel.setName(`Bot: ${botCount}`).catch(() => {});
        } else if (name.includes('VC参加中:')) {
          await channel.setName(`VC参加中: ${vcHumanCount}`).catch(() => {});
        }
      }
    }
  } catch (error) {
    console.error('サーバー統計チャンネル更新エラー:', error);
  }
}


// ============================================================
// ピン留め一覧の埋め込みを作成・更新するヘルパー関数
// ============================================================

async function updatePinnedEmbedForChannel(channel) {
  if (!channel || channel.type !== ChannelType.GuildText) return;
  const settings = getGuildSettings(channel.guild.id);

  // このチャンネルがピン監視対象として設定されているか確認
  if (settings.pinnedEmbedChannelId !== channel.id || !settings.pinnedEmbedMessageId) return;

  try {
    const targetMessage = await channel.messages.fetch(settings.pinnedEmbedMessageId).catch(() => null);
    if (!targetMessage) return;

    const pinnedMessages = await channel.messages.fetchPinned();
    const embed = new EmbedBuilder()
      .setTitle(`📌 ピン留めされた重要メッセージ一覧 (自動更新)`)
      .setDescription(`チャンネル: <#${channel.id}>`)
      .setColor(0xFFD700)
      .setTimestamp();

    if (pinnedMessages.size === 0) {
      embed.addFields({ name: 'お知らせ', value: 'このチャンネルにはピン留めされたメッセージがありません。' });
    } else {
      let count = 0;
      for (const [id, msg] of pinnedMessages) {
        if (count >= 10) break;
        const contentPreview = msg.content ? (msg.content.length > 80 ? msg.content.substring(0, 80) + '...' : msg.content) : '[添付ファイル・埋め込みのみ]';
        embed.addFields({
          name: `👤 ${msg.author.tag} (${new Date(msg.createdTimestamp).toLocaleDateString()})`,
          value: `${contentPreview}\n[👉 元のメッセージへジャンプ](${msg.url})`,
          inline: false
        });
        count++;
      }
      if (pinnedMessages.size > 10) {
        embed.setFooter({ text: `※最新の10件を表示しています (総ピン留め数: ${pinnedMessages.size}件)` });
      }
    }

    await targetMessage.edit({ embeds: [embed] });
  } catch (error) {
    console.error('ピン留め埋め込みの自動更新エラー:', error);
  }
}


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
// 認証コード＆画像生成
// ============================================================

function generateCaptchaCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let text = '';
  for (let i = 0; i < 6; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function createCaptchaImage(text) {
  const canvas = createCanvas(300, 100);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#2f3136';
  ctx.fillRect(0, 0, 300, 100);

  for (let i = 0; i < 6; i++) {
    ctx.strokeStyle = `rgba(${Math.random() * 255}, ${Math.random() * 255},${Math.random() * 255}, 0.5)`;
    ctx.lineWidth = Math.random() * 3 + 1;
    ctx.beginPath();
    ctx.moveTo(Math.random() * 300, Math.random() * 100);
    ctx.lineTo(Math.random() * 300, Math.random() * 100);
    ctx.stroke();
  }

  for (let i = 0; i < 100; i++) {
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.5})`;
    ctx.fillRect(Math.random() * 300, Math.random() * 100, 2, 2);
  }

  ctx.font = 'bold 45px sans-serif';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < text.length; i++) {
    ctx.save();
    const x = 35 + i * 40;
    const y = 50 + (Math.random() * 20 - 10);
    const angle = (Math.random() * 30 - 15) * Math.PI / 180;

    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text[i], 0, 0);
    ctx.restore();
  }

  return canvas.toBuffer('image/png');
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
    .setTitle('⚙ メンバー認証 管理ダッシュボード')
    .setColor(0x5865F2)
    .addFields(
      {
        name: '認証付与ロール',
        value: settings.verifyRoleId ? `<@&${settings.verifyRoleId}>` : '未設定'
      },
      {
        name: 'ログチャンネル',
        value: (settings.logChannelId || userInfoChannelId) ? `<#${settings.logChannelId || userInfoChannelId}>` : '未設定'
      },
      {
        name: 'サブ垢対策',
        value: `アカウント作成から ${MIN_ACCOUNT_AGE_DAYS} 日未満のアカウントをブロック`
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

function buildBirthdayAdminPanel(guild) {
  const settings = getGuildSettings(guild.id);
  const embed = new EmbedBuilder()
    .setTitle('⚙️ お誕生日お祝い機能 管理ダッシュボード')
    .setColor(0x5865F2)
    .addFields({
      name: 'お祝いメッセージ送信チャンネル',
      value: settings.birthdayChannelId ? `<#${settings.birthdayChannelId}>` : '未設定'
    });

  const channelSelectRow = new ActionRowBuilder()
    .addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('select_birthday_channel')
        .setPlaceholder('お祝いメッセージを送るチャンネルを選択')
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1)
    );

  return {
    embeds: [embed],
    components: [channelSelectRow]
  };
}


// ============================================================
// 定期チェッカー（お誕生日）
// ============================================================

function startScheduledTasks(c) {
  setInterval(async () => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();

    for (const [guildId, guildSettingsMap] of Object.entries(botSettings)) {
      const guild = c.guilds.cache.get(guildId);
      if (!guild) continue;

      const birthdayChannelId = guildSettingsMap.birthdayChannelId;
      if (birthdayChannelId) {
        const channel = guild.channels.cache.get(birthdayChannelId);
        if (channel) {
          const guildBirthdays = birthdayData[guildId] || {};
          for (const [userId, bday] of Object.entries(guildBirthdays)) {
            if (bday.month === month && bday.day === day) {
              const todayKey = `${now.getFullYear()}-${month}-${day}`;
              if (bday.lastCelebrated === todayKey) continue;

              try {
                const member = await guild.members.fetch(userId).catch(() => null);
                if (member) {
                  const embed = new EmbedBuilder()
                    .setTitle('🎉 お誕生日おめでとうございます！ 🎂')
                    .setDescription(`本日は <@${userId}> さんのお誕生日です！素敵な1年になりますように！✨`)
                    .setColor(0xFF73FA)
                    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                    .setTimestamp();

                  await channel.send({ content: `<@${userId}>`, embeds: [embed] });
                  bday.lastCelebrated = todayKey;
                  saveBirthdays();
                }
              } catch (err) {
                console.error('誕生日お祝いメッセージ送信エラー:', err);
              }
            }
          }
        }
      }
    }
  }, 1000 * 60);
}


// ============================================================
// イベント: 準備完了
// ============================================================

client.once(Events.ClientReady, async (c) => {
  console.log(`[ログイン成功] ${c.user.tag} としてログインしました！`);
  
  for (const [guildId, guild] of c.guilds.cache) {
    try {
      await guild.members.fetch();
      console.log(`[キャッシュ] ${guild.name} のメンバーを取得しました。`);
      await updateServerStats(guild);
    } catch (err) {
      console.error(`[キャッシュエラー] ${guild.name} のメンバー取得に失敗しました:`, err);
    }
  }

  const now = Date.now();
  for (const [guildId, guild] of c.guilds.cache) {
    for (const [channelId, channel] of guild.channels.cache) {
      if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
        for (const [memberId, member] of channel.members) {
          if (member.user.bot) continue;
          const key = `${guildId}_${memberId}`;
          if (!vcJoinTimes.has(key)) {
            vcJoinTimes.set(key, now);
          }
        }
      }
    }
  }
  console.log('[VC監視] 起動時にVC参加中のメンバーを初期化しました。');

  const commands = [
    new SlashCommandBuilder()
      .setName('clear')
      .setDescription('メッセージを一括削除、または読み上げキューをクリアします')
      .addSubcommand(sub =>
        sub.setName('messages')
          .setDescription('指定した件数のメッセージを一括削除します（管理者限定）')
          .addIntegerOption(o => o.setName('count').setDescription('削除するメッセージ数 (1〜100)').setRequired(true).setMinValue(1).setMaxValue(100))
      )
      .addSubcommand(sub =>
        sub.setName('queue')
          .setDescription('読み上げキューをすべてクリアします')
      ),
    new SlashCommandBuilder()
      .setName('setup-role')
      .setDescription('ロール付与パネルの設定管理画面を表示します（管理者限定）')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('setup-verify')
      .setDescription('認証の設定管理画面を表示します（管理者限定）')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('setup-birthday')
      .setDescription('お誕生日機能の設定管理画面を表示します（管理者限定）')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('setup-ticket')
      .setDescription('チケット作成パネルを指定チャンネルに設置します（管理者限定）')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('pin')
      .setDescription('ピン留め一覧の管理を行います')
      .addSubcommand(sub =>
        sub.setName('setup')
          .setDescription('入力フォーム（モーダル）を開き、自動更新されるピン留め一覧メッセージを設置します（管理者限定）')
      )
      .addSubcommand(sub =>
        sub.setName('list')
          .setDescription('現在のピン留め一覧を一時表示します')
      ),
    new SlashCommandBuilder()
      .setName('no-role')
      .setDescription('メンバーロール（認証ロール等）がついていないメンバーの一覧を表示します（管理者限定）')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addRoleOption(option =>
        option.setName('target_role')
          .setDescription('確認したいロール（省略時は認証ロール）')
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('no-intro')
      .setDescription('自己紹介を書いていない（メッセージを投稿していない）メンバーの一覧を表示します（管理者限定）')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('vc-time')
      .setDescription('現在VCに参加しているメンバーの滞在時間を確認します（誰でも利用可）'),
    new SlashCommandBuilder()
      .setName('birthday')
      .setDescription('自分の誕生日を登録したり確認します')
      .addSubcommand(sub =>
        sub.setName('set')
          .setDescription('誕生日を登録します')
          .addIntegerOption(o => o.setName('month').setDescription('誕生月の数字 (1〜12)').setRequired(true).setMinValue(1).setMaxValue(12))
          .addIntegerOption(o => o.setName('day').setDescription('誕生日の数字 (1〜31)').setRequired(true).setMinValue(1).setMaxValue(31))
      )
      .addSubcommand(sub =>
        sub.setName('show')
          .setDescription('登録されている誕生日を確認します')
          .addUserOption(o => o.setName('user').setDescription('確認したいユーザー（省略時は自分）').setRequired(false))
      ),
    new SlashCommandBuilder()
      .setName('join')
      .setDescription('ボットを指定したボイスチャンネルに参加させ、このチャンネルの読み上げを開始します')
      .addChannelOption(option =>
        option.setName('channel')
          .setDescription('参加させたいボイスチャンネル（省略時はあなたがいるVC）')
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('leave')
      .setDescription('ボットをボイスチャンネルから退出させます'),
    new SlashCommandBuilder()
      .setName('skip')
      .setDescription('現在読み上げ中の音声をスキップします'),
    new SlashCommandBuilder()
      .setName('dict_add')
      .setDescription('読み上げ辞書に単語を追加します')
      .addStringOption(option => option.setName('word').setDescription('登録する単語').setRequired(true))
      .addStringOption(option => option.setName('reading').setDescription('読み方（ひらがな等）').setRequired(true)),
    new SlashCommandBuilder()
      .setName('dict_remove')
      .setDescription('読み上げ辞書から単語を削除します')
      .addStringOption(option => option.setName('word').setDescription('削除する単語').setRequired(true)),
    new SlashCommandBuilder()
      .setName('read')
      .setDescription('このチャンネルの音声読み上げを開始します')
      .addChannelOption(option =>
        option.setName('voice_channel')
          .setDescription('読み上げを行うボイスチャンネル（省略時はあなたがいるVC）')
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('stop')
      .setDescription('読み上げを停止し、ボットをVCから退出させます')
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
    console.log('[スラッシュコマンド] 登録が完了しました。');
  } catch (error) {
    console.error('[スラッシュコマンド] 登録エラー:', error);
  }

  startScheduledTasks(c);
});


// ============================================================
// イベント: ピン留めが更新されたときに埋め込みを自動編集
// ============================================================

client.on(Events.ChannelPinsUpdate, async (channel, time) => {
  await updatePinnedEmbedForChannel(channel);
});


// ============================================================
// イベント: メンバーの参加・退出時にカウンターを更新
// ============================================================

client.on(Events.GuildMemberAdd, (member) => {
  updateServerStats(member.guild);
});

client.on(Events.GuildMemberRemove, (member) => {
  updateServerStats(member.guild);
});


// ============================================================
// イベント: ボイスチャンネル入退室の監視 ＆ 滞在時間自動通知・読み上げ
// ============================================================

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const member = newState.member || oldState.member;
  
  if (member?.user.bot) return;

  const userId = member.id;
  const guildId = newState.guild.id;
  const key = `${guildId}_${userId}`;
  const now = Date.now();

  if (!oldState.channelId && newState.channelId) {
    vcJoinTimes.set(key, now);
  }
  else if (oldState.channelId && !newState.channelId) {
    const joinTime = vcJoinTimes.get(key);
    if (joinTime) {
      const diffMs = now - joinTime;
      const totalSeconds = Math.floor(diffMs / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      let timeString = '';
      if (hours > 0) timeString += `${hours}時間 `;
      if (minutes > 0 || hours > 0) timeString += `${minutes}分 `;
      timeString += `${seconds}秒`;

      const settings = getGuildSettings(guildId);
      const targetChannelId = settings.logChannelId || settings.birthdayChannelId;
      
      if (targetChannelId) {
        const channel = newState.guild.channels.cache.get(targetChannelId);
        if (channel) {
          const oldVc = newState.guild.channels.cache.get(oldState.channelId);
          const vcName = oldVc ? oldVc.name : 'ボイスチャンネル';
          await channel.send(`⏱️ **${member.displayName}** さんが **${vcName}** から退出しました。（滞在時間: **${timeString}**）`).catch(() => {});
        }
      }

      vcJoinTimes.delete(key);
    }
  }

  updateServerStats(newState.guild);

  const session = readingSessions.get(guildId);
  if (session) {
    const memberName = member.displayName;
    if (!oldState.channelId && newState.channelId) {
      session.queue.push(`${memberName}さんが参加しました`);
      processQueue(guildId, readingSessions);
    } else if (oldState.channelId && !newState.channelId) {
      session.queue.push(`${memberName}さんが退出しました`);
      processQueue(guildId, readingSessions);
    }
  }
});


// ============================================================
// イベント: メッセージ受信
// ============================================================

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;

  const session = readingSessions.get(message.guild.id);
  if (!session) return;

  if (session.textChannelId && message.channel.id !== session.textChannelId) return;

  let textToRead = message.content
    .replace(/https?:\/\/[^\s]+/g, 'URL')
    .replace(/<@&?[0-9]+>/g, 'メンション');

  if (!textToRead) return;
  if (textToRead.length > 100) {
    textToRead = textToRead.substring(0, 100) + '、以下略';
  }

  session.queue.push(textToRead);
  processQueue(message.guild.id, readingSessions);
});


// ============================================================
// イベント: インタラクション処理
// ============================================================

client.on(Events.InteractionCreate, async (interaction) => {
  const guild = interaction.guild;
  if (!guild) return;

  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === 'clear') {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'messages') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
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
      } else if (subcommand === 'queue') {
        const session = readingSessions.get(guild.id);
        if (!session) return interaction.reply({ content: 'ボットが接続されていません。', ephemeral: true });
        session.queue = [];
        if (session.audioPlayer) session.audioPlayer.stop();
        await interaction.reply({ content: '読み上げキューをすべてクリアしました。', ephemeral: true });
      }
    }

    else if (commandName === 'skip') {
      const session = readingSessions.get(guild.id);
      if (!session || !session.audioPlayer) {
        return interaction.reply({ content: 'ボットが接続されていないか、読み上げ中ではありません。', ephemeral: true });
      }
      session.audioPlayer.stop();
      await interaction.reply({ content: '音声をスキップしました。', ephemeral: true });
    }

    else if (commandName === 'dict_add') {
      const word = interaction.options.getString('word');
      const reading = interaction.options.getString('reading');
      const dict = loadDictionary();
      dict[word] = reading;
      saveDictionary(dict);
      await interaction.reply({ content: `辞書に追加しました: 「${word}」→「${reading}」`, ephemeral: true });
    }

    else if (commandName === 'dict_remove') {
      const word = interaction.options.getString('word');
      const dict = loadDictionary();
      if (dict[word]) {
        delete dict[word];
        saveDictionary(dict);
        await interaction.reply({ content: `辞書から削除しました: 「${word}」`, ephemeral: true });
      } else {
        await interaction.reply({ content: `「${word}」は辞書に登録されていません。`, ephemeral: true });
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

    else if (commandName === 'setup-birthday') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '管理者権限が必要です。', ephemeral: true });
      }
      const panel = buildBirthdayAdminPanel(guild);
      await interaction.reply({ embeds: panel.embeds, components: panel.components, ephemeral: true });
    }

    else if (commandName === 'setup-ticket') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '管理者権限が必要です。', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('🎫 おお問い合わせ・サポートチケット')
        .setDescription('運営スタッフへの質問や個別のお問い合わせがある場合は、下のボタンを押してチケットを作成してください。\n作成された専用チャンネルはあなたと管理者のみ閲覧できます。')
        .setColor(0x5865F2);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('create_ticket')
          .setLabel('🎫 チケットを作成する')
          .setStyle(ButtonStyle.Success)
      );

      await interaction.channel.send({ embeds: [embed], components: [row] });
      await interaction.reply({ content: 'チケット作成パネルをこのチャンネルに設置しました！', ephemeral: true });
    }

    else if (commandName === 'pin') {
      const subcommand = interaction.options.getSubcommand();

      if (subcommand === 'setup') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: '管理者権限が必要です。', ephemeral: true });
        }

        // 入力用モーダルを表示する
        const modal = new ModalBuilder()
          .setCustomId('pin_setup_modal')
          .setTitle('ピン留め一覧メッセージの設定');

        const textInput = new TextInputBuilder()
          .setCustomId('pin_intro_text')
          .setLabel('埋め込みに表示するタイトルやメモ（任意）')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('例: 📌 チャンネルの重要なお知らせ一覧')
          .setRequired(false);

        modal.addComponents(new ActionRowBuilder().addComponents(textInput));
        return await interaction.showModal(modal);
      }
      else if (subcommand === 'list') {
        await interaction.deferReply({ ephemeral: true });

        try {
          const pinnedMessages = await interaction.channel.messages.fetchPinned();
          const embed = new EmbedBuilder()
            .setTitle(`📌 ピン留めされた重要メッセージ一覧`)
            .setDescription(`チャンネル: <#${interaction.channel.id}>`)
            .setColor(0xFFD700)
            .setTimestamp();

          if (pinnedMessages.size === 0) {
            embed.addFields({ name: 'お知らせ', value: 'このチャンネルにはピン留めされたメッセージがありません。' });
          } else {
            let count = 0;
            for (const [id, msg] of pinnedMessages) {
              if (count >= 10) break;
              const contentPreview = msg.content ? (msg.content.length > 80 ? msg.content.substring(0, 80) + '...' : msg.content) : '[添付ファイル・埋め込みのみ]';
              embed.addFields({
                name: `👤 ${msg.author.tag} (${new Date(msg.createdTimestamp).toLocaleDateString()})`,
                value: `${contentPreview}\n[👉 元のメッセージへジャンプ](${msg.url})`,
                inline: false
              });
              count++;
            }
            if (pinnedMessages.size > 10) {
              embed.setFooter({ text: `※最新の10件を表示しています (総ピン留め数: ${pinnedMessages.size}件)` });
            }
          }

          await interaction.editReply({ embeds: [embed] });
        } catch (error) {
          console.error('ピン留め一覧取得エラー:', error);
          await interaction.editReply({ content: '❌ ピン留め一覧の取得に失敗しました。' });
        }
      }
    }

    else if (commandName === 'no-role') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '管理者権限が必要です。', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });
      await guild.members.fetch();

      const settings = getGuildSettings(guild.id);
      const targetRoleOpt = interaction.options.getRole('target_role');
      const checkRoleId = targetRoleOpt ? targetRoleOpt.id : settings.verifyRoleId;

      const embed = new EmbedBuilder()
        .setTitle('🏷️ メンバーロール未付与者一覧')
        .setColor(0xFFA500)
        .setTimestamp();

      if (checkRoleId) {
        const role = guild.roles.cache.get(checkRoleId);
        const roleName = role ? role.name : checkRoleId;
        embed.setDescription(`対象ロール: **${roleName}** (<@&${checkRoleId}>) がついていないメンバー`);

        const noRoleMembers = guild.members.cache.filter(m => !m.user.bot && !m.roles.cache.has(checkRoleId));

        if (noRoleMembers.size === 0) {
          embed.addFields({ name: '結果', value: '対象ロールを持っていないメンバーはいません！全員付与されています。' });
        } else {
          const list = noRoleMembers.map(m => `• <@${m.id}>`).slice(0, 50).join('\n');
          embed.addFields({
            name: `未付与のメンバー (計 ${noRoleMembers.size}人)`,
            value: list.length > 0 ? list : 'なし'
          });
        }
      } else {
        embed.setDescription('対象ロールが未設定のため、ロールが一切付いていない（@everyoneのみの）メンバーを抽出します。');
        const noRoleMembers = guild.members.cache.filter(m => !m.user.bot && m.roles.cache.size <= 1);

        if (noRoleMembers.size === 0) {
          embed.addFields({ name: '結果', value: 'ロールが一切ついていないメンバーはいません。' });
        } else {
          const list = noRoleMembers.map(m => `• <@${m.id}>`).slice(0, 50).join('\n');
          embed.addFields({
            name: `未付与のメンバー (計 ${noRoleMembers.size}人)`,
            value: list.length > 0 ? list : 'なし'
          });
        }
      }

      await interaction.editReply({ embeds: [embed] });
    }

    else if (commandName === 'no-intro') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '管理者権限が必要です。', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });
      await guild.members.fetch();

      const introChannel = guild.channels.cache.find(
        c => c.type === ChannelType.GuildText && (c.name.includes('自己紹介') || c.name.includes('intro'))
      );

      if (!introChannel) {
        return interaction.editReply({ content: '❌ サーバー内に「自己紹介」または「intro」という名前のテキストチャンネルが見つかりませんでした。' });
      }

      try {
        let messages = [];
        let lastId;
        for (let i = 0; i < 5; i++) {
          const fetched = await introChannel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) });
          if (fetched.size === 0) break;
          messages.push(...fetched.values());
          lastId = fetched.last().id;
          if (fetched.size < 100) break;
        }

        const postedUserIds = new Set(messages.map(m => m.author.id));
        const noIntroMembers = guild.members.cache.filter(m => !m.user.bot && !postedUserIds.has(m.id));

        const embed = new EmbedBuilder()
          .setTitle(`📝 自己紹介未記入メンバー一覧`)
          .setDescription(`対象チャンネル: <#${introChannel.id}>`)
          .setColor(0xFF4500)
          .setTimestamp();

        if (noIntroMembers.size === 0) {
          embed.addFields({ name: '結果', value: '対象チャンネルで発言していない人間メンバーはいません。' });
        } else {
          const list = noIntroMembers.map(m => `• <@${m.id}>`).slice(0, 50).join('\n');
          embed.addFields({
            name: `未記入のメンバー (計 ${noIntroMembers.size}人)`,
            value: list.length > 0 ? list : 'なし'
          });
        }

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('自己紹介チェックエラー:', error);
        await interaction.editReply({ content: '❌ 自己紹介チャンネルのメッセージ取得に失敗しました。' });
      }
    }

    else if (commandName === 'birthday') {
      const subcommand = interaction.options.getSubcommand();

      if (subcommand === 'set') {
        const month = interaction.options.getInteger('month');
        const day = interaction.options.getInteger('day');

        const daysInMonth = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        if (day > daysInMonth[month]) {
          return interaction.reply({ content: `❌ ${month}月に ${day}日 は存在しません。`, ephemeral: true });
        }

        if (!birthdayData[guild.id]) birthdayData[guild.id] = {};
        birthdayData[guild.id][interaction.user.id] = { month, day, lastCelebrated: null };
        saveBirthdays();

        await interaction.reply({ content: `🎂 あなたの誕生日を **${month}月${day}日** に登録しました！`, ephemeral: true });
      } 
      else if (subcommand === 'show') {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const guildBdays = birthdayData[guild.id] || {};
        const bday = guildBdays[targetUser.id];

        if (!bday) {
          return interaction.reply({ content: '誕生日は登録されていません。', ephemeral: true });
        }
        await interaction.reply({ content: `📅 **${targetUser.tag}** さんのお誕生日：**${bday.month}月${bday.day}日**`, ephemeral: true });
      }
    }

    else if (commandName === 'vc-time') {
      await interaction.deferReply();
      const voiceChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice);
      
      const embed = new EmbedBuilder()
        .setTitle('🎙️ VC 滞在時間一覧')
        .setColor(0x00FF00)
        .setTimestamp();

      let activeVcCount = 0;
      const now = Date.now();

      for (const [channelId, channel] of voiceChannels) {
        const humanMembers = channel.members.filter(m => !m.user.bot);
        if (humanMembers.size > 0) {
          activeVcCount++;
          let memberLines = [];

          for (const [memberId, member] of humanMembers) {
            const key = `${guild.id}_${memberId}`;
            let joinTime = vcJoinTimes.get(key) || now;
            const diffMs = now - joinTime;
            const totalSeconds = Math.floor(diffMs / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;

            let timeString = '';
            if (hours > 0) timeString += `${hours}時間 `;
            if (minutes > 0 || hours > 0) timeString += `${minutes}分 `;
            timeString += `${seconds}秒`;

            memberLines.push(`• **${member.displayName}** : ⏱️ \`${timeString}\``);
          }

          embed.addFields({
            name: `🔊 ${channel.name} (${humanMembers.size}人)`,
            value: memberLines.join('\n'),
            inline: false
          });
        }
      }

      if (activeVcCount === 0) {
        embed.setDescription('現在、誰もボイスチャンネルに参加していません。');
      }

      await interaction.editReply({ embeds: [embed] });
    }

    else if (commandName === 'join') {
      const targetChannel = interaction.options.getChannel('channel') || interaction.member.voice.channel;
      if (!targetChannel) {
        return interaction.reply({ content: '❌ ボイスチャンネルを指定するか、VCに参加した状態で実行してください。', ephemeral: true });
      }

      try {
        const connection = joinVoiceChannel({
          channelId: targetChannel.id,
          guildId: guild.id,
          adapterCreator: guild.voiceAdapterCreator,
          selfDeaf: false
        });

        const audioPlayer = createAudioPlayer();
        connection.subscribe(audioPlayer);

        readingSessions.set(guild.id, {
          textChannelId: interaction.channel.id,
          audioPlayer: audioPlayer,
          queue: [],
          isPlaying: false
        });

        await interaction.reply({ content: `🔊 **${targetChannel.name}** に参加し、このチャンネルの読み上げを開始します！`, ephemeral: true });
      } catch (error) {
        console.error('VC参加エラー:', error);
        await interaction.reply({ content: '❌ ボイスチャンネルへの参加に失敗しました。', ephemeral: true });
      }
    }

    else if (commandName === 'leave') {
      const connection = getVoiceConnection(guild.id);
      if (!connection) {
        return interaction.reply({ content: '❌ ボットはどのボイスチャンネルにも参加していません。', ephemeral: true });
      }

      try {
        readingSessions.delete(guild.id);
        connection.destroy();
        await interaction.reply({ content: '👋 ボイスチャンネルから退出しました。', ephemeral: true });
      } catch (error) {
        console.error('VC退出エラー:', error);
        await interaction.reply({ content: '❌ 退出処理中にエラーが発生しました。', ephemeral: true });
      }
    }

    else if (commandName === 'read') {
      const targetVc = interaction.options.getChannel('voice_channel') || interaction.member.voice.channel;
      if (!targetVc) {
        return interaction.reply({ content: '❌ 参加するボイスチャンネルを指定するか、VCに参加した状態で実行してください。', ephemeral: true });
      }

      try {
        let connection = getVoiceConnection(guild.id);
        if (!connection) {
          connection = joinVoiceChannel({
            channelId: targetVc.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false
          });
        }

        const audioPlayer = createAudioPlayer();
        connection.subscribe(audioPlayer);

        readingSessions.set(guild.id, {
          textChannelId: interaction.channel.id,
          audioPlayer: audioPlayer,
          queue: [],
          isPlaying: false
        });

        await interaction.reply({ content: `📖 このチャンネル (<#${interaction.channel.id}>) の音声読み上げを **${targetVc.name}** で開始します！`, ephemeral: true });
      } catch (error) {
        console.error('読み上げ開始エラー:', error);
        await interaction.reply({ content: '❌ 読み上げの開始に失敗しました。', ephemeral: true });
      }
    }

    else if (commandName === 'stop') {
      const connection = getVoiceConnection(guild.id);
      readingSessions.delete(guild.id);

      if (connection) {
        connection.destroy();
      }

      await interaction.reply({ content: '🛑 読み上げを停止し、VCから退出しました。', ephemeral: true });
    }
  }

  else if (interaction.isStringSelectMenu() || interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu()) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '管理者権限が必要です。', ephemeral: true });
    }

    const settings = getGuildSettings(guild.id);

    if (interaction.customId === 'select_verify_role') {
      settings.verifyRoleId = interaction.values[0];
      saveSettings();
      await interaction.update(buildVerifyAdminPanel(guild));
    }
    else if (interaction.customId === 'select_log_channel') {
      settings.logChannelId = interaction.values[0];
      saveSettings();
      await interaction.update(buildVerifyAdminPanel(guild));
    }
    else if (interaction.customId === 'select_multi_roles') {
      settings.roleIds = interaction.values;
      saveSettings();
      await interaction.update(buildRoleAdminPanel(guild));
    }
    else if (interaction.customId === 'select_birthday_channel') {
      settings.birthdayChannelId = interaction.values[0];
      saveSettings();
      await interaction.update(buildBirthdayAdminPanel(guild));
    }
  }

  else if (interaction.isButton()) {
    if (interaction.customId === 'admin_deploy_verify_panel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '管理者権限が必要です。', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('🔒 メンバー認証')
        .setDescription('下のボタンを押して画像認証を行ってください。')
        .setColor(0x00FF00);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('start_verify').setLabel('認証する').setStyle(ButtonStyle.Success)
      );

      await interaction.channel.send({ embeds: [embed], components: [row] });
      await interaction.reply({ content: '認証パネルを設置しました！', ephemeral: true });
    }
    else if (interaction.customId === 'admin_deploy_role_panel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '管理者権限が必要です。', ephemeral: true });
      }

      const components = buildRolePanelComponents(guild);
      const embed = new EmbedBuilder()
        .setTitle('🏷️ ロール選択パネル')
        .setDescription('ボタンを押してロールを取得できます。')
        .setColor(0x5865F2);

      await interaction.channel.send({ embeds: [embed], components: components });
      await interaction.reply({ content: 'ロール選択パネルを設置しました！', ephemeral: true });
    }
    else if (interaction.customId === 'start_verify') {
      const user = interaction.user;
      const accountAgeDays = (Date.now() - user.createdTimestamp) / (1000 * 60 * 60 * 24);

      if (accountAgeDays < MIN_ACCOUNT_AGE_DAYS) {
        return interaction.reply({ content: `❌ アカウント作成から ${MIN_ACCOUNT_AGE_DAYS} 日未満のため認証できません。`, ephemeral: true });
      }

      const code = generateCaptchaCode();
      activeCaptchas.set(user.id, code);

      const imageBuffer = createCaptchaImage(code);
      const attachment = new AttachmentBuilder(imageBuffer, { name: 'captcha.png' });

      const embed = new EmbedBuilder()
        .setTitle('画像認証')
        .setDescription('画像内の6文字を確認し、ボタンから入力してください。')
        .setImage('attachment://captcha.png')
        .setColor(0x5865F2);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('open_verify_modal').setLabel('✏️ 回答を入力する').setStyle(ButtonStyle.Primary)
      );

      await interaction.reply({ embeds: [embed], files: [attachment], components: [row], ephemeral: true });
    }
    else if (interaction.customId === 'open_verify_modal') {
      const modal = new ModalBuilder()
        .setCustomId('verify_modal')
        .setTitle('メンバー認証（画像入力）');

      const textInput = new TextInputBuilder()
        .setCustomId('verify_code_input')
        .setLabel('6文字を入力してください')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(6)
        .setMinLength(6);

      modal.addComponents(new ActionRowBuilder().addComponents(textInput));
      await interaction.showModal(modal);
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
    else if (interaction.customId === 'create_ticket') {
      const guild = interaction.guild;
      const user = interaction.user;

      const existingChannel = guild.channels.cache.find(
        c => c.name === `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`
      );

      if (existingChannel) {
        return interaction.reply({ content: `❌ すでにオープンされているチケットチャンネルがあります: <#${existingChannel.id}>`, ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        const ticketChannel = await guild.channels.create({
          name: `ticket-${user.username}`,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              deny: [PermissionFlagsBits.ViewChannel]
            },
            {
              id: user.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
              ]
            },
            {
              id: client.user.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ManageChannels
              ]
            }
          ]
        });

        const ticketEmbed = new EmbedBuilder()
          .setTitle(`🎫 チケット: ${user.tag}`)
          .setDescription('お問い合わせ内容をご記入ください。運営スタッフが確認次第対応いたします。\n\n用事が済んだら下の **「🔒 チケットを閉じる」** ボタンを押してください。')
          .setColor(0x00FF00)
          .setTimestamp();

        const closeRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('close_ticket')
            .setLabel('🔒 チケットを閉じる')
            .setStyle(ButtonStyle.Danger)
        );

        await ticketChannel.send({
          content: `<@${user.id}> さん, スタッフがお手伝いします！`,
          embeds: [ticketEmbed],
          components: [closeRow]
        });

        await interaction.editReply({ content: `✅ チケットチャンネルを作成しました！ 👉 <#${ticketChannel.id}>` });
      } catch (error) {
        console.error('チケット作成エラー:', error);
        await interaction.editReply({ content: '❌ チケットチャンネルの作成に失敗しました。' });
      }
    }
    else if (interaction.customId === 'close_ticket') {
      const channel = interaction.channel;
      if (!channel.name.startsWith('ticket-')) {
        return interaction.reply({ content: '❌ このコマンドはチケットチャンネルでのみ使用できます。', ephemeral: true });
      }

      await interaction.reply({ content: '🔒 5秒後にこのチケットチャンネルを削除します...' });
      setTimeout(async () => {
        try {
          await channel.delete();
        } catch (err) {
          console.error('チケット削除エラー:', err);
        }
      }, 5000);
    }
  }

  else if (interaction.isModalSubmit()) {
    if (interaction.customId === 'verify_modal') {
      const userInput = interaction.fields.getTextInputValue('verify_code_input').trim();
      const expectedCode = activeCaptchas.get(interaction.user.id);

      if (!expectedCode || userInput.toUpperCase() !== expectedCode) {
        return interaction.reply({ content: '❌ 認証コードが間違っています。', ephemeral: true });
      }

      activeCaptchas.delete(interaction.user.id);
      const settings = getGuildSettings(guild.id);

      if (settings.verifyRoleId) {
        try {
          await interaction.member.roles.add(settings.verifyRoleId);
          await interaction.reply({ content: '✅ 認証に成功しました！', ephemeral: true });
          await sendLog(guild, interaction.member, 'メンバー認証成功', `${interaction.user.tag} が画像認証をクリアしました。`);
        } catch (e) {
          await interaction.reply({ content: '⚠️ ロールの付与に失敗しました。', ephemeral: true });
        }
      } else {
        await interaction.reply({ content: '✅ 認証に成功しました！', ephemeral: true });
      }
    }
    else if (interaction.customId === 'pin_setup_modal') {
      const introText = interaction.fields.getTextInputValue('pin_intro_text') || '📌 ピン留めされた重要メッセージ一覧';
      await interaction.deferReply({ ephemeral: true });

      try {
        const pinnedMessages = await interaction.channel.messages.fetchPinned();
        const embed = new EmbedBuilder()
          .setTitle(introText)
          .setDescription(`チャンネル: <#${interaction.channel.id}>`)
          .setColor(0xFFD700)
          .setTimestamp();

        if (pinnedMessages.size === 0) {
          embed.addFields({ name: 'お知らせ', value: 'このチャンネルにはピン留めされたメッセージがありません。' });
        } else {
          let count = 0;
          for (const [id, msg] of pinnedMessages) {
            if (count >= 10) break;
            const contentPreview = msg.content ? (msg.content.length > 80 ? msg.content.substring(0, 80) + '...' : msg.content) : '[添付ファイル・埋め込みのみ]';
            embed.addFields({
              name: `👤 ${msg.author.tag} (${new Date(msg.createdTimestamp).toLocaleDateString()})`,
              value: `${contentPreview}\n[👉 元のメッセージへジャンプ](${msg.url})`,
              inline: false
            });
            count++;
          }
        }

        // チャンネルに新しいメッセージとして送信し、そのIDを保存する
        const sentMessage = await interaction.channel.send({ embeds: [embed] });
        
        const settings = getGuildSettings(guild.id);
        settings.pinnedEmbedChannelId = interaction.channel.id;
        settings.pinnedEmbedMessageId = sentMessage.id;
        saveSettings();

        await interaction.editReply({ content: '✅ ピン留め一覧の自動更新メッセージをこのチャンネルに設置しました！今後ピン留めが変更されると、このメッセージが自動で書き換わります。' });
      } catch (error) {
        console.error('ピン留めセットアップエラー:', error);
        await interaction.editReply({ content: '❌ ピン留め一覧の設置に失敗しました。ボットに「メッセージの履歴を読む」や「メッセージ送信」の権限があるか確認してください。' });
      }
    }
  }
});


// ============================================================
// ログイン処理
// ============================================================

client.login(process.env.DISCORD_TOKEN);