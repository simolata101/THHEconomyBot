const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Admin-only server events')
    .addSubcommand(s =>
      s.setName('event')
        .setDescription('Trigger a server-wide event')
        .addStringOption(o =>
          o.setName('type')
            .setDescription('Type of event to trigger')
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('drawlottery')
        .setDescription('Draw lottery (admin)')
    )
    .addSubcommand(s =>
      s.setName('addcredits')
        .setDescription('Add credits to a user')
        .addUserOption(o =>
          o.setName('user')
            .setDescription('Target user')
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('type')
            .setDescription('Where to add credits (balance or bank_balance)')
            .addChoices(
              { name: 'Wallet Balance', value: 'balance' },
              { name: 'Bank Balance', value: 'bank_balance' }
            )
            .setRequired(true)
        )
        .addIntegerOption(o =>
          o.setName('amount')
            .setDescription('Amount of credits to add')
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('removecredits')
        .setDescription('Remove credits from a user')
        .addUserOption(o =>
          o.setName('user')
            .setDescription('Target user')
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('type')
            .setDescription('Where to remove credits (balance or bank_balance)')
            .addChoices(
              { name: 'Wallet Balance', value: 'balance' },
              { name: 'Bank Balance', value: 'bank_balance' }
            )
            .setRequired(true)
        )
        .addIntegerOption(o =>
          o.setName('amount')
            .setDescription('Amount of credits to remove')
            .setRequired(true)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, { supabase, client }) {
    const sub = interaction.options.getSubcommand();

    // 📌 EVENT COMMAND
    if (sub === 'event') {
      const type = interaction.options.getString('type');
      const guild = interaction.guild;
      const members = await guild.members.fetch({ withPresences: true });

      let count = 0;
      for (const [id, member] of members) {
        if (member.presence) {
          await supabase.from('users')
            .upsert({ id, balance: 50 }, { onConflict: ['id'] })
            .catch(() => {});
          count++;
        }
      }
      return interaction.reply(`Event ${type} triggered. Gave 50 credits to ${count} members.`);
    }

    // 📌 LOTTERY COMMAND
    if (sub === 'drawlottery') {
      return interaction.reply('Lottery draw not fully implemented in template.');
    }

    // 📌 ADD/REMOVE CREDITS
    if (sub === 'addcredits' || sub === 'removecredits') {
      const target = interaction.options.getUser('user');
      const type = interaction.options.getString('type');
      const amount = interaction.options.getInteger('amount');

      // Fetch user from DB
      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('id', target.id)
        .single();

      let newValue = (userData?.[type] || 0);
      if (sub === 'addcredits') {
        newValue += amount;
      } else {
        newValue = Math.max(0, newValue - amount);
      }

      await supabase
        .from('users')
        .upsert({ id: target.id, [type]: newValue }, { onConflict: ['id'] });

      // 📌 Embed response
      const embed = new EmbedBuilder()
        .setTitle(sub === 'addcredits' ? '💰 Credits Added' : '💸 Credits Removed')
        .setDescription(
          `${interaction.user} ${sub === 'addcredits' ? 'added' : 'removed'} **${amount}** credits ${sub === 'addcredits' ? 'to' : 'from'} ${target}.`
        )
        .addFields(
          { name: 'Type', value: type, inline: true },
          { name: 'New Value', value: `${newValue}`, inline: true }
        )
        .setColor(sub === 'addcredits' ? 0x2ecc71 : 0xe74c3c)
        .setTimestamp();

      // Reply to admin
      await interaction.reply({ embeds: [embed], ephemeral: true });

      // Log to tracking channel
      const logChannel = client.channels.cache.get('775448210265210931');
      if (logChannel) {
        logChannel.send({ embeds: [embed] });
      }
    }
  }
};
