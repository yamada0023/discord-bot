const http = require('http');

// Webサーバーの起動 (Render等の常時起動・Keep-Alive用)
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
let verifyRoleId = '1537841157315231896'; // 認証ロールID
let userInfoChannelId = null; // ログチャンネルID（認証用）
let roleIds = ['1537841157315231896']; // ロールパネル用ロールIDリスト

// 一時データ（認証コード保持）
const activeCaptchas = new Map();

// --- ログ送信関数（認証用ログのみで使用） ---
async function sendLog(guild, member, title, description, color = 0x00FF00) {
  if (!userInfoChannelId) return;
  try {
    const logChannel = guild.channels.cache.get(userInfoChannelId);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(color)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setDescription(description)
      .setTimestamp();

    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error('ログ送信失敗:', err);
  }
}

// --- 認証コード生成 ---
function generateCaptchaCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let text = '';
  for (let i = 0; i < 6; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
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
function buildVerifyAdminPanel() {
  const embed = new EmbedBuilder()
    .setTitle('⚙️ メンバー認証 管理ダッシュボード')
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
    new ButtonBuilder().setCustomId('admin_deploy_verify_panel').setLabel('ここに認証パネルを設置').setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [roleSelectRow, channelSelectRow, buttonRow] };
}

function buildRoleAdminPanel() {
  const roleDisplay = roleIds.map(id => `<@&${id}>`).join('\n') || '未設定';

  const embed = new EmbedBuilder()
    .setTitle('⚙️ ロールパネル 管理ダッシュボード')
    .setColor(0x5865F2)
    .addFields(
      { name: '対象ロール一覧 (複数指定可)', value: roleDisplay }
    );

  const roleSelectRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('select_multi_roles')
      .setPlaceholder('パネルに表示するロールを選択 (複数可)')
      .setMinValues(1)
      .setMaxValues(25)
  );

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_deploy_role_panel').setLabel('ここにロール選択パネルを設置').setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [roleSelectRow, buttonRow] };
}

// --- スラッシュコマンド登録 ---
client.on(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setStatus('online');
  client.user.setActivity('認証＆ロール管理', { type: 0 });

  const commands = [
    new SlashCommandBuilder().setName('setup-verify').setDescription('認証の設定管理画面を表示します'),
    new SlashCommandBuilder().setName('verify').setDescription('認証パネルを設置します'),
    new SlashCommandBuilder().setName('setup-role').setDescription('ロール付与パネルの設定管理画面を表示します'),
    new SlashCommandBuilder().setName('role-panel').setDescription('ロール選択パネルを設置します')
  ].map(command => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(client.token);

  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('スラッシュコマンドの登録が完了しました！');
  } catch (error) {
    console.error('スラッシュコマンド登録エラー:', error);
  }
});

