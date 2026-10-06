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
  EmbedBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder
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

// メモリ上で設定を保持する変数 (複数IDに対応: カンマ区切り)
let verifyRoleIds = ['1537841157315231896']; // デフォルト付与ロールIDリスト
let userInfoChannelId = null; // ログ用チャンネルID

// 共通ログ出力処理
async function sendLog(guild, member, action, roleName) {
  if (!userInfoChannelId) return;
  const logChannel = guild.channels.cache.get(userInfoChannelId);
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setTitle('⚙️ ロール操作ログ')
    .setColor(action === 'add' ? 0x00FF00 : 0xFF0000)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: 'ユーザー', value: `${member.user.tag} (<@${member.id}>)`, inline: true },
      { name: '操作内容', value: action === 'add' ? `✅ **${roleName}** を付与` : `❌ **${roleName}** を解除`, inline: true }
    )
    .setTimestamp();

  await logChannel.send({ embeds: [embed] }).catch(err => console.error('ログ送信失敗:', err));
}

// 設置用パネル（ボタン群）を構築する関数
function buildRolePanelComponents(guild) {
  const rows = [];
  let currentRow = new ActionRowBuilder();

  for (const roleId of verifyRoleIds) {
    const role = guild.roles.cache.get(roleId);
    const labelName = role ? role.name : `ID: ${roleId}`;

    const button = new ButtonBuilder()
      .setCustomId(`toggle_role_${roleId}`)
      .setLabel(`🏷️ ${labelName}`)
      .setStyle(ButtonStyle.Primary);

    currentRow.addComponents(button);

    // 1つの行に最大5個までボタンを配置可能
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

// 管理者パネルのコンポーネント生成
function buildAdminPanel() {
  const roleDisplay = verifyRoleIds.map(id => `<@&${id}> (\`${id}\`)`).join('\n') || '未設定';

  const embed = new EmbedBuilder()
    .setTitle('⚙️ Bot管理ダッシュボード')
    .setColor(0x5865F2)
    .setDescription('ボタンを押して各種設定を行えます。')
    .addFields(
      { name: '現在の対象ロール一覧', value: roleDisplay, inline: false },
      { name: '現在のログチャンネル', value: userInfoChannelId ? `<#${userInfoChannelId}> (\`${userInfoChannelId}\`)` : '未設定', inline: false }
    );

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_set_role').setLabel('ロールID変更 (複数可)').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_set_log').setLabel('ログチャンネル変更').setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_deploy_role_panel').setLabel('ここにまとめロールパネルを設置').setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [row1, row2] };
}

// Bot起動時にスラッシュコマンド（/）を登録
client.on(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setStatus('online');
  client.user.setActivity('ロール管理中', { type: 0 });

  const commands = [
    new SlashCommandBuilder()
      .setName('setup-verify')
      .setDescription('管理用ダッシュボードを表示します'),
    new SlashCommandBuilder()
      .setName('verify')
      .setDescription('まとめロール付与パネルを設置します'),
    new SlashCommandBuilder()
      .setName('setup-panel')
      .setDescription('まとめロール付与パネルを設置します')
  ].map(command => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('スラッシュコマンドの登録が完了しました！');
  } catch (error) {
    console.error('スラッシュコマンド登録エラー:', error);
  }
});

