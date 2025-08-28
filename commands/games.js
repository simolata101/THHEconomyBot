const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
        .setDescription('Play a gamble game (coinflip, blackjack, tower)')
        .addStringOption(o =>
          o.setName('game')
            .setDescription('Choose a gambling game')
            .setRequired(true)
            .addChoices(
              { name: 'coinflip', value: 'coinflip' },
              { name: 'blackjack', value: 'blackjack' },
              { name: 'tower', value: 'tower' }
            )
        )
        .addIntegerOption(o =>
          o.setName('amount')
            .setDescription('Amount of credits to gamble')
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

    if (sub === 'minigame') {
      const roll = helpers.randomBetween(1, 6);
      const win = roll >= 5;
      const reward = win ? 50 : 0;
      if (win) await supabase.from('users').update({ balance: supabase.raw('balance + ?', [reward]) }).eq('id', uid);
      return interaction.reply(`🎲 You rolled a **${roll}**. ${win ? `You win ${reward} credits!` : 'No reward this time.'}`);
    }

    if (sub === 'gamble') {
      const game = interaction.options.getString('game');
      const amount = interaction.options.getInteger('amount');
      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();
      if (!user || amount <= 0 || amount > (user.balance || 0)) {
        return interaction.reply({ content: '❌ Invalid amount', ephemeral: true });
      }

      // --- COINFLIP ---
      if (game === 'coinflip') {
        const guessRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('guess_heads').setLabel('🪙 Heads').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('guess_tails').setLabel('🪙 Tails').setStyle(ButtonStyle.Secondary)
        );

        const embed = new EmbedBuilder()
          .setTitle('🪙 Coin Flip')
          .setDescription(`Bet: **${amount}** credits\nGuess if it will be **Heads** or **Tails**.`)
          .setColor(0xf1c40f);

        await interaction.reply({ embeds: [embed], components: [guessRow] });

        const msg = await interaction.fetchReply();
        const collector = msg.createMessageComponentCollector({ time: 15000, max: 1 });
        collector.on('collect', async btn => {
          if (btn.user.id !== uid) return btn.reply({ content: 'Not your game!', ephemeral: true });

          const guess = btn.customId.includes('heads') ? 'Heads' : 'Tails';
          const flip = Math.random() < 0.5 ? 'Heads' : 'Tails';
          let result;

          if (guess === flip) {
            await supabase.from('users').update({ balance: user.balance + amount }).eq('id', uid);
            result = `✅ You guessed **${guess}** and the coin landed on **${flip}**!\nYou win **${amount}** credits.`;
          } else {
            await supabase.from('users').update({ balance: user.balance - amount }).eq('id', uid);
            result = `❌ You guessed **${guess}**, but it landed on **${flip}**.\nYou lose **${amount}** credits.`;
          }

          const resultEmbed = EmbedBuilder.from(embed)
            .setDescription(result)
            .setColor(guess === flip ? 0x2ecc71 : 0xe74c3c);

          await btn.update({ embeds: [resultEmbed], components: [] });
        });
        return;
      }

      // --- BLACKJACK ---
      if (game === 'blackjack') {
        const deck = helpers.shuffleDeck();
        let playerHand = [deck.pop(), deck.pop()];
        let dealerHand = [deck.pop(), deck.pop()];

        const handValue = (hand) => {
          let value = 0, aces = 0;
          for (const c of hand) {
            if (['J', 'Q', 'K'].includes(c.value)) value += 10;
            else if (c.value === 'A') { value += 11; aces++; }
            else value += parseInt(c.value);
          }
          while (value > 21 && aces > 0) { value -= 10; aces--; }
          return value;
        };

        const renderHand = (hand, hideFirst = false) =>
          hand.map((c, i) => hideFirst && i === 0 ? '🂠' : c.emoji).join(' ');

        let embed = new EmbedBuilder()
          .setTitle('🃏 Blackjack')
          .setDescription(`Bet: **${amount}** credits`)
          .addFields(
            { name: 'Your Hand', value: `${renderHand(playerHand)} (Value: ${handValue(playerHand)})` },
            { name: 'Dealer Hand', value: `${renderHand(dealerHand, true)}` }
          )
          .setColor(0x3498db);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('hit').setLabel('Hit').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('stand').setLabel('Stand').setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({ embeds: [embed], components: [row] });
        const msg = await interaction.fetchReply();
        const collector = msg.createMessageComponentCollector({ time: 30000 });

        collector.on('collect', async btn => {
          if (btn.user.id !== uid) return btn.reply({ content: 'Not your game!', ephemeral: true });

          if (btn.customId === 'hit') playerHand.push(deck.pop());
          if (btn.customId === 'stand') collector.stop('stand');

          let playerVal = handValue(playerHand);
          if (playerVal > 21) {
            await supabase.from('users').update({ balance: user.balance - amount }).eq('id', uid);
            const bustEmbed = EmbedBuilder.from(embed)
              .setFields(
                { name: 'Your Hand', value: `${renderHand(playerHand)} (Value: ${playerVal})` },
                { name: 'Dealer Hand', value: `${renderHand(dealerHand)}` }
              )
              .setColor(0xe74c3c)
              .setDescription(`❌ You busted! Lost **${amount}** credits.`);
            collector.stop();
            return btn.update({ embeds: [bustEmbed], components: [] });
          }

          embed = EmbedBuilder.from(embed)
            .setFields(
              { name: 'Your Hand', value: `${renderHand(playerHand)} (Value: ${playerVal})` },
              { name: 'Dealer Hand', value: `${renderHand(dealerHand, true)}` }
            );

          await btn.update({ embeds: [embed], components: [row] });
        });

        collector.on('end', async (_, reason) => {
          if (reason !== 'stand') return;

          let dealerVal = handValue(dealerHand);
          while (dealerVal < 17) {
            dealerHand.push(deck.pop());
            dealerVal = handValue(dealerHand);
          }

          const playerVal = handValue(playerHand);
          let result, color;

          if (dealerVal > 21 || playerVal > dealerVal) {
            await supabase.from('users').update({ balance: user.balance + amount }).eq('id', uid);
            result = `✅ You win! Gained **${amount}** credits.`;
            color = 0x2ecc71;
          } else if (playerVal === dealerVal) {
            result = `🤝 It's a tie. Your bet is returned.`;
            color = 0xf1c40f;
          } else {
            await supabase.from('users').update({ balance: user.balance - amount }).eq('id', uid);
            result = `❌ You lose. Lost **${amount}** credits.`;
            color = 0xe74c3c;
          }

          const finalEmbed = new EmbedBuilder()
            .setTitle('🃏 Blackjack - Result')
            .addFields(
              { name: 'Your Hand', value: `${renderHand(playerHand)} (Value: ${playerVal})` },
              { name: 'Dealer Hand', value: `${renderHand(dealerHand)} (Value: ${dealerVal})` }
            )
            .setDescription(result)
            .setColor(color);

          await msg.edit({ embeds: [finalEmbed], components: [] });
        });
        return;
      }

      // --- TOWER ---
      if (game === 'tower') {
        let multiplier = 1;
        let balance = user.balance;
        let playing = true;

        const embed = new EmbedBuilder()
          .setTitle('🗼 Tower Game')
          .setDescription(`Bet: **${amount}** credits\nMultiplier: **x${multiplier}**`)
          .setColor(0x9b59b6);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('raise').setLabel('Raise Tower').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('cashout').setLabel('Cash Out').setStyle(ButtonStyle.Success)
        );

        await interaction.reply({ embeds: [embed], components: [row] });
        const msg = await interaction.fetchReply();
        const collector = msg.createMessageComponentCollector({ time: 30000 });

        collector.on('collect', async btn => {
          if (btn.user.id !== uid) return btn.reply({ content: 'Not your game!', ephemeral: true });

          if (btn.customId === 'raise') {
            if (Math.random() < 0.3) {
              await supabase.from('users').update({ balance: balance - amount }).eq('id', uid);
              const failEmbed = EmbedBuilder.from(embed)
                .setDescription(`❌ The tower collapsed! You lost **${amount}** credits.`)
                .setColor(0xe74c3c);
              collector.stop();
              return btn.update({ embeds: [failEmbed], components: [] });
            } else {
              multiplier += 0.5;
              const updated = EmbedBuilder.from(embed)
                .setDescription(`Bet: **${amount}** credits\nMultiplier: **x${multiplier}**\n\nKeep raising or cash out?`);
              return btn.update({ embeds: [updated], components: [row] });
            }
          }

          if (btn.customId === 'cashout') {
            const winnings = Math.floor(amount * multiplier);
            await supabase.from('users').update({ balance: balance + winnings }).eq('id', uid);
            const winEmbed = EmbedBuilder.from(embed)
              .setDescription(`✅ You cashed out with multiplier **x${multiplier}**!\nWinnings: **${winnings}** credits.`)
              .setColor(0x2ecc71);
            collector.stop();
            return btn.update({ embeds: [winEmbed], components: [] });
          }
        });
        return;
      }
    }

    if (sub === 'stock') {
      const action = interaction.options.getString('action');
      const amount = interaction.options.getInteger('amount') || 1;
      const price = helpers.randomBetween(10, 200);
      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();

      if (action === 'buy') {
        const cost = price * amount;
        if (cost > (user.balance || 0)) return interaction.reply({ content: 'Not enough money', ephemeral: true });
        await supabase.from('users').update({ balance: user.balance - cost }).eq('id', uid);
        return interaction.reply(`📈 Bought ${amount} stock(s) at ${price} each for ${cost}.`);
      } else {
        const gain = price * amount;
        await supabase.from('users').update({ balance: (user.balance || 0) + gain }).eq('id', uid);
        return interaction.reply(`📉 Sold ${amount} stock(s) for ${gain} credits (price ${price}).`);
      }
    }

    if (sub === 'auction') {
      const starting = interaction.options.getInteger('starting');
      const { data } = await supabase.from('shop_items').insert({ name: `Auction by ${uid}`, price: starting }).select().single();
      return interaction.reply(`📦 Created auction item with starting price ${starting}. Item id ${data.id}`);
    }

    if (sub === 'lottery') {
      const tickets = interaction.options.getInteger('tickets');
      const costPer = 10;
      const total = tickets * costPer;
      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();
      if (total > (user.balance || 0)) return interaction.reply({ content: 'Not enough funds for tickets', ephemeral: true });
      await supabase.from('users').update({ balance: user.balance - total }).eq('id', uid);
      return interaction.reply(`🎟️ Bought ${tickets} tickets for ${total} credits.`);
    }
  }
};

// --- helper additions ---
helpers.shuffleDeck = () => {
  const suits = ['♠', '♥', '♦', '♣'];
  const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const cards = [];
  for (const s of suits) {
    for (const v of values) {
      cards.push({ value: v, suit: s, emoji: `${v}${s}` });
    }
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
};
