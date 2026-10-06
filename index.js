const http = require('http');

// ============================================================
// Webサーバーの起動
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

    // メンバー情報取得
    GatewayIntentBits.GuildMembers,

    // メッセージ
    GatewayIntentBits.GuildMessages,

    // リアクション
    GatewayIntentBits.GuildMessageReactions,

    // Message Content
    GatewayIntentBits.MessageContent,

    // VC参加・退出・移動を検知
    GatewayIntentBits.GuildVoiceStates

  ],

  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction
  ]

});


// ============================================================
// 設定データ保持用変数
// ============================================================

let verifyRoleId = '1537841157315231896';

// 認証ログチャンネル
let userInfoChannelId = null;

// ロールパネル用ロールID
let roleIds = [
  '1537841157315231896'
];


// ============================================================
// 認証コード保持
// ============================================================

const activeCaptchas = new Map();


// ============================================================
// 統計VC
// ============================================================

// サーバーごとの統計VC ID
//
// guild.id = {
//   total: 'チャンネルID',
//   human: 'チャンネルID',
//   bot: 'チャンネルID',
//   voice: 'チャンネルID'
// }
const statsChannels = new Map();


// メンバー統計のキャッシュ
const memberStatsCache = new Map();


// 統計更新タイマー
const statsUpdateTimers = new Map();


// ============================================================
// ログ送信関数
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

    const logChannel =
      guild.channels.cache.get(
        userInfoChannelId
      );

    if (!logChannel) return;

    const embed =
      new EmbedBuilder()

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

  } catch (err) {

    console.error(
      'ログ送信失敗:',
      err
    );

  }
}


// ============================================================
// 認証コード生成
// ============================================================

function generateCaptchaCode() {

  const chars =
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  let text = '';

  for (let i = 0; i < 6; i++) {

    text += chars.charAt(
      Math.floor(
        Math.random() * chars.length
      )
    );

  }

  return text;
}


// ============================================================
// ロール選択パネル
// ============================================================

function buildRolePanelComponents(guild) {

  const rows = [];

  let currentRow =
    new ActionRowBuilder();

  for (const rId of roleIds) {

    const role =
      guild.roles.cache.get(rId);

    const labelName =
      role
        ? role.name
        : `未設定 (${rId})`;

    const button =
      new ButtonBuilder()

        .setCustomId(
          `toggle_role_${rId}`
        )

        .setLabel(
          `🏷️ ${labelName}`
        )

        .setStyle(
          ButtonStyle.Primary
        );

    currentRow.addComponents(button);


    // 1行最大5個
    if (
      currentRow.components.length === 5
    ) {

      rows.push(currentRow);

      currentRow =
        new ActionRowBuilder();

    }

  }


  if (
    currentRow.components.length > 0
  ) {

    rows.push(currentRow);

  }


  return rows;
}


// ============================================================
// 認証管理パネル
// ============================================================