// インタラクション処理（スラッシュコマンド・ボタン・モーダル）
client.on(Events.InteractionCreate, async interaction => {

  // --- スラッシュコマンド ( / ) の処理 ---
  if (interaction.isChatInputCommand()) {
    
    // /setup-verify
    if (interaction.commandName === 'setup-verify') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ このコマンドは管理者のみ使用できます。', ephemeral: true });
      }
      return interaction.reply(buildAdminPanel());
    }

    // /verify または /setup-panel
    if (interaction.commandName === 'verify' || interaction.commandName === 'setup-panel') {
      const components = buildRolePanelComponents(interaction.guild);
      if (components.length === 0) {
        return interaction.reply({ content: '⚠️ 有効なロールIDが設定されていません。`/setup-verify` で設定してください。', ephemeral: true });
      }

      // チャット全体に公開パネルとして送信
      return interaction.reply({
        content: '📋 **ロール選択パネル**\n以下のボタンを押すことで、対応するロールの取得・解除ができます。',
        components: components
      });
    }
  }

  // --- 管理パネル操作 ---
  if (interaction.isButton() && interaction.customId.startsWith('admin_')) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ 管理者権限が必要です。', ephemeral: true });
    }

    if (interaction.customId === 'admin_set_role') {
      const modal = new ModalBuilder().setCustomId('modal_set_role').setTitle('対象ロールIDの設定');
      const input = new TextInputBuilder()
        .setCustomId('input_role')
        .setLabel('ロールIDを半角カンマ区切りで入力')
        .setPlaceholder('例: 123456789,987654321')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(verifyRoleIds.join(','))
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return await interaction.showModal(modal);
    }

    if (interaction.customId === 'admin_set_log') {
      const modal = new ModalBuilder().setCustomId('modal_set_log').setTitle('ログチャンネルIDの設定');
      const input = new TextInputBuilder().setCustomId('input_log').setLabel('チャンネルIDを入力 (空欄で解除)').setStyle(TextInputStyle.Short).setValue(userInfoChannelId || '').setRequired(false);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return await interaction.showModal(modal);
    }

    if (interaction.customId === 'admin_deploy_role_panel') {
      const components = buildRolePanelComponents(interaction.guild);
      if (components.length === 0) {
        return interaction.reply({ content: '⚠️ 有効なロールIDが設定されていません。', ephemeral: true });
      }

      await interaction.channel.send({
        content: '📋 **ロール選択パネル**\n以下のボタンを押すことで、対応するロールの取得・解除ができます。',
        components: components
      });

      return await interaction.reply({ content: '✅ このチャンネルにまとめロールパネルを設置しました！', ephemeral: true });
    }
  }

  // --- モーダル送信 ---
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'modal_set_role') {
      const rawInput = interaction.fields.getTextInputValue('input_role').trim();
      verifyRoleIds = rawInput.split(',').map(id => id.trim()).filter(id => id.length > 0);
      
      await interaction.reply({ content: `✅ ロールIDを \`${verifyRoleIds.length}\` 件更新しました。`, ephemeral: true });
      return interaction.message.edit(buildAdminPanel());
    }

    if (interaction.customId === 'modal_set_log') {
      userInfoChannelId = interaction.fields.getTextInputValue('input_log').trim() || null;
      await interaction.reply({ content: `✅ ログチャンネルIDを \`${userInfoChannelId || '未設定'}\` に変更しました。`, ephemeral: true });
      return interaction.message.edit(buildAdminPanel());
    }
  }

  // --- 各ロールのボタン押下時 ---
  if (interaction.isButton() && interaction.customId.startsWith('toggle_role_')) {
    const targetRoleId = interaction.customId.replace('toggle_role_', '');
    const role = interaction.guild.roles.cache.get(targetRoleId);

    if (!role) {
      return interaction.reply({ content: '⚠️ 対象のロールが存在しません。サーバー設定を確認してください。', ephemeral: true });
    }

    try {
      if (interaction.member.roles.cache.has(targetRoleId)) {
        await interaction.member.roles.remove(role);
        await interaction.reply({ content: `❌ **${role.name}** ロールを解除しました。`, ephemeral: true });
        await sendLog(interaction.guild, interaction.member, 'remove', role.name);
      } else {
        await interaction.member.roles.add(role);
        await interaction.reply({ content: `✅ **${role.name}** ロールが付与されました！`, ephemeral: true });
        await sendLog(interaction.guild, interaction.member, 'add', role.name);
      }
    } catch (error) {
      console.error('ロール操作エラー:', error);
      await interaction.reply({ 
        content: '❌ ロールの操作に失敗しました。Bot（まったりボット）のロール順位が対象ロールより上にあるか確認してください。', 
        ephemeral: true 
      });
    }
  }
});

client.login(process.env.TOKEN);