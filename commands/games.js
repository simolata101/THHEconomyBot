const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const helpers = require('./helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('games')
    .setDescription('Mini games and gambling')
    .addSubcommand(s =>
      s.setName('minigame')
        .setDescription('Play a quick minigame (dice)')
    )
    .addSubcommand(s =>
      s.setName('gamble')
        .setDescription('Choose a gambling game')
        .addStringOption(o =>
          o.setName('game')
            .setDescription('Pick a gambling game')
            .setRequired(true)
            .addChoices(
              { name: 'Coin Flip', value: 'coinflip' },
              { name: 'Blackjack', value: 'blackjack' },
              { name: 'Tower Game', value: 'tower' }
            )
        )
        .addIntegerOption(o =>
          o.setName('amount')
            .setDescription('The amount of credits to stake')
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('stock')
        .setDescription('Simulated stock buy/sell')
        .addStringOption(o =>
          o.setName('action')
            .setDescription('Choose whether to buy or sell')
            .setRequired(true)
            .addChoices(
              { name: 'buy', value: 'buy' },
              { name: 'sell', value: 'sell' }
            )
        )
        .addIntegerOption(o =>
          o.setName('amount')
            .setDescription('The amount of stock to trade')
        )
    )
    .addSubcommand(s =>
      s.setName('auction')
        .setDescription('Create an auction (simple)')
        .addIntegerOption(o =>
          o.setName('starting')
            .setDescription('Starting price of the auction')
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('lottery')
        .setDescription('Buy lottery ticket')
        .addIntegerOption(o =>
          o.setName('tickets')
            .setDescription('Number of tickets to buy')
            .setRequired(true)
        )
    ),

  execute: async (interaction, { supabase }) => {
    const sub = interaction.options.getSubcommand();
    const uid = interaction.user.id;
    await helpers.ensureUser(supabase, uid);

    // --- 🎲 Mini Dice ---
    if (sub === 'minigame') {
      const roll = helpers.randomBetween(1, 6);
      const win = roll >= 5;
      const reward = win ? 50 : 0;
      if (win) {
        await supabase.from('users')
          .update({ balance: supabase.raw('balance + ?', [reward]) })
          .eq('id', uid).catch(()=>{});
      }

      const embed = new EmbedBuilder()
        .setTitle('🎲 Dice Roll')
        .setColor(win ? 0x00ff00 : 0xff0000)
        .setDescription(`You rolled a **${roll}**\n${win ? `✅ You win **${reward}** credits!` : '❌ No reward this time.'}`);

      return interaction.reply({ embeds: [embed] });
    }

    // --- 🃏 Gambling Hub ---
    if (sub === 'gamble') {
      const game = interaction.options.getString('game');
      const amount = interaction.options.getInteger('amount');
      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();

      if (!user || amount <= 0 || amount > (user.balance || 0)) {
        return interaction.reply({ content: '❌ Invalid amount or insufficient balance.', ephemeral: true });
      }

      // 🎲 Coin Flip
      if (game === 'coinflip') {
        const flip = Math.random() < 0.5 ? 'Heads' : 'Tails';
        const win = Math.random() < 0.5;
        const payout = win ? amount * 2 : 0;

        await supabase.from('users').update({ balance: user.balance - amount + payout }).eq('id', uid);

        const embed = new EmbedBuilder()
          .setTitle('🪙 Coin Flip')
          .setColor(win ? 0x00ff00 : 0xff0000)
          .setDescription(`You flipped **${flip}**\n${win ? `✅ Won **${payout}** credits!` : `❌ Lost **${amount}** credits.`}`);

        return interaction.reply({ embeds: [embed] });
      }

      // 🃏 Blackjack (simple hit/stand)
      if (game === 'blackjack') {
        const playerHand = [helpers.randomBetween(1, 11), helpers.randomBetween(1, 11)];
        const dealerHand = [helpers.randomBetween(4, 11), helpers.randomBetween(4, 11)];
        const total = hand => hand.reduce((a, b) => a + b, 0);
        let playerTotal = total(playerHand);

        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId('hit').setLabel('Hit').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('stand').setLabel('Stand').setStyle(ButtonStyle.Secondary),
          );

        const embed = new EmbedBuilder()
          .setTitle('🃏 Blackjack')
          .setDescription(`Your hand: **${playerHand.join(', ')}** (Total: ${playerTotal})\nDealer shows: **${dealerHand[0]}**\n\nDo you want to hit or stand?`)
          .setColor(0x0099ff);

        await interaction.reply({ embeds: [embed], components: [row] });

        const collector = interaction.channel.createMessageComponentCollector({
          time: 20000,
          max: 1,
          filter: i => i.user.id === uid
        });

        collector.on('collect', async (btn) => {
          if (btn.customId === 'hit') {
            playerHand.push(helpers.randomBetween(1, 11));
            playerTotal = total(playerHand);
            if (playerTotal > 21) {
              await supabase.from('users').update({ balance: user.balance - amount }).eq('id', uid);
              const busted = new EmbedBuilder()
                .setTitle('💥 Bust!')
                .setColor(0xff0000)
                .setDescription(`You drew: **${playerHand.join(', ')}** (Total: ${playerTotal})\n❌ You lost **${amount}** credits.`);
              return btn.update({ embeds: [busted], components: [] });
            }
            const updated = new EmbedBuilder()
              .setTitle('🃏 Blackjack')
              .setDescription(`You drew: **${playerHand.join(', ')}** (Total: ${playerTotal})\n[Run /games gamble again to continue]`)
              .setColor(0x0099ff);
            return btn.update({ embeds: [updated], components: [] });
          } else {
            const dealerTotal = total(dealerHand);
            const win = (playerTotal <= 21 && (playerTotal > dealerTotal || dealerTotal > 21));
            const payout = win ? amount * 2 : 0;
            await supabase.from('users').update({ balance: user.balance - amount + payout }).eq('id', uid);

            const result = new EmbedBuilder()
              .setTitle('🃏 Blackjack Result')
              .setColor(win ? 0x00ff00 : 0xff0000)
              .setDescription(
                `Dealer: **${dealerHand.join(', ')}** (Total: ${dealerTotal})\n` +
                `You: **${playerHand.join(', ')}** (Total: ${playerTotal})\n\n` +
                (win ? `✅ You win **${payout}** credits!` : `❌ You lost **${amount}** credits.`)
              );

            return btn.update({ embeds: [result], components: [] });
          }
        });
      }

      // 🏗 Tower Game
      if (game === 'tower') {
        let level = 0;
        let multiplier = 1;
        let active = true;

        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId('climb').setLabel('Climb Tower').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('cashout').setLabel('Cash Out').setStyle(ButtonStyle.Danger),
          );

        const embed = new EmbedBuilder()
          .setTitle('🏗 Tower Game')
          .setDescription(`Bet: **${amount}** credits\nLevel: ${level} | Multiplier: x${multiplier}`)
          .setColor(0x00bfff);

        await interaction.reply({ embeds: [embed], components: [row] });

        const collector = interaction.channel.createMessageComponentCollector({
          time: 30000,
          filter: i => i.user.id === uid
        });

        collector.on('collect', async (btn) => {
          if (!active) return;
          if (btn.customId === 'climb') {
            if (Math.random() < 0.3) {
              active = false;
              await supabase.from('users').update({ balance: user.balance - amount }).eq('id', uid);
              const fail = new EmbedBuilder()
                .setTitle('💥 Tower Collapse')
                .setColor(0xff0000)
                .setDescription(`You fell at level ${level}!\n❌ Lost **${amount}** credits.`);
              return btn.update({ embeds: [fail], components: [] });
            }
            level++;
            multiplier += 0.5;
            const update = new EmbedBuilder()
              .setTitle('🏗 Tower Game')
              .setDescription(`Climbed to level **${level}**!\nMultiplier: x${multiplier}\n\nDo you climb again or cash out?`)
              .setColor(0x00bfff);
            return btn.update({ embeds: [update], components: [row] });
          } else {
            active = false;
            const payout = Math.floor(amount * multiplier);
            await supabase.from('users').update({ balance: user.balance - amount + payout }).eq('id', uid);
            const cashout = new EmbedBuilder()
              .setTitle('💰 Tower Cashout')
              .setColor(0x00ff00)
              .setDescription(`You cashed out at level ${level}!\n✅ Won **${payout}** credits.`);
            return btn.update({ embeds: [cashout], components: [] });
          }
        });
      }
    }

    // --- 📈 Stocks ---
    if (sub === 'stock') {
      const action = interaction.options.getString('action');
      const amount = interaction.options.getInteger('amount') || 1;
      const price = helpers.randomBetween(10, 200);
      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();

      if (action === 'buy') {
        const cost = price * amount;
        if (cost > (user.balance || 0))
          return interaction.reply({ content: 'Not enough money', ephemeral: true });
        await supabase.from('users').update({ balance: user.balance - cost }).eq('id', uid);
        return interaction.reply(`📈 Bought ${amount} stock(s) at ${price} each for ${cost}.`);
      } else {
        const gain = price * amount;
        await supabase.from('users').update({ balance: (user.balance || 0) + gain }).eq('id', uid);
        return interaction.reply(`📉 Sold ${amount} stocks for ${gain} credits (price ${price}).`);
      }
    }

    // --- 🏦 Auction ---
    if (sub === 'auction') {
      const starting = interaction.options.getInteger('starting');
      const { data } = await supabase.from('shop_items').insert({ name: `Auction by ${uid}`, price: starting }).select().single();
      return interaction.reply(`🛒 Created auction item with starting price ${starting}. Item ID: ${data.id}`);
    }

    // --- 🎟 Lottery ---
    if (sub === 'lottery') {
      const tickets = interaction.options.getInteger('tickets');
      const costPer = 10;
      const total = tickets * costPer;
      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();
      if (total > (user.balance || 0))
        return interaction.reply({ content: 'Not enough funds for tickets', ephemeral: true });
      await supabase.from('users').update({ balance: user.balance - total }).eq('id', uid);
      return interaction.reply(`🎟 Bought ${tickets} tickets for ${total} credits.`);
    }
  }
};
