const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');

const GUILD_ID = process.env.UNB_GUILD_ID;
const UNB_API = 'https://unbelievaboat.com/api/v1';

async function getUserBalance(userId) {
  const res = await fetch(`${UNB_API}/guilds/${GUILD_ID}/users/${userId}`, {
    headers: { Authorization: process.env.UNB_API_TOKEN }
  });
  if (!res.ok) throw new Error(`Failed to fetch balance: ${res.status}`);
  return res.json();
}

async function editUserBalance(userId, payload) {
  const res = await fetch(`${UNB_API}/guilds/${GUILD_ID}/users/${userId}`, {
    method: 'PATCH',
    headers: {
      Authorization: process.env.UNB_API_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Failed to edit balance: ${res.status}`);
  return res.json();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('t')
    .setDescription('Trade between CC and Credits')
    .addSubcommand(s =>
      s.setName('trade')
        .setDescription('Exchange CC ↔ Credits')
        .addStringOption(o =>
          o.setName('direction')
            .setDescription('Trade direction')
            .setRequired(true)
            .addChoices(
              { name: 'CC → Credits', value: 'cc-to-credits' },
              { name: 'Credits → CC', value: 'credits-to-cc' }
            )
        )
        .addIntegerOption(o =>
          o.setName('amount').setDescription('Amount to trade').setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('rates')
        .setDescription('Show current exchange rates')
    ),

  execute: async (interaction, { supabase }) => {
    const sub = interaction.options.getSubcommand();
    const uid = interaction.user.id;

    const makeEmbed = (title, description, color = 0x2f3136) =>
      new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);

    // ===== /t trade =====
    if (sub === 'trade') {
      const direction = interaction.options.getString('direction');
      const amount = interaction.options.getInteger('amount');

      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();
      if (!user) {
        return interaction.reply({
          embeds: [makeEmbed('❌ User Not Found', 'You are not registered yet.', 0xff0000)],
          ephemeral: true
        });
      }

      try {
        if (direction === 'cc-to-credits') {
          // 🔍 Check CC balance via API
          const ccBal = await getUserBalance(uid);
          if (!ccBal || ccBal.cash < amount) {
            return interaction.reply({
              embeds: [makeEmbed(
                '❌ Insufficient CC',
                `You only have **${ccBal?.cash || 0} CC**, but need **${amount} CC**.`,
                0xff0000
              )],
              ephemeral: true
            });
          }

          const credits = amount * parseFloat(process.env.CC_TO_CREDITS);
          await editUserBalance(uid, { cash: -amount });
          await supabase.from('users').update({ balance: user.balance + credits }).eq('id', uid);

          return interaction.reply({
            embeds: [makeEmbed('💱 Trade Complete', `Traded **${amount} CC → ${credits} Credits** ✅`, 0x00ffcc)]
          });

        } else if (direction === 'credits-to-cc') {
          // 🔍 Check Credits balance in Supabase
          if (user.balance < amount) {
            return interaction.reply({
              embeds: [makeEmbed('❌ Insufficient Credits', `You only have **${user.balance} Credits**, but need **${amount} Credits**.`, 0xff0000)],
              ephemeral: true
            });
          }

          const cc = amount * parseFloat(process.env.CREDITS_TO_CC);
          await supabase.from('users').update({ balance: user.balance - amount }).eq('id', uid);
          await editUserBalance(uid, { cash: cc });

          return interaction.reply({
            embeds: [makeEmbed('💱 Trade Complete', `Traded **${amount} Credits → ${cc} CC** ✅`, 0x00ffcc)]
          });
        }

      } catch (err) {
        console.error(err);
        return interaction.reply({
          embeds: [makeEmbed('❌ Trade Failed', 'Something went wrong while processing your trade.', 0xff0000)],
          ephemeral: true
        });
      }
    }

    // ===== /t rates =====
    if (sub === 'rates') {
      const ccToCredits = process.env.CC_TO_CREDITS;
      const creditsToCc = process.env.CREDITS_TO_CC;

      return interaction.reply({
        embeds: [makeEmbed(
          '💱 Current Exchange Rates',
          `**1 CC → ${ccToCredits} Credits**\n**1 Credit → ${creditsToCc} CC**`,
          0x00ccff
        )]
      });
    }
  }
};
