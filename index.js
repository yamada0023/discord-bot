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
// Discord.js & Canvas
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

const { createCanvas } = require('@napi-rs/canvas');


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

// サブ垢対策：作成から何日未満のアカウントを弾くか
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
    birthdayChannelId: null // 誕生日のお祝いメッセージを送るチャンネル
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

// 誕生日データの読み書き
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
// 各種キャッシュ・マップ
// ============================================================
const activeCaptchas = new Map();
const vcJoinTimes = new Map();


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
    ctx.strokeStyle = `rgba(${Math.random() * 255}, ${Math.random() * 255}, ${Math.random() * 255}, 0.5)`;
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
    .setTitle('⚙️️ メンバー認証 管理ダッシュボード')
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
// 毎日のお誕生日チェック処理
// ============================================================

function startBirthdayChecker(c) {
  setInterval(async () => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();

    for (const [guildId, guildSettingsMap] of Object.entries(botSettings)) {
      const birthdayChannelId = guildSettingsMap.birthdayChannelId;
      if (!birthdayChannelId) continue;

      const guild = c.guilds.cache.get(guildId);
      if (!guild) continue;

      const channel = guild.channels.cache.get(birthdayChannelId);
      if (!channel) continue;

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
  }, 1000 * 60 * 60);
}


// ============================================================
// イベント: 準備完了
// ============================================================

client.once(Events.ClientReady, async (c) => {
  console.log(`[ログイン成功] ${c.user.tag} としてログインしました！`);
  
  // 全サーバーのメンバーを強制フェッチしてキャッシュを完全に同期する
  for (const [guildId, guild] of c.guilds.cache) {
    try {
      await guild.members.fetch();
      console.log(`[キャッシュ] ${guild.name} のメンバーを取得しました。`);
    } catch (err) {
      console.error(`[キャッシュエラー] ${guild.name} のメンバー取得に失敗しました:`, err);
    }
  }

  // 起動時にすでにVCにいるメンバーの時間を記録（初期化）
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
      .setDescription('指定した件数のメッセージを一括削除します（管理者限定）')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addIntegerOption(option =>
        option.setName('count').setDescription('削除するメッセージ数 (1〜100)').setRequired(true).setMinValue(1).setMaxValue(100)
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
      )
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
    console.log('[スラッシュコマンド] 登録が完了しました。');
  } catch (error) {
    console.error('[スラッシュコマンド] 登録エラー:', error);
  }

  // 誕生日チェッカー起動
  startBirthdayChecker(c);
});


// ============================================================
// イベント: ボイスチャンネル入退室の監視（滞在時間計測用）
// ============================================================

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  if (newState.member?.user.bot) return;

  const userId = newState.member.id;
  const guildId = newState.guild.id;
  const key = `${guildId}_${userId}`;
  const now = Date.now();

  if (!oldState.channelId && newState.channelId) {
    vcJoinTimes.set(key, now);
  }
  else if (oldState.channelId && !newState.channelId) {
    vcJoinTimes.delete(key);
  }
});


// ============================================================
// イベント: インタラクション処理
// ============================================================

