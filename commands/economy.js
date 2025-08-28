
const { SlashCommandBuilder } = require('discord.js');
const helpers = require('./helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('economy')
    .setDescription('Economy commands (work, daily, idle, bank, balance)')
    .addSubcommand(s => s.setName('work').setDescription('Do a job to earn money'))
    .addSubcommand(s => s.setName('daily').setDescription('Claim daily reward'))
    .addSubcommand(s => s.setName('idle').setDescription('Toggle idle earnings'))
    .addSubcommand(s => s.setName('balance').setDescription('Show your balances'))
    .addSubcommand(s => s.setName('bank').setDescription('deposit/withdraw').addStringOption(o=>o.setName('action').setDescription('deposit or withdraw').setRequired(true)).addIntegerOption(o=>o.setName('amount').setDescription('amount'))),

  async execute(interaction, { supabase }) {
    const sub = interaction.options.getSubcommand();
    const uid = interaction.user.id;
    await helpers.ensureUser(supabase, uid);

    if (sub === 'work') {
      const pay = helpers.randomBetween(20, 150);
      await supabase.from('users').upsert({ id: uid, balance: pay }, { onConflict: ['id'], returning: 'minimal' });
      await interaction.reply(`You worked and earned **${pay} credits**!`);
      return;
    }

    if (sub === 'daily') {
      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();
      const now = new Date();
      const last = user?.last_daily ? new Date(user.last_daily) : null;
      const dayMs = 24 * 60 * 60 * 1000;
      let streak = user?.streak || 0;
      if (!last || (now - last) > dayMs) {
        const reward = 100 + streak * 10;
        streak = last && (now - last) < (2 * dayMs) ? streak + 1 : 1;
        await supabase.from('users').update({ balance: (user.balance || 0) + reward, streak, last_daily: now.toISOString() }).eq('id', uid);
        await interaction.reply(`Daily claimed: **${reward} credits**. Current streak: **${streak}**`);
      } else {
        await interaction.reply({ content: 'You already claimed your daily today. Come back tomorrow.', ephemeral: true });
      }
      return;
    }

    if (sub === 'idle') {
      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();
      const newState = !user?.idle;
      await supabase.from('users').update({ idle: newState }).eq('id', uid);
      await interaction.reply(`Idle earnings are now **${newState ? 'ENABLED' : 'DISABLED'}**.`);
      return;
    }

    if (sub === 'balance') {
      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();
      await interaction.reply(`Balance: **${user?.balance || 0} credits** | Gems: **${user?.gems || 0}** | Bank: **${user?.bank_balance || 0}**`);
      return;
    }

    if (sub === 'bank') {
      const action = interaction.options.getString('action');
      const amount = interaction.options.getInteger('amount') || 0;
      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();
      if (action === 'deposit') {
        if (amount <= 0 || amount > (user.balance || 0)) return interaction.reply({ content: 'Invalid amount', ephemeral: true });
        await supabase.from('users').update({ balance: (user.balance || 0) - amount, bank_balance: (user.bank_balance || 0) + amount }).eq('id', uid);
        return interaction.reply(`Deposited ${amount} credits to bank.`);
      }
      if (action === 'withdraw') {
        if (amount <= 0 || amount > (user.bank_balance || 0)) return interaction.reply({ content: 'Invalid amount', ephemeral: true });
        await supabase.from('users').update({ balance: (user.balance || 0) + amount, bank_balance: (user.bank_balance || 0) - amount }).eq('id', uid);
        return interaction.reply(`Withdrew ${amount} credits from bank.`);
      }
      return interaction.reply({ content: 'Unknown bank action', ephemeral: true });
    }
  }
};