function buildVerifyAdminPanel() {

  const embed =
    new EmbedBuilder()

      .setTitle(
        '⚙️ メンバー認証 管理ダッシュボード'
      )

      .setColor(0x5865F2)

      .addFields(

        {
          name: '認証付与ロール',

          value:
            verifyRoleId
              ? `<@&${verifyRoleId}>`
              : '未設定'
        },

        {
          name: 'ログチャンネル',

          value:
            userInfoChannelId
              ? `<#${userInfoChannelId}>`
              : '未設定'
        }

      );


  const roleSelectRow =
    new ActionRowBuilder()
      .addComponents(

        new RoleSelectMenuBuilder()

          .setCustomId(
            'select_verify_role'
          )

          .setPlaceholder(
            '付与するロールを選択してください'
          )

          .setMinValues(1)

          .setMaxValues(1)

      );


  const channelSelectRow =
    new ActionRowBuilder()
      .addComponents(

        new ChannelSelectMenuBuilder()

          .setCustomId(
            'select_log_channel'
          )

          .setPlaceholder(
            'ログ出力先のテキストチャンネルを選択'
          )

          .setChannelTypes(
            ChannelType.GuildText
          )

          .setMinValues(0)

          .setMaxValues(1)

      );


  const buttonRow =
    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()

          .setCustomId(
            'admin_deploy_verify_panel'
          )

          .setLabel(
            'ここに認証パネルを設置'
          )

          .setStyle(
            ButtonStyle.Success
          )

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

  const roleDisplay =
    roleIds
      .map(id => `<@&${id}>`)
      .join('\n') || '未設定';


  const embed =
    new EmbedBuilder()

      .setTitle(
        '⚙️ ロールパネル 管理ダッシュボード'
      )

      .setColor(0x5865F2)

      .addFields({

        name:
          '対象ロール一覧 (複数指定可)',

        value:
          roleDisplay

      });


  const roleSelectRow =
    new ActionRowBuilder()
      .addComponents(

        new RoleSelectMenuBuilder()

          .setCustomId(
            'select_multi_roles'
          )

          .setPlaceholder(
            'パネルに表示するロールを選択 (複数可)'
          )

          .setMinValues(1)

          .setMaxValues(25)

      );


  const buttonRow =
    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()

          .setCustomId(
            'admin_deploy_role_panel'
          )

          .setLabel(
            'ここにロール選択パネルを設置'
          )

          .setStyle(
            ButtonStyle.Success
          )

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

    console.log(
      `[統計] ${guild.name} のメンバー情報を取得中...`
    );


    // Discordからメンバー情報を取得
    const members =
      await guild.members.fetch();


    let botCount = 0;

    let humanCount = 0;


    for (
      const member of members.values()
    ) {

      if (member.user.bot) {

        botCount++;

      } else {

        humanCount++;

      }

    }


    // Discord側が持っている正式な総メンバー数
    const totalMembers =
      guild.memberCount;


    const result = {

      totalMembers,

      humanCount,

      botCount

    };


    // キャッシュ
    memberStatsCache.set(
      guild.id,
      result
    );


    console.log(
      `[統計] ${guild.name} | 総:${totalMembers} | 人間:${humanCount} | Bot:${botCount}`
    );


    return result;


  } catch (error) {

    console.error(
      `[統計] メンバー取得エラー (${guild.name}):`,
      error
    );


    // 前回のデータがあれば使用
    if (
      memberStatsCache.has(guild.id)
    ) {

      return memberStatsCache.get(
        guild.id
      );

    }


    // 最低限 guild.memberCount を返す
    return {

      totalMembers:
        guild.memberCount || 0,

      humanCount: 0,

      botCount: 0

    };

  }

}


// ============================================================
// VC参加人数取得
// ============================================================

function getVoiceCount(guild) {

  let count = 0;


  // VoiceStateから取得
  for (
    const voiceState
      of guild.voiceStates.cache.values()
  ) {

    if (
      voiceState.channelId
    ) {

      count++;

    }

  }


  return count;

}


// ============================================================
// サーバー統計取得
// ============================================================

async function getServerStats(guild) {

  let memberStats =
    memberStatsCache.get(
      guild.id
    );


  // 初回なら取得
  if (!memberStats) {

    memberStats =
      await refreshMemberStats(
        guild
      );

  }


  const voiceCount =
    getVoiceCount(guild);


  return {

    totalMembers:
      memberStats.totalMembers,

    humanCount:
      memberStats.humanCount,

    botCount:
      memberStats.botCount,

    voiceCount

  };

}


// ============================================================
// 統計VC作成
// ============================================================

