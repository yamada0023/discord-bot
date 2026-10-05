const discord = require('discord.js');

const client = new discord.Client({
    intents: [
        discord.GatewayIntentBits.Guilds,
        discord.GatewayIntentBits.GuildMembers,
        discord.GatewayIntentBits.GuildMessages,
        discord.GatewayIntentBits.GuildMessageReactions,
        discord.GatewayIntentBits.MessageContent
    ],
    partials: [
        discord.Partials.Message,
        discord.Partials.Channel,
        discord.Partials.Reaction
    ]
});

// メモリ上で設定を保持する変数（サーバー再起動時用に初期値もセット可能）
let verifyRoleId = '1537841157315231896'; // デフォルトの認証ロールID
let userInfoChannelId = null; // デフォルトのログチャンネルID（未設定時はnull）

// 絵文字のリスト（10個まで対応）
const EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

// Bot起動時にコマンドを登録
client.on(discord.Events.ClientReady, async () => {
    console.log('Logged in as ' + client.user.tag);

    const commands = [
        new discord.SlashCommandBuilder()
            .setName('verify')
            .setDescription('認証パネルを表示'),

        new discord.SlashCommandBuilder()
            .setName('setup-panel')
            .setDescription('リアクション方式のロールパネルを作成します'),

        // ★ 新規追加: 認証設定コマンド
        new discord.SlashCommandBuilder()
            .setName('setup-verify')
            .setDescription('認証用ロールやログ送信先チャンネルを設定します')
    ];

    await client.application.commands.set(commands);
});

// インタラクション受信処理
client.on(discord.Events.InteractionCreate, async (interaction) => {

    // ==========================================
    // 1. スラッシュコマンド受信処理
    // ==========================================
    if (interaction.isChatInputCommand()) {

        // --- /verify コマンド ---
        if (interaction.commandName === 'verify') {
            const embed = new discord.EmbedBuilder()
                .setColor(discord.Colors.Green)
                .setTitle('認証パネル')
                .setDescription('以下のボタンを押して認証してください。');

            const button = new discord.ButtonBuilder()
                .setCustomId('verify_button')
                .setLabel('認証')
                .setStyle(discord.ButtonStyle.Primary);

            await interaction.reply({
                embeds: [embed],
                components: [new discord.ActionRowBuilder().addComponents(button)]
            });
        }

        // --- /setup-panel コマンド（ロールパネル作成） ---
        if (interaction.commandName === 'setup-panel') {
            const roleSelect = new discord.RoleSelectMenuBuilder()
                .setCustomId('admin_select_roles')
                .setPlaceholder('パネルに追加したいロールを選択してください（最大10個）')
                .setMinValues(1)
                .setMaxValues(10);

            await interaction.reply({
                content: '⚙️ **パネルに含めたいロールを選択してください：**',
                components: [new discord.ActionRowBuilder().addComponents(roleSelect)],
                ephemeral: true
            });
        }

        // --- /setup-verify コマンド（認証設定メニューの表示） ---
        if (interaction.commandName === 'setup-verify') {
            const roleSelect = new discord.RoleSelectMenuBuilder()
                .setCustomId('config_verify_role')
                .setPlaceholder('認証時に付与するロールを選択してください')
                .setMinValues(1)
                .setMaxValues(1);

            const channelSelect = new discord.ChannelSelectMenuBuilder()
                .setCustomId('config_verify_channel')
                .setPlaceholder('認証ログを送信するチャンネルを選択してください')
                .setChannelTypes(discord.ChannelType.GuildText)
                .setMinValues(1)
                .setMaxValues(1);

            const currentRoleText = verifyRoleId ? `<@&${verifyRoleId}>` : '未設定';
            const currentChannelText = userInfoChannelId ? `<#${userInfoChannelId}>` : '未設定';

            const embed = new discord.EmbedBuilder()
                .setColor(discord.Colors.Gold)
                .setTitle('⚙️ 認証機能の設定')
                .setDescription('下のメニューから設定を変更できます。')
                .addFields(
                    { name: '現在の認証ロール', value: currentRoleText, inline: true },
                    { name: '現在のログ送信先', value: currentChannelText, inline: true }
                );

            await interaction.reply({
                embeds: [embed],
                components: [
                    new discord.ActionRowBuilder().addComponents(roleSelect),
                    new discord.ActionRowBuilder().addComponents(channelSelect)
                ],
                ephemeral: true
            });
        }
    }

    // ==========================================
    // 2. 設定メニューの変更受信処理
    // ==========================================
    // --- 認証ロールが選択されたとき ---
    if (interaction.isRoleSelectMenu() && interaction.customId === 'config_verify_role') {
        const selectedRole = interaction.roles.first();
        verifyRoleId = selectedRole.id;

        await interaction.reply({
            content: `✅ 認証付与ロールを ${selectedRole} に設定しました！`,
            ephemeral: true
        });
    }

    // --- ログチャンネルが選択されたとき ---
    if (interaction.isChannelSelectMenu() && interaction.customId === 'config_verify_channel') {
        const selectedChannel = interaction.channels.first();
        userInfoChannelId = selectedChannel.id;

        await interaction.reply({
            content: `✅ 認証ログ送信先を ${selectedChannel} に設定しました！`,
            ephemeral: true
        });
    }

    // --- ロールパネル作成用セレクトメニュー ---
    if (interaction.isRoleSelectMenu() && interaction.customId === 'admin_select_roles') {
        const selectedRoles = Array.from(interaction.roles.values());

        let description = '以下のリアクションを押すと、対応するロールが付与・解除されます！\n\n';
        const reactionMapText = selectedRoles.map((role, index) => {
            return `${EMOJIS[index]} : <@&${role.id}>`;
        }).join('\n');

        const embed = new discord.EmbedBuilder()
            .setColor(discord.Colors.Blue)
            .setTitle('🎭 リアクションロールパネル')
            .setDescription(description + reactionMapText);

        const message = await interaction.channel.send({ embeds: [embed] });

        for (let i = 0; i < selectedRoles.length; i++) {
            await message.react(EMOJIS[i]);
        }

        await interaction.reply({
            content: 'リアクションロールパネルを作成しました！',
            ephemeral: true
        });
    }

    // ==========================================
    // 3. 認証ボタン処理
    // ==========================================
    if (interaction.isButton()) {
        if (interaction.customId === 'verify_button') {
            try {
                if (!verifyRoleId) {
                    await interaction.reply({
                        content: '認証ロールが設定されていません。管理者に `/setup-verify` での設定を依頼してください。',
                        ephemeral: true
                    });
                    return;
                }

                // ロール付与
                await interaction.member.roles.add(verifyRoleId);

                // ログチャンネルへの通知（設定されている場合のみ）
                if (userInfoChannelId) {
                    const targetChannel = interaction.guild.channels.cache.get(userInfoChannelId);
                    const user = interaction.user;

                    if (targetChannel) {
                        const embed = new discord.EmbedBuilder()
                            .setColor(discord.Colors.Blue)
                            .setTitle('🎉 認証完了・新規メンバー情報')
                            .setThumbnail(user.displayAvatarURL())
                            .addFields(
                                { name: 'ユーザー名', value: `${user.tag}`, inline: true },
                                { name: 'ユーザーID', value: user.id, inline: true },
                                { name: 'アカウント作成日', value: user.createdAt.toLocaleDateString('ja-JP') }
                            )
                            .setTimestamp();

                        await targetChannel.send({ embeds: [embed] });
                    }
                }

                await interaction.reply({
                    content: '認証が完了しました！',
                    ephemeral: true
                });

            } catch (error) {
                console.error(error);
                await interaction.reply({
                    content: '認証処理中にエラーが発生しました。Botの権限やロールの位置を確認してください。',
                    ephemeral: true
                });
            }
        }
    }
});

