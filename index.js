// ============================================================
// Webサーバー & OAuth2 認証設定 (Express)
// ============================================================
const express = require('express');
const app = express();

const http = require('http');
const fs = require('fs');
const path = require('path');

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ============================================================
// セキュリティ・認証履歴の永続化管理 & 検知システム
// ============================================================
const DATA_DIR = path.join(__dirname, 'data');
const SECURITY_FILE = path.join(DATA_DIR, 'security-logs.json');

function loadSecurityLogs() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(SECURITY_FILE)) return {};
    const raw = fs.readFileSync(SECURITY_FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (error) {
    console.error('[セキュリティログ] 読み込みエラー:', error);
    return {};
  }
}

const securityData = loadSecurityLogs();

function saveSecurityLogs() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SECURITY_FILE, JSON.stringify(securityData, null, 2), 'utf8');
  } catch (error) {
    console.error('[セキュリティログ] 保存エラー:', error);
  }
}

// VPN / プロキシ検知関数
async function checkVpnOrProxy(clientIp) {
  if (!clientIp || clientIp === '127.0.0.1' || clientIp === '::1') return false;
  try {
    const vpnCheckRes = await fetch(`https://proxycheck.io/v2/${clientIp}?vpn=1&asn=1`);
    const vpnData = await vpnCheckRes.json();
    if (vpnData && vpnData[clientIp] && vpnData[clientIp].proxy === 'yes') {
      return true;
    }
  } catch (err) {
    console.log('VPNチェックAPIスキップまたはエラー:', err);
  }
  return false;
}

// マルチアカウント（IP / フィンガープリンティング）紐付けチェック
function checkMultiAccount(guildId, clientIp, fingerprint, userId) {
  if (!securityData[guildId]) {
    securityData[guildId] = { ips: {}, fingerprints: {} };
  }
  const guildSec = securityData[guildId];

  const existingUserByIp = guildSec.ips[clientIp];
  const existingUserByFp = guildSec.fingerprints[fingerprint];

  if ((existingUserByIp && existingUserByIp !== userId) || (existingUserByFp && existingUserByFp !== userId)) {
    return existingUserByIp || existingUserByFp;
  }

  guildSec.ips[clientIp] = userId;
  guildSec.fingerprints[fingerprint] = userId;
  saveSecurityLogs();

  return null;
}