async function createStatsChannels(guild) {

  try {

    console.log(
      `[統計VC] ${guild.name} の統計チャンネルを確認中...`
    );


    // 最新の人数を取得
    const stats =
      await getServerStats(
        guild
      );


    // ========================================================
    // 既存VCを検索
    // ========================================================

    const existingChannels =
      guild.channels.cache.filter(
        channel =>
          channel.type ===
            ChannelType.GuildVoice &&
          channel.name.startsWith('📊')
      );


    let totalChannel =
      existingChannels.find(
        channel =>
          channel.name.startsWith(
            '📊 総メンバー数'
          )
      );


    let humanChannel =
      existingChannels.find(
        channel =>
          channel.name.startsWith(
            '📊 人間'
          )
      );


    let botChannel =
      existingChannels.find(
        channel =>
          channel.name.startsWith(
            '📊 Bot'
          )
      );


    let voiceChannel =
      existingChannels.find(
        channel =>
          channel.name.startsWith(
            '📊 VC参加中'
          )
      );


    // ========================================================
    // 総メンバー数VC
    // ========================================================

    if (!totalChannel) {

      totalChannel =
        await guild.channels.create({

          name:
            `📊 総メンバー数: ${stats.totalMembers}`,

          type:
            ChannelType.GuildVoice,

          permissionOverwrites: [

            {

              id:
                guild.roles.everyone.id,

              deny: [
                PermissionFlagsBits.Connect
              ]

            }

          ]

        });


      console.log(
        '[統計VC] 総メンバー数VCを作成'
      );

    }


    // ========================================================
    // 人間VC
    // ========================================================

    if (!humanChannel) {

      humanChannel =
        await guild.channels.create({

          name:
            `📊 人間: ${stats.humanCount}`,

          type:
            ChannelType.GuildVoice,

          permissionOverwrites: [

            {

              id:
                guild.roles.everyone.id,

              deny: [
                PermissionFlagsBits.Connect
              ]

            }

          ]

        });


      console.log(
        '[統計VC] 人間VCを作成'
      );

    }


    // ========================================================
    // Bot VC
    // ========================================================

    if (!botChannel) {

      botChannel =
        await guild.channels.create({

          name:
            `📊 Bot: ${stats.botCount}`,

          type:
            ChannelType.GuildVoice,

          permissionOverwrites: [

            {

              id:
                guild.roles.everyone.id,

              deny: [
                PermissionFlagsBits.Connect
              ]

            }

          ]

        });


      console.log(
        '[統計VC] Bot VCを作成'
      );

    }


    // ========================================================
    // VC参加人数
    // ========================================================

    if (!voiceChannel) {

      voiceChannel =
        await guild.channels.create({

          name:
            `📊 VC参加中: ${stats.voiceCount}`,

          type:
            ChannelType.GuildVoice,

          permissionOverwrites: [

            {

              id:
                guild.roles.everyone.id,

              deny: [
                PermissionFlagsBits.Connect
              ]

            }

          ]

        });


      console.log(
        '[統計VC] VC参加中VCを作成'
      );

    }


    // ========================================================
    // ID保存
    // ========================================================

    statsChannels.set(

      guild.id,

      {

        total:
          totalChannel.id,

        human:
          humanChannel.id,

        bot:
          botChannel.id,

        voice:
          voiceChannel.id

      }

    );


    // ========================================================
    // 作成直後に更新
    // ========================================================

    await updateStatsChannels(
      guild
    );


  } catch (error) {

    console.error(
      `[統計VC] 作成エラー (${guild.name}):`,
      error
    );

  }

}


// ============================================================
// 統計VC更新
// ============================================================

