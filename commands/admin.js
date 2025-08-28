
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
data: new SlashCommandBuilder()
  .setName('admin')
  .setDescription('Admin-only server events')
  .addSubcommand(s =>
    s.setName('event')
      .setDescription('Trigger a server-wide event')
      .addStringOption(o =>
        o.setName('type')
          .setDescription('Type of event to trigger') // <-- REQUIRED
          .setRequired(true)
      )
  )
  .addSubcommand(s =>
    s.setName('drawlottery')
      .setDescription('Draw lottery (admin)')
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, { supabase, client }) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'event') {
      const type = interaction.options.getString('type');
      // Example event: give 50 credits to everyone online
      const guild = interaction.guild;
      const members = await guild.members.fetch({ withPresences: true });
      let count = 0;
      for (const [id, member] of members) {
        if (member.presence) {
          await supabase.from('users').upsert({ id, balance: 50 }, { onConflict: ['id'] }).catch(()=>{});
          count++;
        }
      }
      return interaction.reply(`Event ${type} triggered. Gave 50 credits to ${count} members.`);
    }

    if (sub === 'drawlottery') {
      // naive draw: pick a random user who bought tickets (not implemented track)
      return interaction.reply('Lottery draw not fully implemented in template.');
    }
  }
};