// 1. Botの生存確認用
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>Discord Verify Bot</title></head>
      <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
        <h1>🤖 Bot is alive & Web Verify System is Ready!</h1>
        <p>このサーバーではWebブラウザを通じた高度なセキュリティメンバー認証システムが稼働しています。</p>
      </body>
    </html>
  `);
});

// 2. 認証ページ
app.get('/verify', (req, res) => {
  const guildId = req.query.guild;
  if (!guildId) {
    return res.status(400).send('エラー: サーバーID（guild）が指定されていません。');
  }

  res.send(`
    <html>
      <head>
        <title>セキュリティ確認中 - Discord Verify</title>
        <style>
          body { font-family: sans-serif; text-align: center; padding-top: 100px; background: #2f3136; color: #fff; }
          .spinner { border: 4px solid rgba(255,255,255,0.1); width: 40px; height: 40px; border-radius: 50%; border-left-color: #7289da; animation: spin 1s linear infinite; margin: 20px auto; }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
      </head>
      <body>
        <h2>🔒 セキュリティチェックを実行中...</h2>
        <div class="spinner"></div>
        <p>ブラウザの環境を確認しています。まもなくDiscordの認証画面に移動します。</p>
        <script>
          async function generateFingerprint() {
            try {
              const canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d');
              ctx.textBaseline = "top";
              ctx.font = "14px 'Arial'";
              ctx.fillText("Discord Verify Security", 2, 2);
              const canvasData = canvas.toDataURL();

              const fpString = [
                navigator.userAgent,
                navigator.language,
                screen.colorDepth,
                screen.width + 'x' + screen.height,
                new Date().getTimezoneOffset(),
                canvasData.substring(canvasData.length - 50)
              ].join('||');

              const msgBuffer = new TextEncoder().encode(fpString);
              const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
              const hashArray = Array.from(new Uint8Array(hashBuffer));
              const fpHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

              const clientId = "${CLIENT_ID}";
              const redirectUri = encodeURIComponent("${REDIRECT_URI}");
              const oauthUrl = \`https://discord.com/api/oauth2/authorize?client_id=\${clientId}&redirect_uri=\${redirectUri}&response_type=code&scope=identify%20guilds.join&state=\${encodeURIComponent(JSON.stringify({ guild: "${guildId}", fp: fpHash }))}\`;
              
              window.location.href = oauthUrl;
            } catch (e) {
              console.error(e);
              alert('セキュリティチェックに失敗しました。');
            }
          }
          generateFingerprint();
        </script>
      </body>
    </html>
  `);
});

// 3. コールバック
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  const stateRaw = req.query.state;

  if (!code) {
    console.error('[認証エラー] 認証コード (code) が取得できませんでした。');
    return res.status(400).send('❌ 認証コードが取得できませんでした。');
  }

  const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : req.socket.remoteAddress;

  let guildId, fingerprint = 'unknown';
  try {
    const stateData = JSON.parse(stateRaw || '{}');
    guildId = stateData.guild;
    fingerprint = stateData.fp || 'unknown';
  } catch (e) {
    guildId = [...client.guilds.cache.keys()][0];
  }

  const guild = client.guilds.cache.get(guildId) || client.guilds.cache.first();

  try {
    const isVpn = await checkVpnOrProxy(clientIp);
    if (isVpn) {
      console.warn(`[認証失敗: VPN検知] IP: ${clientIp} からのアクセスがブロックされました。`);
      if (guild) {
        sendLog(guild, { user: { displayAvatarURL: () => '' } }, '❌ Web認証失敗 (VPN検知)', `IP: ${clientIp}\n理由: VPNまたはプロキシ経由からのアクセスが検知されました。`, 0xFF4500);
      }
      return res.send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding-top: 50px; color: #ff4500;">
            <h1>❌ 認証失敗 (VPN / プロキシ検知)</h1>
            <p>VPNまたはプロキシ経由からのアクセスが検知されたため、セキュリティ上このサーバーへの参加は許可されていません。</p>
          </body>
        </html>
      `);
    }

    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: REDIRECT_URI,
      }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[認証エラー] Discord API (Token) エラーレスポンス:', tokenResponse.status, errorText);
      return res.status(400).send('❌ Discordアクセストークンの取得に失敗しました。環境変数を確認してください。');
    }

    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) {
      console.error('[認証エラー] Discordアクセストークンが含まれていません:', tokenData);
      return res.status(400).send('❌ Discordアクセストークンの取得に失敗しました。');
    }

    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: {
        authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    if (!userResponse.ok) {
      const errorText = await userResponse.text();
      console.error('[認証エラー] Discord API (User) エラーレスポンス:', userResponse.status, errorText);
      return res.status(400).send('❌ ユーザー情報の取得に失敗しました。');
    }

    const userData = await userResponse.json();

    if (!userData.id) {
      console.error('[認証エラー] ユーザーIDが確認できませんでした:', userData);
      return res.status(400).send('❌ ユーザー情報の取得に失敗しました。');
    }

    if (!guild) {
      console.error(`[認証エラー] 該当するDiscordサーバーが見つかりませんでした。GuildId: ${guildId}`);
      return res.status(400).send('❌ 該当するDiscordサーバーが見つかりませんでした。');
    }

    const member = await guild.members.fetch(userData.id).catch(() => null);
    if (!member) {
      console.error(`[認証エラー] ユーザー(${userData.username})が対象サーバーに参加していません。GuildId: ${guild.id}`);
      sendLog(guild, { user: userData }, '❌ Web認証失敗 (メンバー未参加)', `ユーザー: <@${userData.id}> (\`${userData.id}\`)\n理由: サーバーに参加していない状態で認証を試みました。`, 0xFF4500);
      return res.status(400).send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding-top: 50px; color: #ff4500;">
            <h1>❌ 認証失敗 (メンバー未参加)</h1>
            <p>指定されたDiscordサーバーにあなたのアカウントが参加していません。先にサーバーへ参加してから認証を行ってください。</p>
          </body>
        </html>
      `);
    }

    const linkedUserId = checkMultiAccount(guildId, clientIp, fingerprint, userData.id);
    if (linkedUserId) {
      console.warn(`[認証失敗: マルチアカウント検知] ユーザー: ${userData.username} (${userData.id}), IP:${clientIp}, 紐付け元: ${linkedUserId}`);
      sendLog(guild, member, '❌ Web認証失敗 (マルチアカウント検知)', `ユーザー: <@${userData.id}> (\`${userData.id}\`)\n理由: 同一ネットワーク環境または端末から、別のアカウント（<@${linkedUserId}> / \`${linkedUserId}\`）ですでに認証されています。`, 0xFF4500);
      return res.send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding-top: 50px; color: #ff4500;">
            <h1>❌ 認証失敗 (マルチアカウント検知)</h1>
            <p>同一のネットワーク環境または端末（ブラウザ）から、すでに別のアカウントが認証されています。複数アカウントでの認証は禁止されています。</p>
          </body>
        </html>
      `);
    }

    const userCreatedAt = new Date(Number(BigInt(userData.id) >> 22n) + 1420070400000);
    const accountAgeDays = (Date.now() - userCreatedAt.getTime()) / (1000 * 60 * 60 * 24);

    const MIN_ACCOUNT_AGE_DAYS = 7;
    if (accountAgeDays < MIN_ACCOUNT_AGE_DAYS) {
      console.warn(`[認証失敗: サブアカウント検知] ユーザー: ${userData.username} (${userData.id}), 作成日数: ${accountAgeDays.toFixed(1)}日`);
      sendLog(guild, member, '❌ Web認証失敗 (サブアカウント検知)', `ユーザー: <@${userData.id}> (\`${userData.id}\`)\n理由: アカウント作成から ${accountAgeDays.toFixed(1)} 日経過（制限: ${MIN_ACCOUNT_AGE_DAYS}日未満）`, 0xFF4500);
      return res.send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding-top: 50px; color: #ff4500;">
            <h1>❌ 認証失敗 (サブアカウント検知)</h1>
            <p>アカウント作成から ${MIN_ACCOUNT_AGE_DAYS} 日未満のため、このサーバーへの参加・認証は許可されていません。</p>
          </body>
        </html>
      `);
    }

    const settings = getGuildSettings(guild.id);
    if (!settings.verifyRoleId) {
      console.error(`[認証エラー] サーバー(${guild.name})の認証ロールが設定されていません。`);
      return res.status(500).send('❌ サーバー側で認証ロールが設定されていません。管理者に連絡してください。');
    }

    try {
      await member.roles.add(settings.verifyRoleId);
      
      sendLog(guild, member, '✅ Web認証成功', `<@${userData.id}> (\`${userData.id}\`) がWebブラウザ経由の高度なセキュリティ認証をクリアしました。`, 0x00FF00);

      return res.send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding-top: 50px; color: #008000;">
            <h1>✅ 認証に成功しました！</h1>
            <p>Discordに戻ってサーバーをお楽しみください。このタブは閉じて構いません。</p>
          </body>
        </html>
      `);
    } catch (roleError) {
      console.error(`[認証エラー] ロール付与に失敗しました:`, roleError);
      sendLog(guild, member, '❌ Web認証失敗 (権限エラー)', `ユーザー: <@${userData.id}> (\`${userData.id}\`)\n理由: Botの権限不足によりロールを付与できませんでした。`, 0xFF4500);
      return res.status(500).send('❌ ロールの自動付与に失敗しました。Botの権限設定を管理者に確認してください。');
    }

  } catch (error) {
    console.error('[OAuth2コールバック例外エラー]:', error);
    res.status(500).send('❌ 認証処理中にサーバーエラーが発生しました。');
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`[Webサーバー] ポート ${process.env.PORT || 3000} で起動しました。`);
});


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