async function updateStatsChannels(guild) {

  try {

    if (!guild) return;


    // 最新統計
    const stats =
      await getServerStats(
        guild
      );


    let channelIds =
      statsChannels.get(
        guild.id
      );


    // ========================================================
    // Bot再起動後
    // ========================================================

    if (!channelIds) {

      const channels =
        guild.channels.cache;


      const totalChannel =
        channels.find(
          channel =>
            channel.type ===
              ChannelType.GuildVoice &&
            channel.name.startsWith(
              '📊 総メンバー数'
            )
        );


      const humanChannel =
        channels.find(
          channel =>
            channel.type ===
              ChannelType.GuildVoice &&
            channel.name.startsWith(
              '📊 人間'
            )
        );


      const botChannel =
        channels.find(
          channel =>
            channel.type ===
              ChannelType.GuildVoice &&
            channel.name.startsWith(
              '📊 Bot'
            )
        );


      const voiceChannel =
        channels.find(
          channel =>
            channel.type ===
              ChannelType.GuildVoice &&
            channel.name.startsWith(
              '📊 VC参加中'
            )
        );


      if (
        totalChannel &&
        humanChannel &&
        botChannel &&
        voiceChannel
      ) {

        channelIds = {

          total:
            totalChannel.id,

          human:
            humanChannel.id,

          bot:
            botChannel.id,

          voice:
            voiceChannel.id

        };


        statsChannels.set(
          guild.id,
          channelIds
        );

      } else {

        // 足りないVCがあれば作成
        return createStatsChannels(
          guild
        );

      }

    }


    // ========================================================
    // チャンネル取得
    // ========================================================

    const totalChannel =
      guild.channels.cache.get(
        channelIds.total
      );


    const humanChannel =
      guild.channels.cache.get(
        channelIds.human
      );


    const botChannel =
      guild.channels.cache.get(
        channelIds.bot
      );


    const voiceChannel =
      guild.channels.cache.get(
        channelIds.voice
      );


    // ========================================================
    // 総メンバー数
    // ========================================================

    if (
      totalChannel &&
      totalChannel.name !==
        `📊 総メンバー数: ${stats.totalMembers}`
    ) {

      await totalChannel.setName(
        `📊 総メンバー数: ${stats.totalMembers}`
      );

    }


    // ========================================================
    // 人間
    // ========================================================

    if (
      humanChannel &&
      humanChannel.name !==
        `📊 人間: ${stats.humanCount}`
    ) {

      await humanChannel.setName(
        `📊 人間: ${stats.humanCount}`
      );

    }


    // ========================================================
    // Bot
    // ========================================================

    if (
      botChannel &&
      botChannel.name !==
        `📊 Bot: ${stats.botCount}`
    ) {

      await botChannel.setName(
        `📊 Bot: ${stats.botCount}`
      );

    }


    // ========================================================
    // VC
    // ========================================================

    if (
      voiceChannel &&
      voiceChannel.name !==
        `📊 VC参加中: ${stats.voiceCount}`
    ) {

      await voiceChannel.setName(
        `📊 VC参加中: ${stats.voiceCount}`
      );

    }


    console.log(

      `[統計更新] ${guild.name}` +
      ` | 総:${stats.totalMembers}` +
      ` | 人間:${stats.humanCount}` +
      ` | Bot:${stats.botCount}` +
      ` | VC:${stats.voiceCount}`

    );


  } catch (error) {

    console.error(
      `[統計VC] 更新エラー (${guild.name}):`,
      error
    );

  }

}


// ============================================================
// 統計更新を遅延実行
// ============================================================

function scheduleStatsUpdate(guild) {

  if (!guild) return;


  // 既にタイマーがあれば削除
  if (
    statsUpdateTimers.has(
      guild.id
    )
  ) {

    clearTimeout(
      statsUpdateTimers.get(
        guild.id
      )
    );

  }


  // 1秒後に更新
  const timer =
    setTimeout(
      async () => {

        statsUpdateTimers.delete(
          guild.id
        );


        await updateStatsChannels(
          guild
        );

      },

      1000

    );


  statsUpdateTimers.set(
    guild.id,
    timer
  );

}


// ============================================================
// Bot Ready
// ============================================================

