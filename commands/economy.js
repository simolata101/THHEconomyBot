const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const helpers = require('./helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('economy')
    .setDescription('Economy commands (work, daily, idle, bank, balance)')
    .addSubcommand(s => s.setName('work').setDescription('Do a job to earn money'))
    .addSubcommand(s => s.setName('daily').setDescription('Claim daily reward'))
    .addSubcommand(s => s.setName('idle').setDescription('Toggle idle earnings'))
    .addSubcommand(s => s.setName('balance').setDescription('Show your balances'))
    .addSubcommand(s => s.setName('bank')
      .setDescription('deposit/withdraw')
      .addStringOption(o => o.setName('action').setDescription('deposit or withdraw').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('amount'))),

  async execute(interaction, { supabase }) {
    const sub = interaction.options.getSubcommand();
    const uid = interaction.user.id;
    await helpers.ensureUser(supabase, uid);

    // Helper embed function
    const makeEmbed = (title, description, color = 0x2f3136) =>
      new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);

    if (sub === 'work') {
      const pay = helpers.randomBetween(20, 150);
      await supabase.from('users').upsert(
        { id: uid, balance: pay },
        { onConflict: ['id'], returning: 'minimal' }
      );
      await interaction.reply({
        embeds: [makeEmbed('💼 Work Complete', `You worked and earned **${pay} credits**!`, 0x00ff00)]
      });
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
        await supabase.from('users')
          .update({
            balance: (user.balance || 0) + reward,
            streak,
            last_daily: now.toISOString()
          })
          .eq('id', uid);

        await interaction.reply({
          embeds: [makeEmbed('📅 Daily Reward',
            `You claimed **${reward} credits**!\nCurrent streak: **${streak}**`, 0x00ffcc)]
        });
      } else {
        await interaction.reply({
          embeds: [makeEmbed('⚠️ Already Claimed', 'You already claimed your daily today. Come back tomorrow.', 0xff0000)],
          ephemeral: true
        });
      }
      return;
    }

    if (sub === 'idle') {
      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();
      const newState = !user?.idle;
      await supabase.from('users').update({ idle: newState }).eq('id', uid);

      await interaction.reply({
        embeds: [makeEmbed('🛌 Idle Mode', `Idle earnings are now **${newState ? 'ENABLED' : 'DISABLED'}**.`, 0xffff00)]
      });
      return;
    }

    if (sub === 'balance') {
      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();

      await interaction.reply({
        embeds: [makeEmbed('💰 Your Balance',
          `**Wallet:** ${user?.balance || 0} credits\n**Gems:** ${user?.gems || 0}\n**Bank:** ${user?.bank_balance || 0}`, 0x0099ff)]
      });
      return;
    }

    if (sub === 'bank') {
      const action = interaction.options.getString('action');
      const amount = interaction.options.getInteger('amount') || 0;
      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();

      if (action === 'deposit') {
        if (amount <= 0 || amount > (user.balance || 0))
          return interaction.reply({
            embeds: [makeEmbed('❌ Error', 'Invalid amount.', 0xff0000)],
            ephemeral: true
          });

        await supabase.from('users').update({
          balance: (user.balance || 0) - amount,
          bank_balance: (user.bank_balance || 0) + amount
        }).eq('id', uid);

        return interaction.reply({
          embeds: [makeEmbed('🏦 Deposit Successful', `Deposited **${amount} credits** to bank.`, 0x00ff00)]
        });
      }

      if (action === 'withdraw') {
        if (amount <= 0 || amount > (user.bank_balance || 0))
          return interaction.reply({
            embeds: [makeEmbed('❌ Error', 'Invalid amount.', 0xff0000)],
            ephemeral: true
          });

        await supabase.from('users').update({
          balance: (user.balance || 0) + amount,
          bank_balance: (user.bank_balance || 0) - amount
        }).eq('id', uid);

        return interaction.reply({
          embeds: [makeEmbed('💳 Withdraw Successful', `Withdrew **${amount} credits** from bank.`, 0x00ff00)]
        });
      }

      return interaction.reply({
        embeds: [makeEmbed('❓ Unknown Action', 'Bank action must be either **deposit** or **withdraw**.', 0xff0000)],
        ephemeral: true
      });
    }
  }
};