client.on(Events.InteractionCreate, async (interaction) => {
  const guild = interaction.guild;
  if (!guild) return;

  // 1. スラッシュコマンド
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === 'clear') {
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

    else if (commandName === 'birthday') {
      const subcommand = interaction.options.getSubcommand();

      if (subcommand === 'set') {
        const month = interaction.options.getInteger('month');
        const day = interaction.options.getInteger('day');

        const daysInMonth = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        if (day > daysInMonth[month]) {
          return interaction.reply({ content: `❌ ${month}月に ${day}日 は存在しません。正しい日付を指定してください。`, ephemeral: true });
        }

        if (!birthdayData[guild.id]) birthdayData[guild.id] = {};
        birthdayData[guild.id][interaction.user.id] = {
          month,
          day,
          lastCelebrated: null
        };
        saveBirthdays();

        await interaction.reply({ content: `🎂 あなたの誕生日を **${month}月${day}日** に登録しました！`, ephemeral: true });
      } 
      else if (subcommand === 'show') {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const guildBdays = birthdayData[guild.id] || {};
        const bday = guildBdays[targetUser.id];

        if (!bday) {
          const msg = targetUser.id === interaction.user.id 
            ? 'あなたの誕生日はまだ登録されていません。`/birthday set` で登録してください！' 
            : `${targetUser.tag} の誕生日は登録されていません。`;
          return interaction.reply({ content: msg, ephemeral: true });
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
            let joinTime = vcJoinTimes.get(key);

            if (!joinTime) {
              joinTime = now;
              vcJoinTimes.set(key, now);
            }

            const diffMs = now - joinTime;
            const totalSeconds = Math.floor(diffMs / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;

            let timeString = '';
            if (hours > 0) timeString += `${hours}時間 `;
            if (minutes > 0 || hours > 0) timeString += `${minutes}分 `;
            timeString += `${seconds}秒`;

            memberLines.push(`• **${member.displayName}** : ⏱️ \`${timeString}\`（入室中）`);
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
  }

  // 2. セレクトメニュー
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

  // 3. ボタン操作
  else if (interaction.isButton()) {
    if (interaction.customId === 'admin_deploy_verify_panel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '管理者権限が必要です。', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('🔒 メンバー認証')
        .setDescription('下の「認証する」ボタンを押して、画像認証を行ってください。\n※作成から日数の浅いアカウント（サブ垢等）は認証できません。')
        .setColor(0x00FF00);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('start_verify').setLabel('認証する').setStyle(ButtonStyle.Success)
      );

      await interaction.channel.send({ embeds: [embed], components: [row] });
      await interaction.reply({ content: '認証パネルをこのチャンネルに設置しました！', ephemeral: true });
    }

    else if (interaction.customId === 'admin_deploy_role_panel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '管理者権限が必要です。', ephemeral: true });
      }

      const components = buildRolePanelComponents(guild);
      const embed = new EmbedBuilder()
        .setTitle('🏷️ ロール選択パネル')
        .setDescription('ボタンを押してロールの取得・解除を行えます。')
        .setColor(0x5865F2);

      await interaction.channel.send({ embeds: [embed], components: components });
      await interaction.reply({ content: 'ロール選択パネルをこのチャンネルに設置しました！', ephemeral: true });
    }

    else if (interaction.customId === 'start_verify') {
      const user = interaction.user;
      const createdTimestamp = user.createdTimestamp;
      const now = Date.now();
      const accountAgeDays = (now - createdTimestamp) / (1000 * 60 * 60 * 24);

      if (accountAgeDays < MIN_ACCOUNT_AGE_DAYS) {
        await sendLog(guild, interaction.member, '⚠ サブ垢ブロック', `${user.tag} (${user.id}) はアカウント作成から ${Math.floor(accountAgeDays)} 日しか経過していないため、認証を拒否されました。`, 0xFF0000);
        return interaction.reply({
          content: `❌ アカウント作成から ${MIN_ACCOUNT_AGE_DAYS} 日未満のアカウント（サブ垢・新規垢）では認証できません。（あなたのアカウント作成から約 ${Math.floor(accountAgeDays)} 日経過）`,
          ephemeral: true
        });
      }

      const code = generateCaptchaCode();
      activeCaptchas.set(user.id, code);

      const imageBuffer = createCaptchaImage(code);
      const attachment = new AttachmentBuilder(imageBuffer, { name: 'captcha.png' });

      const embed = new EmbedBuilder()
        .setTitle('画像認証')
        .setDescription('下の画像に表示されている6文字の半角英数字を確認し、下の「回答を入力する」ボタンを押してください。')
        .setImage('attachment://captcha.png')
        .setColor(0x5865F2);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('open_verify_modal')
          .setLabel('✏️ 回答を入力する')
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.reply({ embeds: [embed], files: [attachment], components: [row], ephemeral: true });
    }

    else if (interaction.customId === 'open_verify_modal') {
      const modal = new ModalBuilder()
        .setCustomId('verify_modal')
        .setTitle('メンバー認証（画像入力）');

      const textInput = new TextInputBuilder()
        .setCustomId('verify_code_input')
        .setLabel('画像の中の6文字を入力してください')
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
  }

  // 4. モーダル送信（画像認証の答え合わせ）
  else if (interaction.isModalSubmit()) {
    if (interaction.customId === 'verify_modal') {
      const userInput = interaction.fields.getTextInputValue('verify_code_input').trim();
      const expectedCode = activeCaptchas.get(interaction.user.id);

      if (!expectedCode || userInput.toUpperCase() !== expectedCode) {
        return interaction.reply({ content: '❌ 認証コードが間違っています。もう一度やり直してください。', ephemeral: true });
      }

      activeCaptchas.delete(interaction.user.id);
      const settings = getGuildSettings(guild.id);

      if (settings.verifyRoleId) {
        try {
          await interaction.member.roles.add(settings.verifyRoleId);
          await interaction.reply({ content: '✅ 認証に成功しました！ロールが付与されました。', ephemeral: true });
          await sendLog(guild, interaction.member, 'メンバー認証成功', `${interaction.user.tag} が画像認証をクリアしました。`);
        } catch (e) {
          console.error('認証ロール付与失敗:', e);
          await interaction.reply({ content: '⚠️ 認証には成功しましたが、ロールの付与に失敗しました。管理者に連絡してください。', ephemeral: true });
        }
      } else {
        await interaction.reply({ content: '✅ 認証に成功しました！（付与ロールが未設定です）', ephemeral: true });
      }
    }
  }
});


// ============================================================
// ログイン処理（Discordへの接続）
// ============================================================

client.login(process.env.DISCORD_TOKEN);