// --- インタラクション処理 ---
client.on(Events.InteractionCreate, async interaction => {
  try {
    // スラッシュコマンド
    if (interaction.isChatInputCommand()) {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ このコマンドは管理者専用です。', ephemeral: true });
      }

      if (interaction.commandName === 'setup-verify') {
        return interaction.reply(buildVerifyAdminPanel());
      }

      if (interaction.commandName === 'verify') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('start_captcha_verify').setLabel('🔒 認証を開始').setStyle(ButtonStyle.Success)
        );
        return interaction.reply({
          content: '📋 **メンバー認証**\n以下のボタンを押してコード認証を行ってください。',
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

    // ドロップダウンメニュー
    if (interaction.isRoleSelectMenu()) {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ 管理者権限が必要です。', ephemeral: true });
      }

      if (interaction.customId === 'select_verify_role') {
        verifyRoleId = interaction.values[0];
        await interaction.update(buildVerifyAdminPanel());
        return;
      }

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

      if (interaction.customId === 'select_log_channel') {
        userInfoChannelId = interaction.values[0] || null;
        await interaction.update(buildVerifyAdminPanel());
        return;
      }
    }

    // 管理パネル ボタン操作
    if (interaction.isButton() && interaction.customId.startsWith('admin_')) {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ 管理者権限が必要です。', ephemeral: true });
      }

      if (interaction.customId === 'admin_deploy_verify_panel') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('start_captcha_verify').setLabel('🔒 認証を開始').setStyle(ButtonStyle.Success)
        );
        await interaction.channel.send({
          content: '📋 **メンバー認証**\n以下のボタンを押してコード認証を行ってください。',
          components: [row]
        });
        return await interaction.reply({ content: '✅ 認証パネルを設置しました！', ephemeral: true });
      }

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

    // モーダル送信処理（認証用）
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
          // 認証完了時は指定ログチャンネルに通知を送る
          await sendLog(interaction.guild, interaction.member, '🔒 認証成功', `ユーザー: ${interaction.user.tag} (<@${interaction.user.id}>)`);
        } catch (err) {
          console.error('ロール付与エラー:', err);
          if (err.code === 50013) {
            await interaction.reply({ 
              content: '❌ **ロールの付与に失敗しました（権限順位エラー）**\n\n【解決方法】\nDiscordの`サーバー設定` ＞ `ロール` で、**Botのロールを付与したいロールより「上」に移動**させてください！', 
              ephemeral: true 
            });
          } else {
            await interaction.reply({ content: '❌ ロールの付与に失敗しました。Botの権限を確認してください。', ephemeral: true });
          }
        }
      } else {
        await interaction.reply({ content: '❌ コードが一致しません。もう一度ボタンを押してやり直してください。', ephemeral: true });
      }
    }

    // 一般ユーザー用ボタン操作
    if (interaction.isButton()) {
      if (interaction.customId === 'start_captcha_verify') {
        const code = generateCaptchaCode();
        activeCaptchas.set(interaction.user.id, code);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('open_captcha_modal').setLabel('コードを入力する').setStyle(ButtonStyle.Primary)
        );

        return await interaction.reply({
          content: `以下の認証コードを下の「コードを入力する」ボタンを押して入力してください:\n\n# \` ${code} \``,
          components: [row],
          ephemeral: true
        });
      }

      if (interaction.customId === 'open_captcha_modal') {
        const modal = new ModalBuilder().setCustomId('modal_submit_captcha').setTitle('メンバー認証');
        const input = new TextInputBuilder().setCustomId('input_captcha_answer').setLabel('表示された6桁の認証コード').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return await interaction.showModal(modal);
      }

      // ロール切替ボタン（※ログ通知を出さない改修箇所）
      if (interaction.customId.startsWith('toggle_role_')) {
        await interaction.deferReply({ ephemeral: true });

        const targetRoleId = interaction.customId.replace('toggle_role_', '');
        const role = interaction.guild.roles.cache.get(targetRoleId);

        if (!role) {
          return interaction.editReply({ content: '⚠️ ロールが見つかりません。`/setup-role` で設定し直してください。' });
        }

        try {
          if (interaction.member.roles.cache.has(targetRoleId)) {
            await interaction.member.roles.remove(role);
            // 本人のみに一時メッセージを返却（ログチャンネルへの sendLog は削除済み）
            await interaction.editReply({ content: `❌ **${role.name}** ロールを解除しました。` });
          } else {
            await interaction.member.roles.add(role);
            // 本人のみに一時メッセージを返却（ログチャンネルへの sendLog は削除済み）
            await interaction.editReply({ content: `✅ **${role.name}** ロールが付与されました！` });
          }
        } catch (error) {
          console.error('ロール操作エラー:', error);
          if (error.code === 50013) {
            await interaction.editReply({ 
              content: `❌ **ロール「${role.name}」の操作に失敗しました（権限順位エラー）**\n\n【解決手順】\n1. サーバー設定 ＞ ロール を開く\n2. **ボットのロールを「${role.name}」より上にドラッグ**して保存してください。` 
            });
          } else {
            await interaction.editReply({ content: '❌ ロールの操作に失敗しました。Botの権限を確認してください。' });
          }
        }
      }
    }
  } catch (globalError) {
    console.error('全体エラー:', globalError);
  }
});

client.login(process.env.TOKEN);