const http = require('http');

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
// 認証コード
// ============================================================

const activeCaptchas = new Map();


// ============================================================
// 統計VC
// ============================================================

/*
guild.id = {

  total: 'VCチャンネルID',

  human: 'VCチャンネルID',

  bot: 'VCチャンネルID',

  voice: 'VCチャンネルID'

}
*/

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

  } catch (error) {

    console.error(
      'ログ送信失敗:',
      error
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
// ロールパネル生成
// ============================================================

function buildRolePanelComponents(guild) {

  const rows = [];

  let currentRow =
    new ActionRowBuilder();

  for (const roleId of roleIds) {

    const role =
      guild.roles.cache.get(roleId);

    const labelName =
      role
        ? role.name
        : `未設定 (${roleId})`;

    const button =
      new ButtonBuilder()

        .setCustomId(
          `toggle_role_${roleId}`
        )

        .setLabel(
          `🏷️ ${labelName}`
        )

        .setStyle(
          ButtonStyle.Primary
        );

    currentRow.addComponents(button);

    // 1行5個まで
    if (
      currentRow.components.length >= 5
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
    roleIds.length > 0

      ? roleIds
          .map(
            id => `<@&${id}>`
          )
          .join('\n')

      : '未設定';


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
            'パネルに表示するロールを選択'
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
      `[統計取得] ${guild.name} のメンバー情報を取得中...`
    );


    // --------------------------------------------------------
    // Discordからメンバーを取得
    // --------------------------------------------------------

    const members =
      await guild.members.fetch();


    let humanCount = 0;

    let botCount = 0;


    // --------------------------------------------------------
    // 人間 / Botを分類
    // --------------------------------------------------------

    for (
      const member of members.values()
    ) {

      if (
        member.user.bot
      ) {

        botCount++;

      } else {

        humanCount++;

      }

    }


    // --------------------------------------------------------
    // fetchできたメンバー数を総数として使用
    // --------------------------------------------------------

    const fetchedTotal =
      members.size;


    // --------------------------------------------------------
    // guild.memberCountとも比較
    // --------------------------------------------------------

    const officialTotal =
      guild.memberCount || 0;


    let totalMembers =
      fetchedTotal;


    /*
      DiscordのmemberCountと取得数が一致しない場合、
      guild.memberCountを参考値として使用。

      通常はfetch結果と一致します。
    */

    if (
      officialTotal > totalMembers
    ) {

      console.warn(
        `[統計警告] ${guild.name} | fetch=${fetchedTotal} | Discord=${officialTotal}`
      );

      totalMembers =
        officialTotal;

    }


    // --------------------------------------------------------
    // キャッシュ
    // --------------------------------------------------------

    const result = {

      totalMembers,

      humanCount,

      botCount

    };


    memberStatsCache.set(
      guild.id,
      result
    );


    console.log(

      `[統計] ${guild.name}` +

      ` | 総:${totalMembers}` +

      ` | 人間:${humanCount}` +

      ` | Bot:${botCount}`

    );


    return result;


  } catch (error) {

    console.error(
      `[統計] メンバー取得エラー (${guild.name}):`,
      error
    );


    // --------------------------------------------------------
    // 前回キャッシュ
    // --------------------------------------------------------

    if (
      memberStatsCache.has(
        guild.id
      )
    ) {

      return memberStatsCache.get(
        guild.id
      );

    }


    // --------------------------------------------------------
    // 最低限の値
    // --------------------------------------------------------

    return {

      totalMembers:
        guild.memberCount || 0,

      humanCount: 0,

      botCount: 0

    };

  }

}


// ============================================================
// VC参加人数
// ============================================================

function getVoiceCount(guild) {

  let count = 0;


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
// サーバー統計
// ============================================================

async function getServerStats(guild) {

  let memberStats =
    memberStatsCache.get(
      guild.id
    );


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


    const stats =
      await getServerStats(
        guild
      );


    // ========================================================
    // 既存VC検索
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
    // 総メンバーVC
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

    }


    // ========================================================
    // VC参加中
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
    // 即時更新
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


    // ========================================================
    // 最新統計
    // ========================================================

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
    // 総メンバー
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
    // VC参加中
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
// 統計更新予約
// ============================================================

function scheduleStatsUpdate(guild) {

  if (!guild) return;


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
// メンバー情報更新予約
// ============================================================

function scheduleMemberRefresh(guild) {

  if (!guild) return;


  if (
    memberRefreshTimers.has(
      guild.id
    )
  ) {

    clearTimeout(
      memberRefreshTimers.get(
        guild.id
      )
    );

  }


  const timer =
    setTimeout(

      async () => {

        memberRefreshTimers.delete(
          guild.id
        );


        await refreshMemberStats(
          guild
        );


        await updateStatsChannels(
          guild
        );

      },

      1500

    );


  memberRefreshTimers.set(
    guild.id,
    timer
  );

}


// ============================================================
// Ready
// ============================================================

client.once(
  Events.ClientReady,

  async () => {

    console.log(
      `========================================`
    );

    console.log(
      `Bot Login: ${client.user.tag}`
    );

    console.log(
      `========================================`
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


    // ========================================================
    // コマンド登録
    // ========================================================

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
        'スラッシュコマンド登録完了'
      );


    } catch (error) {

      console.error(
        'スラッシュコマンド登録エラー:',
        error
      );

    }


    // ========================================================
    // 全サーバー処理
    // ========================================================

    for (
      const guild
        of client.guilds.cache.values()
    ) {

      try {

        console.log(
          `[起動処理] ${guild.name}`
        );


        // メンバー統計取得
        await refreshMemberStats(
          guild
        );


        // 統計VC
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


    // ========================================================
    // 定期的な人数チェック
    //
    // 5分ごとにDiscordから再取得
    // ========================================================

    setInterval(

      async () => {

        console.log(
          '[定期統計] メンバー数を再確認中...'
        );


        for (
          const guild
            of client.guilds.cache.values()
        ) {

          try {

            await refreshMemberStats(
              guild
            );


            await updateStatsChannels(
              guild
            );


          } catch (error) {

            console.error(
              `[定期統計] ${guild.name}:`,
              error
            );

          }

        }

      },

      5 * 60 * 1000

    );

  }

);


// ============================================================
// サーバー参加
// ============================================================

client.on(
  Events.GuildCreate,

  async guild => {

    console.log(
      `[GuildCreate] ${guild.name} に参加`
    );


    try {

      await refreshMemberStats(
        guild
      );


      await createStatsChannels(
        guild
      );


    } catch (error) {

      console.error(
        '[GuildCreate] エラー:',
        error
      );

    }

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


    scheduleMemberRefresh(
      member.guild
    );

  }

);


// ============================================================
// メンバー退出
// ============================================================

client.on(
  Events.GuildMemberRemove,

  async member => {

    console.log(

      `[メンバー退出] ${
        member.user?.tag ||
        member.id
      }`

    );


    scheduleMemberRefresh(
      member.guild
    );

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


            return interaction.reply({

              content:
                `🧹 **${deleted.size}** 件のメッセージを削除しました。`,

              ephemeral: true

            });


          } catch (error) {

            console.error(
              'メッセージ削除エラー:',
              error
            );


            return interaction.reply({

              content:
                '❌ メッセージの削除に失敗しました。',

              ephemeral: true

            });

          }

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


          return interaction.update(
            buildVerifyAdminPanel()
          );

        }


        // 複数ロール
        if (
          interaction.customId ===
          'select_multi_roles'
        ) {

          roleIds =
            interaction.values;


          return interaction.update(
            buildRoleAdminPanel()
          );

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


          return interaction.update(
            buildVerifyAdminPanel()
          );

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
        // 認証パネル
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
        // ロールパネル
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


          } catch (error) {

            console.error(
              'ロール付与エラー:',
              error
            );


            if (
              error.code === 50013
            ) {

              return interaction.reply({

                content:
                  '❌ **ロールの付与に失敗しました（権限順位エラー）**\n\nDiscordの「サーバー設定」→「ロール」で、Botのロールを付与したいロールより上に移動してください。',

                ephemeral: true

              });

            }


            return interaction.reply({

              content:
                '❌ ロールの付与に失敗しました。Botの権限を確認してください。',

              ephemeral: true

            });

          }

        } else {

          return interaction.reply({

            content:
              '❌ コードが一致しません。もう一度認証をやり直してください。',

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


          return interaction.reply({

            content:
              `以下の認証コードを入力してください。\n\n# \`${code}\``,

            components: [

              row

            ],

            ephemeral: true

          });

        }


        // ====================================================
        // モーダル
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

            // ------------------------------------------------
            // ロールを持っている
            // ------------------------------------------------

            if (
              interaction.member.roles.cache.has(
                targetRoleId
              )
            ) {

              await interaction.member.roles.remove(
                role
              );


              return interaction.editReply({

                content:
                  `❌ **${role.name}** ロールを解除しました。`

              });

            }


            // ------------------------------------------------
            // ロールを持っていない
            // ------------------------------------------------

            await interaction.member.roles.add(
              role
            );


            return interaction.editReply({

              content:
                `✅ **${role.name}** ロールが付与されました！`

            });


          } catch (error) {

            console.error(
              'ロール操作エラー:',
              error
            );


            if (
              error.code === 50013
            ) {

              return interaction.editReply({

                content:
                  `❌ **ロール「${role.name}」の操作に失敗しました。**\n\nBotのロールを「${role.name}」より上に移動してください。`

              });

            }


            return interaction.editReply({

              content:
                '❌ ロールの操作に失敗しました。Botの権限を確認してください。'

            });

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
