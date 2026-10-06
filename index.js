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

// メモリ上で設定を保持する変数
let verifyRoleId = '1537841157315231896'; // デフォルト認証ロールID
let userInfoChannelId = null; // ログ用チャンネルID
let minAccountAgeDays = 3; // サブ垢対策（最低日数）

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
    .setDescription('ボタンを押して各種設定を行えます。')
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
    new ButtonBuilder().setCustomId('admin_deploy_button_panel').setLabel('ここにボタン認証パネルを設置').setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [row1, row2] };
}

// Bot起動時にアプリコマンド（スラッシュコマンド）を登録
client.on(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setStatus('online');
  client.user.setActivity('認証管理中', { type: 0 });

  const commands = [
    new SlashCommandBuilder()
      .setName('setup-verify')
      .setDescription('認証用ロールやログ送信先チャンネルを設定します'),
    new SlashCommandBuilder()
      .setName('verify')
      .setDescription('ワンクリック認証パネルを表示します'),
    new SlashCommandBuilder()
      .setName('setup-panel')
      .setDescription('ワンクリック認証パネルを表示します')
  ].map(command => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  try {
    console.log('アプリコマンドの登録を開始します...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('アプリコマンドの登録が完了しました！');
  } catch (error) {
    console.error('アプリコマンド登録エラー:', error);
  }
});

// インタラクション（スラッシュコマンド・ボタン・モーダル処理）
client.on(Events.InteractionCreate, async interaction => {

  // --- スラッシュコマンドの処理 ---
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'setup-verify') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ このコマンドは管理者のみ使用できます。', ephemeral: true });
      }
      return interaction.reply(buildAdminPanel());
    }

    if (interaction.commandName === 'verify' || interaction.commandName === 'setup-panel') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('click_verify')
          .setLabel('✅ 認証してロールを受け取る')
          .setStyle(ButtonStyle.Success)
      );

      return interaction.reply({
        content: '🔒 **サーバー参加認証**\n以下のボタンを押すだけで認証が完了し、ロールが付与されます。',
        components: [row]
      });
    }
  }

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

    if (interaction.customId === 'admin_deploy_button_panel') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('click_verify')
          .setLabel('✅ 認証してロールを受け取る')
          .setStyle(ButtonStyle.Success)
      );

      await interaction.channel.send({
        content: '🔒 **サーバー参加認証**\n以下のボタンを押すだけで認証が完了し、ロールが付与されます。',
        components: [row]
      });

      return await interaction.reply({ content: '✅ このチャンネルにワンクリック認証パネルを設置しました！', ephemeral: true });
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

  // --- ワンクリックボタン認証処理（一般ユーザー用） ---
  if (interaction.isButton() && interaction.customId === 'click_verify') {
    
    // サブ垢チェック（アカウント作成経過日数の判定）
    const createdTimestamp = interaction.user.createdTimestamp;
    const accountAgeDays = (Date.now() - createdTimestamp) / (1000 * 60 * 60 * 24);

    if (accountAgeDays < minAccountAgeDays) {
      return interaction.reply({ 
        content: `⚠️ **認証失敗**: アカウント作成から ${minAccountAgeDays} 日未満のアカウントは認証できません。（サブアカウント防止措置）`, 
        ephemeral: true 
      });
    }

    const role = interaction.guild.roles.cache.get(verifyRoleId);
    if (!role) {
      return interaction.reply({ content: '⚠️ 認証ロールが見つかりませんでした。Bot管理者に確認してください。', ephemeral: true });
    }

    // 既にロールを持っているか判定
    if (interaction.member.roles.cache.has(verifyRoleId)) {
      return interaction.reply({ content: 'すでに認証完了済みです！', ephemeral: true });
    }

    try {
      // ロール付与の実行
      await interaction.member.roles.add(role);
      await interaction.reply({ content: `✅ 認証が完了し、**${role.name}** ロールが付与されました！`, ephemeral: true });
      
      // ログを出力
      await sendLog(interaction.guild, interaction.member, 'ワンクリックボタン認証');
    } catch (error) {
      console.error('ロール付与エラー:', error);
      await interaction.reply({ 
        content: '❌ ロールの付与に失敗しました。Botのロール権限の位置が、付与したいロールより上にあるか確認してください。', 
        ephemeral: true 
      });
    }
  }
});

client.login(process.env.TOKEN);