const { processQueue, loadDictionary, saveDictionary } = require('./tts.js');
const { generateAnimalIcon } = require('./animalIcon.js');


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
// 永続設定（サーバーごと）
// ============================================================
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
    vcLogChannelId: null,
    readChannelId: null,
    ownerOnlineStatus: '🔴 オフライン',
    lastOwnerStatusChange: 0
  };
}

function getGuildSettings(guildId) {
  if (!botSettings[guildId]) botSettings[guildId] = defaultGuildSettings();
  if (botSettings[guildId].ownerOnlineStatus === undefined) {
    botSettings[guildId].ownerOnlineStatus = '🔴 オフライン';
  }
  if (botSettings[guildId].lastOwnerStatusChange === undefined) {
    botSettings[guildId].lastOwnerStatusChange = 0;
  }
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


// ============================================================
// 各種キャッシュ・マップ・キュー管理
// ============================================================
const vcJoinTimes = new Map();
const readingSessions = new Map();


// ============================================================
// ステータス（人数カウンター）チャンネルの自動更新関数
// ============================================================

const lastStatUpdateTimes = new Map();

async function updateServerStats(guild) {
  try {
    const now = Date.now();
    const lastTime = lastStatUpdateTimes.get(guild.id) || 0;
    if (now - lastTime < 60 * 1000) {
      return;
    }
    lastStatUpdateTimes.set(guild.id, now);

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

    const settings = getGuildSettings(guild.id);
    const ownerStatusText = settings.ownerOnlineStatus || '🔴 オフライン';

    for (const [channelId, channel] of guild.channels.cache) {
      if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
        const name = channel.name;
        if (name.includes('総メンバー数') || name.includes('総メンバー')) {
          const newName = `総メンバー数: ${totalMembers}`;
          if (name !== newName) await channel.setName(newName).catch(() => {});
        } else if (name.includes('人間:')) {
          const newName = `人間: ${humanCount}`;
          if (name !== newName) await channel.setName(newName).catch(() => {});
        } else if (name.includes('Bot:')) {
          const newName = `Bot: ${botCount}`;
          if (name !== newName) await channel.setName(newName).catch(() => {});
        } else if (name.includes('VC参加中:')) {
          const newName = `VC参加中: ${vcHumanCount}`;
          if (name !== newName) await channel.setName(newName).catch(() => {});
        } else if (name.includes('鯖主:')) {
          const newName = `鯖主: ${ownerStatusText}`;
          if (name !== newName) {
            await channel.setName(newName).catch(err => console.log('鯖主チャンネル名変更エラー:', err));
          }
        }
      }
    }
  } catch (error) {
    console.error('サーバー統計チャンネル更新エラー:', error);
  }
}