// ==========================================
// 4. リアクション処理（ロール付与）
// ==========================================
client.on(discord.Events.MessageReactionAdd, async (reaction, user) => {
    if (user.bot) return;

    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('メッセージの取得に失敗しました:', error);
            return;
        }
    }

    const message = reaction.message;
    if (!message.embeds.length || message.embeds[0].title !== '🎭 リアクションロールパネル') return;

    const guild = message.guild;
    if (!guild) return;

    const member = await guild.members.fetch(user.id);
    const embedDescription = message.embeds[0].description;

    const emoji = reaction.emoji.name;
    const lines = embedDescription.split('\n');
    const targetLine = lines.find(line => line.startsWith(emoji));

    if (targetLine) {
        const roleIdMatch = targetLine.match(/<@&(\d+)>/);
        if (roleIdMatch) {
            const roleId = roleIdMatch[1];
            try {
                await member.roles.add(roleId);
            } catch (error) {
                console.error('ロールの付与に失敗しました:', error);
            }
        }
    }
});

// ==========================================
// 5. リアクション処理（ロール解除）
// ==========================================
client.on(discord.Events.MessageReactionRemove, async (reaction, user) => {
    if (user.bot) return;

    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('メッセージの取得に失敗しました:', error);
            return;
        }
    }

    const message = reaction.message;
    if (!message.embeds.length || message.embeds[0].title !== '🎭 リアクションロールパネル') return;

    const guild = message.guild;
    if (!guild) return;

    const member = await guild.members.fetch(user.id);
    const embedDescription = message.embeds[0].description;

    const emoji = reaction.emoji.name;
    const lines = embedDescription.split('\n');
    const targetLine = lines.find(line => line.startsWith(emoji));

    if (targetLine) {
        const roleIdMatch = targetLine.match(/<@&(\d+)>/);
        if (roleIdMatch) {
            const roleId = roleIdMatch[1];
            try {
                await member.roles.remove(roleId);
            } catch (error) {
                console.error('ロールの解除に失敗しました:', error);
            }
        }
    }
});

// Botにログイン
client.login(process.env.DISCORD_TOKEN);