client.once(
  Events.ClientReady,
  async () => {

    console.log(
      `Logged in as ${client.user.tag}`
    );


    client.user.setStatus(
      'online'
    );


    client.user.setActivity(
      '認証＆ロール管理',
      {
        type: 0
      }
    );


    // ========================================================
    // スラッシュコマンド
    // ========================================================

    const commands = [

      new SlashCommandBuilder()

        .setName(
          'setup-verify'
        )

        .setDescription(
          '認証の設定管理画面を表示します'
        ),


      new SlashCommandBuilder()

        .setName(
          'verify'
        )

        .setDescription(
          '認証パネルを設置します'
        ),


      new SlashCommandBuilder()

        .setName(
          'setup-role'
        )

        .setDescription(
          'ロール付与パネルの設定管理画面を表示します'
        ),


      new SlashCommandBuilder()

        .setName(
          'role-panel'
        )

        .setDescription(
          'ロール選択パネルを設置します'
        ),


      new SlashCommandBuilder()

        .setName(
          'clear'
        )

        .setDescription(
          '指定した件数のメッセージを一括削除します'
        )

        .addIntegerOption(
          option =>

            option

              .setName(
                'amount'
              )

              .setDescription(
                '削除する件数 (1〜100)'
              )

              .setRequired(
                true
              )

              .setMinValue(
                1
              )

              .setMaxValue(
                100
              )
        )

    ].map(
      command =>
        command.toJSON()
    );


    const rest =
      new REST({
        version: '10'
      }).setToken(
        client.token
      );


    try {

      await rest.put(

        Routes.applicationCommands(
          client.user.id
        ),

        {
          body: commands
        }

      );


      console.log(
        'スラッシュコマンドの登録が完了しました！'
      );


    } catch (error) {

      console.error(
        'スラッシュコマンド登録エラー:',
        error
      );

    }


    // ========================================================
    // 全サーバーの統計VC準備
    // ========================================================

    for (
      const guild
        of client.guilds.cache.values()
    ) {

      try {

        console.log(
          `[起動処理] ${guild.name}`
        );


        // 最初にメンバー情報を取得
        await refreshMemberStats(
          guild
        );


        // 統計VC作成
        await createStatsChannels(
          guild
        );


      } catch (error) {

        console.error(
          `[起動処理] ${guild.name} エラー:`,
          error
        );

      }

    }

  }
);


// ============================================================
// 新しいサーバーに参加
// ============================================================

client.on(
  Events.GuildCreate,
  async guild => {

    console.log(
      `[GuildCreate] ${guild.name} に参加しました`
    );


    await refreshMemberStats(
      guild
    );


    await createStatsChannels(
      guild
    );

  }
);


// ============================================================
// メンバー参加
// ============================================================

client.on(
  Events.GuildMemberAdd,
  async member => {

    console.log(
      `[メンバー参加] ${member.user.tag}`
    );


    try {

      // メンバー情報を再取得
      await refreshMemberStats(
        member.guild
      );


      // 統計更新
      scheduleStatsUpdate(
        member.guild
      );


    } catch (error) {

      console.error(
        '[メンバー参加] 統計更新エラー:',
        error
      );

    }

  }
);


// ============================================================
// メンバー退出
// ============================================================

client.on(
  Events.GuildMemberRemove,
  async member => {

    console.log(
      `[メンバー退出] ${member.user?.tag || member.id}`
    );


    try {

      // メンバー数が変わったので再取得
      await refreshMemberStats(
        member.guild
      );


      // 統計更新
      scheduleStatsUpdate(
        member.guild
      );


    } catch (error) {

      console.error(
        '[メンバー退出] 統計更新エラー:',
        error
      );

    }

  }
);


// ============================================================
// VC参加・退出・移動
// ============================================================

client.on(
  Events.VoiceStateUpdate,
  (oldState, newState) => {

    const guild =
      newState.guild ||
      oldState.guild;


    if (!guild) return;


    console.log(
      `[VC変更] ${guild.name}`
    );


    // VC人数を更新
    scheduleStatsUpdate(
      guild
    );

  }
);


// ============================================================
// インタラクション
// ============================================================