// ============================================================
// 認証ログ
// ============================================================

async function sendLog(guild, member, title, description, color = 0x00FF00) {
  const settings = getGuildSettings(guild.id);
  const targetChannelId = settings.logChannelId || settings.userInfoChannelId;
  if (!targetChannelId) return;

  try {
    const logChannel = guild.channels.cache.get(targetChannelId);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(color)
      .setThumbnail(member.user.displayAvatarURL ? member.user.displayAvatarURL({ dynamic: true }) : null)
      .setDescription(description)
      .setTimestamp();

    await logChannel.send({ embeds: [embed] });
  } catch (error) {
    console.error('ログ送信失敗:', error);
  }
}


// ============================================================
// パネル生成用関数
// ============================================================

function buildRolePanelComponents(guild) {
  const settings = getGuildSettings(guild.id);
  const currentRoles = settings.roleIds || ['1537841157315231896'];
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
        value: (settings.logChannelId || settings.userInfoChannelId) ? `<#${settings.logChannelId || settings.userInfoChannelId}>` : '未設定'
      },
      {
        name: 'セキュリティ設定',
        value: `• サブ垢対策: 7日未満をブロック\n• VPN/プロキシ検知: 有効\n• マルチアカウント検知: 有効`
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
        .setLabel('ここにWeb認証パネルを設置')
        .setStyle(ButtonStyle.Success)
    );

  return {
    embeds: [embed],
    components: [roleSelectRow, channelSelectRow, buttonRow]
  };
}

function buildRoleAdminPanel(guild) {
  const settings = getGuildSettings(guild.id);
  const currentRoles = settings.roleIds || ['1537841157315231896'];
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

function buildVcLogAdminPanel(guild) {
  const settings = getGuildSettings(guild.id);
  const embed = new EmbedBuilder()
    .setTitle('⚙️ VC退出ログ機能 管理ダッシュボード')
    .setColor(0x5865F2)
    .addFields({
      name: '現在の出力先チャンネル',
      value: settings.vcLogChannelId ? `<#${settings.vcLogChannelId}>` : '未設定 (ログは送信されません)'
    });

  const channelSelectRow = new ActionRowBuilder()
    .addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('select_vc_log_channel')
        .setPlaceholder('VC退出ログを送るテキストチャンネルを選択')
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
      .setName('check-user')
      .setDescription('指定したメンバーのアカウント作成日やサブ垢・マルチ垢の情報を確認します（管理者限定）')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption(option =>
        option.setName('target')
          .setDescription('確認したいメンバー')
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('animal-icon')
      .setDescription('まったり可愛い動物のアイコン画像をランダムに生成します'),
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
      .setName('owner-status')
      .setDescription('鯖主（オーナー）のオンライン・オフライン状態を設定します（鯖主限定・クールタイム有）')
      .addStringOption(option =>
        option.setName('status')
          .setDescription('設定する状態')
          .setRequired(true)
          .addChoices(
            { name: 'オンライン', value: '🟢 オンライン' },
            { name: 'オフライン', value: '🔴 オフライン' },
            { name: '取り込み中', value: '🟡 取り込み中' },
            { name: '退席中', value: '🟠 退席中' }
          )
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
      .setName('setup-vc-log')
      .setDescription('VC退出ログの出力先チャンネルを設定します（管理者限定）')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('setup-ticket')
      .setDescription('チケット作成パネルを指定チャンネルに設置します（管理者限定）')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
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
});


// ============================================================
// イベント: メンバーの参加・退出
// ============================================================

client.on(Events.GuildMemberAdd, (member) => {
  updateServerStats(member.guild);
});

client.on(Events.GuildMemberRemove, (member) => {
  updateServerStats(member.guild);
});


// ============================================================
// イベント: ボイスチャンネル入退室
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
      const targetChannelId = settings.vcLogChannelId;
      
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

    if (commandName === 'check-user') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ 管理者権限が必要です。', ephemeral: true });
      }

      const targetMember = interaction.options.getMember('target');
      const targetUser = interaction.options.getUser('target');

      if (!targetUser) {
        return interaction.reply({ content: '❌ ユーザーが見つかりませんでした。', ephemeral: true });
      }

      const userCreatedAt = new Date(Number(BigInt(targetUser.id) >> 22n) + 1420070400000);
      const accountAgeDays = (Date.now() - userCreatedAt.getTime()) / (1000 * 60 * 60 * 24);
      const isSubAccount = accountAgeDays < 7;

      let linkedUserId = null;
      const guildSec = securityData[guild.id];
      if (guildSec) {
        for (const [ip, uid] of Object.entries(guildSec.ips || {})) {
          if (uid === targetUser.id) {
            for (const [otherIp, otherUid] of Object.entries(guildSec.ips || {})) {
              if (otherIp === ip && otherUid !== targetUser.id) {
                linkedUserId = otherUid;
                break;
              }
            }
          }
        }
      }

      const embed = new EmbedBuilder()
        .setTitle(`🔍 ユーザー詳細調査: ${targetUser.tag}`)
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .setColor(isSubAccount ? 0xFF4500 : 0x00FF00)
        .addFields(
          { name: 'ユーザーメンション', value: `<@${targetUser.id}> (\`${targetUser.id}\`)`, inline: false },
          { name: 'アカウント作成日', value: `${userCreatedAt.toLocaleString('ja-JP')} (約 ${accountAgeDays.toFixed(1)}日前)`, inline: false },
          { name: 'サブ垢判定 (7日未満)', value: isSubAccount ? '⚠️ **サブ垢の可能性が高いです (7日未満)**' : '✅ 通常アカウント (7日以上経過)', inline: false },
          { name: 'マルチアカウント紐付け', value: linkedUserId ? `⚠️ 紐づく別アカウント検知: <@${linkedUserId}> (\`${linkedUserId}\`)` : '🔍 紐づく別アカウントの記録はありません', inline: false }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    else if (commandName === 'animal-icon') {
      await interaction.deferReply();
      try {
        const buffer = generateAnimalIcon();
        const attachment = new AttachmentBuilder(buffer, { name: 'animal-icon.png' });

        const embed = new EmbedBuilder()
          .setTitle('🎨 まったり動物アイコンメーカー')
          .setDescription('あなたのためにランダム生成された可愛いアイコンです！')
          .setImage('attachment://animal-icon.png')
          .setColor(0xFFB6C1)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed], files: [attachment] });
      } catch (error) {
        console.error('アイコン生成エラー:', error);
        await interaction.editReply({ content: '❌ アイコンの生成に失敗しました。' });
      }
    }

    else if (commandName === 'owner-status') {
      if (interaction.user.id !== guild.ownerId) {
        return interaction.reply({ content: '❌ このコマンドはサーバーのオーナー（鯖主）のみ実行できます。', ephemeral: true });
      }

      const settings = getGuildSettings(guild.id);
      const now = Date.now();
      const cooldownTime = 3 * 60 * 1000;

      if (now - settings.lastOwnerStatusChange < cooldownTime) {
        const remainingSec = Math.ceil((cooldownTime - (now - settings.lastOwnerStatusChange)) / 1000);
        const remainingMin = Math.ceil(remainingSec / 60);
        return interaction.reply({ content: `⏳ クールタイム中です。あと約 ${remainingMin} 分 (${remainingSec}秒) お待ちください。`, ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      const status = interaction.options.getString('status');
      settings.ownerOnlineStatus = status;
      settings.lastOwnerStatusChange = now;
      saveSettings();

      updateServerStats(guild).catch(err => console.error('ステータス更新エラー:', err));

      await interaction.editReply({ content: `✅ 鯖主のステータスを **「${status}」** に設定しました！人数カウンターを更新しました。` });
    }

    else if (commandName === 'clear') {
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

    else if (commandName === 'setup-vc-log') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '管理者権限が必要です。', ephemeral: true });
      }
      const panel = buildVcLogAdminPanel(guild);
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
    else if (interaction.customId === 'select_vc_log_channel') {
      settings.vcLogChannelId = interaction.values[0];
      saveSettings();
      await interaction.update(buildVcLogAdminPanel(guild));
    }
  }

  else if (interaction.isButton()) {
    if (interaction.customId === 'admin_deploy_verify_panel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '管理者権限が必要です。', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('🔒 Webメンバー認証')
        .setDescription('下のボタンを押して、ブラウザから安全に認証を行ってください。')
        .setColor(0x00FF00);

      const verifyWebUrl = `https://discord-bot-5evs.onrender.com/verify?guild=${guild.id}`;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🌐 ブラウザで認証する')
          .setStyle(ButtonStyle.Link)
          .setURL(verifyWebUrl)
      );

      await interaction.channel.send({ embeds: [embed], components: [row] });
      await interaction.reply({ content: 'Web認証パネルを設置しました！', ephemeral: true });
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
    else if (interaction.customId.startsWith('close_ticket')) {
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
});


// ============================================================
// ログイン処理
// ============================================================

client.login(process.env.DISCORD_TOKEN);