client.on(
  Events.InteractionCreate,
  async interaction => {

    try {

      // ======================================================
      // スラッシュコマンド
      // ======================================================

      if (
        interaction.isChatInputCommand()
      ) {


        // ====================================================
        // /clear
        // ====================================================

        if (
          interaction.commandName ===
          'clear'
        ) {

          if (
            !interaction.member.permissions.has(
              PermissionFlagsBits.ManageMessages
            )
          ) {

            return interaction.reply({

              content:
                '❌ このコマンドを使用するには「メッセージの管理」権限が必要です。',

              ephemeral: true

            });

          }


          const amount =
            interaction.options.getInteger(
              'amount'
            );


          try {

            const deleted =
              await interaction.channel.bulkDelete(
                amount,
                true
              );


            await interaction.reply({

              content:
                `🧹 **${deleted.size}** 件のメッセージを削除しました。`,

              ephemeral: true

            });


          } catch (error) {

            console.error(
              'メッセージ削除エラー:',
              error
            );


            await interaction.reply({

              content:
                '❌ メッセージの削除に失敗しました。（14日以上経過したメッセージは一括削除できません）',

              ephemeral: true

            });

          }


          return;

        }


        // ====================================================
        // 管理者チェック
        // ====================================================

        if (
          !interaction.member.permissions.has(
            PermissionFlagsBits.Administrator
          )
        ) {

          return interaction.reply({

            content:
              '❌ このコマンドは管理者専用です。',

            ephemeral: true

          });

        }


        // ====================================================
        // /setup-verify
        // ====================================================

        if (
          interaction.commandName ===
          'setup-verify'
        ) {

          return interaction.reply(
            buildVerifyAdminPanel()
          );

        }


        // ====================================================
        // /verify
        // ====================================================

        if (
          interaction.commandName ===
          'verify'
        ) {

          const row =
            new ActionRowBuilder()
              .addComponents(

                new ButtonBuilder()

                  .setCustomId(
                    'start_captcha_verify'
                  )

                  .setLabel(
                    '🔒 認証を開始'
                  )

                  .setStyle(
                    ButtonStyle.Success
                  )

              );


          return interaction.reply({

            content:
              '📋 **メンバー認証**\n以下のボタンを押してコード認証を行ってください。',

            components: [
              row
            ]

          });

        }


        // ====================================================
        // /setup-role
        // ====================================================

        if (
          interaction.commandName ===
          'setup-role'
        ) {

          return interaction.reply(
            buildRoleAdminPanel()
          );

        }


        // ====================================================
        // /role-panel
        // ====================================================

        if (
          interaction.commandName ===
          'role-panel'
        ) {

          const components =
            buildRolePanelComponents(
              interaction.guild
            );


          if (
            components.length === 0
          ) {

            return interaction.reply({

              content:
                '⚠️ ロールが選択されていません。`/setup-role` で設定してください。',

              ephemeral: true

            });

          }


          return interaction.reply({

            content:
              '📋 **ロール選択**\n以下のボタンを押してロールを取得・解除できます。',

            components

          });

        }

      }


      // ======================================================
      // ロール選択
      // ======================================================

      if (
        interaction.isRoleSelectMenu()
      ) {

        if (
          !interaction.member.permissions.has(
            PermissionFlagsBits.Administrator
          )
        ) {

          return interaction.reply({

            content:
              '❌ 管理者権限が必要です。',

            ephemeral: true

          });

        }


        // 認証ロール
        if (
          interaction.customId ===
          'select_verify_role'
        ) {

          verifyRoleId =
            interaction.values[0];


          await interaction.update(
            buildVerifyAdminPanel()
          );


          return;

        }


        // 複数ロール
        if (
          interaction.customId ===
          'select_multi_roles'
        ) {

          roleIds =
            interaction.values;


          await interaction.update(
            buildRoleAdminPanel()
          );


          return;

        }

      }


      // ======================================================
      // チャンネル選択
      // ======================================================

      if (
        interaction.isChannelSelectMenu()
      ) {

        if (
          !interaction.member.permissions.has(
            PermissionFlagsBits.Administrator
          )
        ) {

          return interaction.reply({

            content:
              '❌ 管理者権限が必要です。',

            ephemeral: true

          });

        }


        if (
          interaction.customId ===
          'select_log_channel'
        ) {

          userInfoChannelId =
            interaction.values[0] ||
            null;


          await interaction.update(
            buildVerifyAdminPanel()
          );


          return;

        }

      }


      // ======================================================
      // 管理パネルボタン
      // ======================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'admin_'
        )
      ) {

        if (
          !interaction.member.permissions.has(
            PermissionFlagsBits.Administrator
          )
        ) {

          return interaction.reply({

            content:
              '❌ 管理者権限が必要です。',

            ephemeral: true

          });

        }


        // ====================================================
        // 認証パネル設置
        // ====================================================

        if (
          interaction.customId ===
          'admin_deploy_verify_panel'
        ) {

          const row =
            new ActionRowBuilder()
              .addComponents(

                new ButtonBuilder()

                  .setCustomId(
                    'start_captcha_verify'
                  )

                  .setLabel(
                    '🔒 認証を開始'
                  )

                  .setStyle(
                    ButtonStyle.Success
                  )

              );


          await interaction.channel.send({

            content:
              '📋 **メンバー認証**\n以下のボタンを押してコード認証を行ってください。',

            components: [
              row
            ]

          });


          return interaction.reply({

            content:
              '✅ 認証パネルを設置しました！',

            ephemeral: true

          });

        }


        // ====================================================
        // ロールパネル設置
        // ====================================================

        if (
          interaction.customId ===
          'admin_deploy_role_panel'
        ) {

          const components =
            buildRolePanelComponents(
              interaction.guild
            );


          if (
            components.length === 0
          ) {

            return interaction.reply({

              content:
                '⚠️ ロールが選択されていません。',

              ephemeral: true

            });

          }


          await interaction.channel.send({

            content:
              '📋 **ロール選択**\n以下のボタンを押してロールを取得・解除できます。',

            components

          });


          return interaction.reply({

            content:
              '✅ ロール選択パネルを設置しました！',

            ephemeral: true

          });

        }

      }


      // ======================================================
      // 認証モーダル
      // ======================================================

      if (
        interaction.isModalSubmit() &&
        interaction.customId ===
          'modal_submit_captcha'
      ) {

        const userAnswer =
          interaction.fields
            .getTextInputValue(
              'input_captcha_answer'
            )
            .trim()
            .toUpperCase();


        const correctAnswer =
          activeCaptchas.get(
            interaction.user.id
          );


        if (!correctAnswer) {

          return interaction.reply({

            content:
              '❌ 認証セッションの期限が切れました。もう一度ボタンを押してください。',

            ephemeral: true

          });

        }


        // ====================================================
        // 認証成功
        // ====================================================

        if (
          userAnswer ===
          correctAnswer
        ) {

          activeCaptchas.delete(
            interaction.user.id
          );


          const role =
            interaction.guild.roles.cache.get(
              verifyRoleId
            );


          if (!role) {

            return interaction.reply({

              content:
                '⚠️ 認証用ロールが見つかりませんでした。',

              ephemeral: true

            });

          }


          try {

            await interaction.member.roles.add(
              role
            );


            await interaction.reply({

              content:
                `🎉 **認証成功！** <@&${verifyRoleId}> ロールが付与されました。`,

              ephemeral: true

            });


            await sendLog(

              interaction.guild,

              interaction.member,

              '🔒 認証成功',

              `ユーザー: ${interaction.user.tag} (<@${interaction.user.id}>)`

            );


          } catch (err) {

            console.error(
              'ロール付与エラー:',
              err
            );


            if (
              err.code === 50013
            ) {

              await interaction.reply({

                content:
                  '❌ **ロールの付与に失敗しました（権限順位エラー）**\n\n【解決方法】\nDiscordの`サーバー設定` ＞ `ロール` で、**Botのロールを付与したいロールより「上」に移動**させてください！',

                ephemeral: true

              });

            } else {

              await interaction.reply({

                content:
                  '❌ ロールの付与に失敗しました。Botの権限を確認してください。',

                ephemeral: true

              });

            }

          }

        } else {

          await interaction.reply({

            content:
              '❌ コードが一致しません。もう一度ボタンを押してやり直してください。',

            ephemeral: true

          });

        }

      }


      // ======================================================
      // 一般ボタン
      // ======================================================

      if (
        interaction.isButton()
      ) {


        // ====================================================
        // 認証開始
        // ====================================================

        if (
          interaction.customId ===
          'start_captcha_verify'
        ) {

          const code =
            generateCaptchaCode();


          activeCaptchas.set(
            interaction.user.id,
            code
          );


          const row =
            new ActionRowBuilder()
              .addComponents(

                new ButtonBuilder()

                  .setCustomId(
                    'open_captcha_modal'
                  )

                  .setLabel(
                    'コードを入力する'
                  )

                  .setStyle(
                    ButtonStyle.Primary
                  )

              );


          return await interaction.reply({

            content:
              `以下の認証コードを下の「コードを入力する」ボタンを押して入力してください:\n\n# \` ${code} \``,

            components: [
              row
            ],

            ephemeral: true

          });

        }


        // ====================================================
        // 認証コード入力
        // ====================================================

        if (
          interaction.customId ===
          'open_captcha_modal'
        ) {

          const modal =
            new ModalBuilder()

              .setCustomId(
                'modal_submit_captcha'
              )

              .setTitle(
                'メンバー認証'
              );


          const input =
            new TextInputBuilder()

              .setCustomId(
                'input_captcha_answer'
              )

              .setLabel(
                '表示された6桁の認証コード'
              )

              .setStyle(
                TextInputStyle.Short
              )

              .setRequired(
                true
              );


          modal.addComponents(

            new ActionRowBuilder()
              .addComponents(
                input
              )

          );


          return interaction.showModal(
            modal
          );

        }


        // ====================================================
        // ロール切替
        // ====================================================

        if (
          interaction.customId.startsWith(
            'toggle_role_'
          )
        ) {

          await interaction.deferReply({
            ephemeral: true
          });


          const targetRoleId =
            interaction.customId.replace(
              'toggle_role_',
              ''
            );


          const role =
            interaction.guild.roles.cache.get(
              targetRoleId
            );


          if (!role) {

            return interaction.editReply({

              content:
                '⚠️ ロールが見つかりません。`/setup-role` で設定し直してください。'

            });

          }


          try {

            // すでに持っている
            if (
              interaction.member.roles.cache.has(
                targetRoleId
              )
            ) {

              await interaction.member.roles.remove(
                role
              );


              await interaction.editReply({

                content:
                  `❌ **${role.name}** ロールを解除しました。`

              });

            }

            // 持っていない
            else {

              await interaction.member.roles.add(
                role
              );


              await interaction.editReply({

                content:
                  `✅ **${role.name}** ロールが付与されました！`

              });

            }


          } catch (error) {

            console.error(
              'ロール操作エラー:',
              error
            );


            if (
              error.code === 50013
            ) {

              await interaction.editReply({

                content:
                  `❌ **ロール「${role.name}」の操作に失敗しました（権限順位エラー）**\n\n【解決手順】\n1. サーバー設定 ＞ ロールを開く\n2. **ボットのロールを「${role.name}」より上にドラッグ**してください。`

              });

            } else {

              await interaction.editReply({

                content:
                  '❌ ロールの操作に失敗しました。Botの権限を確認してください。'

              });

            }

          }

        }

      }

    } catch (globalError) {

      console.error(
        '全体エラー:',
        globalError
      );

    }

  }
);


// ============================================================
// Botログイン
// ============================================================

client.login(
  process.env.TOKEN
);
