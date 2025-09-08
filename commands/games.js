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
        .setDescription('Play a gamble game (coinflip, rps, tower)')
        .addStringOption(o =>
          o.setName('game')
            .setDescription('Choose a gambling game')
            .setRequired(true)
            .addChoices(
              { name: 'coinflip', value: 'coinflip' },
              { name: 'rock-paper-scissors', value: 'rps' },
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

    // 🎲 DICE MINIGAME
    if (sub === 'minigame') {
      const roll = helpers.randomBetween(1, 6);
      const win = roll >= 5;
      const reward = win ? 50 : 0;
      if (win) {
        await supabase
          .from('users')
          .update({ balance: supabase.raw('balance + ?', [reward]) })
          .eq('id', uid);
      }
      return interaction.reply(`🎲 You rolled a **${roll}**. ${win ? `You win ${reward} credits!` : 'No reward this time.'}`);
    }

    if (sub === 'gamble') {
      const game = interaction.options.getString('game');
      const amount = interaction.options.getInteger('amount');
      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();

      if (!user || amount <= 0 || amount > (user.balance || 0)) {
        return interaction.reply({ content: '❌ Invalid amount', ephemeral: true });
      }

      // calculate dynamic win chance
      const totalWealth = (user.balance || 0) + (user.bank_balance || 0);
      let ratio = totalWealth > 0 ? (amount / totalWealth) : 1;
      let winChance = 1 - (0.6 * ratio); // higher bet ratio = lower win chance
      if (winChance < 0.4) winChance = 0.4; // enforce minimum 40%

      // 🪙 COINFLIP (guess Heads/Tails)
      if (game === 'coinflip') {
        const guessRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('guess_heads').setLabel('🪙 Heads').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('guess_tails').setLabel('🪙 Tails').setStyle(ButtonStyle.Secondary)
        );

        const embed = new EmbedBuilder()
          .setTitle('🪙 Coin Flip')
          .setDescription(`Bet: **${amount}** credits\nGuess if it will be **Heads** or **Tails**.`)
          .setColor(0xf1c40f);

        const msg = await interaction.reply({ embeds: [embed], components: [guessRow], fetchReply: true });

        const collector = msg.createMessageComponentCollector({ time: 15000, max: 1 });
        collector.on('collect', async btn => {
          if (btn.user.id !== uid) return btn.reply({ content: 'Not your game!', ephemeral: true });

          const guess = btn.customId.includes('heads') ? 'Heads' : 'Tails';
          let flip;
          if (Math.random() < winChance) {
            flip = guess; // force win
          } else {
            flip = guess === 'Heads' ? 'Tails' : 'Heads'; // force lose
          }

          let resultText, color;
          if (guess === flip) {
            await supabase.from('users').update({ balance: user.balance + amount }).eq('id', uid);
            resultText = `✅ You guessed **${guess}** and the coin landed on **${flip}**!\nYou win **${amount}** credits.`;
            color = 0x2ecc71;
          } else {
            await supabase.from('users').update({ balance: user.balance - amount }).eq('id', uid);
            resultText = `❌ You guessed **${guess}**, but it landed on **${flip}**.\nYou lose **${amount}** credits.`;
            color = 0xe74c3c;
          }

          const resultEmbed = EmbedBuilder.from(embed).setDescription(resultText).setColor(color);
          await btn.update({ embeds: [resultEmbed], components: [] });
        });

        collector.on('end', async (collected) => {
          if (collected.size === 0) {
            try { await msg.edit({ components: [] }); } catch {}
          }
        });

        return;
      }

      // ✊✋✌️ ROCK-PAPER-SCISSORS
      if (game === 'rps') {
        const choices = ['rock', 'paper', 'scissors'];
        const emojis = { rock: '✊', paper: '✋', scissors: '✌️' };

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('rock').setLabel('Rock ✊').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('paper').setLabel('Paper ✋').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('scissors').setLabel('Scissors ✌️').setStyle(ButtonStyle.Primary)
        );

        const embed = new EmbedBuilder()
          .setTitle('🎮 Rock-Paper-Scissors')
          .setDescription(`Bet: **${amount}** credits\nPick your move:`)
          .setColor(0x3498db);

        const msg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });
        const collector = msg.createMessageComponentCollector({ time: 15000, max: 1 });

        collector.on('collect', async btn => {
          if (btn.user.id !== uid) return btn.reply({ content: 'Not your game!', ephemeral: true });

          const playerChoice = btn.customId;
          let botChoice;

          if (Math.random() < winChance) {
            // bot plays to lose
            if (playerChoice === 'rock') botChoice = 'scissors';
            if (playerChoice === 'paper') botChoice = 'rock';
            if (playerChoice === 'scissors') botChoice = 'paper';
          } else {
            // bot plays to win
            if (playerChoice === 'rock') botChoice = 'paper';
            if (playerChoice === 'paper') botChoice = 'scissors';
            if (playerChoice === 'scissors') botChoice = 'rock';
          }

          let result, color;
          if (playerChoice === botChoice) {
            result = `🤝 It's a tie! Your bet is returned.\nYou picked ${emojis[playerChoice]} • Bot picked ${emojis[botChoice]}`;
            color = 0xf1c40f;
          } else if (
            (playerChoice === 'rock' && botChoice === 'scissors') ||
            (playerChoice === 'paper' && botChoice === 'rock') ||
            (playerChoice === 'scissors' && botChoice === 'paper')
          ) {
            await supabase.from('users').update({ balance: user.balance + amount }).eq('id', uid);
            result = `✅ You win! You picked ${emojis[playerChoice]} • Bot picked ${emojis[botChoice]}\nGained **${amount}** credits.`;
            color = 0x2ecc71;
          } else {
            await supabase.from('users').update({ balance: user.balance - amount }).eq('id', uid);
            result = `❌ You lose! You picked ${emojis[playerChoice]} • Bot picked ${emojis[botChoice]}\nLost **${amount}** credits.`;
            color = 0xe74c3c;
          }

          const resultEmbed = new EmbedBuilder()
            .setTitle('🎮 Rock-Paper-Scissors - Result')
            .setDescription(result)
            .setColor(color);

          await btn.update({ embeds: [resultEmbed], components: [] });
        });

        collector.on('end', async (collected) => {
          if (collected.size === 0) {
            try { await msg.edit({ components: [] }); } catch {}
          }
        });

        return;
      }

      // 🗼 TOWER
      if (game === 'tower') {
          let multiplier = 1;
          const startingBalance = user.balance;
        
          // base winChance depending on bet size vs total funds
          const totalFunds = (user.balance || 0) + (user.bank_balance || 0);
          let baseChance = 1 - (0.6 * (amount / totalFunds));
          if (baseChance < 0.4) baseChance = 0.4; // floor at 40%
        
          const baseEmbed = () =>
            new EmbedBuilder()
              .setTitle('🗼 Tower Game')
              .setDescription(`Bet: **${amount}** credits\nMultiplier: **x${multiplier.toFixed(1)}**`)
              .setColor(0x9b59b6);
        
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('raise').setLabel('Raise Tower').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('cashout').setLabel('Cash Out').setStyle(ButtonStyle.Success)
          );
        
          const msg = await interaction.reply({ embeds: [baseEmbed()], components: [row], fetchReply: true });
          const collector = msg.createMessageComponentCollector({ time: 30000 });
        
          collector.on('collect', async btn => {
            if (btn.user.id !== uid) return btn.reply({ content: 'Not your game!', ephemeral: true });
        
            if (btn.customId === 'raise') {
              // make it harder: chance decreases slightly with each multiplier step
              let effectiveChance = baseChance - (0.05 * (multiplier - 1)); 
              if (effectiveChance < 0.4) effectiveChance = 0.4; // never drop below 40%
        
              if (Math.random() > effectiveChance) {
                await supabase.from('users').update({ balance: startingBalance - amount }).eq('id', uid);
                const failEmbed = new EmbedBuilder()
                  .setTitle('🗼 Tower Game - Collapsed')
                  .setDescription(`❌ The tower collapsed!\nYou lost **${amount}** credits.`)
                  .setColor(0xe74c3c);
                collector.stop();
                return btn.update({ embeds: [failEmbed], components: [] });
              }
        
              multiplier += 0.5;
              return btn.update({
                embeds: [baseEmbed().setDescription(
                  `Bet: **${amount}** credits\nMultiplier: **x${multiplier.toFixed(1)}**\n\nKeep raising or cash out?`
                )],
                components: [row]
              });
            }
        
            if (btn.customId === 'cashout') {
              const winnings = Math.floor(amount * multiplier);
              await supabase.from('users').update({ balance: startingBalance + winnings }).eq('id', uid);
              const winEmbed = new EmbedBuilder()
                .setTitle('🗼 Tower Game - Cashed Out')
                .setDescription(`✅ You cashed out at **x${multiplier.toFixed(1)}**!\nWinnings: **${winnings}** credits.`)
                .setColor(0x2ecc71);
              collector.stop();
              return btn.update({ embeds: [winEmbed], components: [] });
            }
          });
        
          collector.on('end', async (collected) => {
            if (collected.size === 0) {
              try { await msg.edit({ components: [] }); } catch {}
            }
          });
        
          return;
        }
    }

    // 📈 STOCK
    if (sub === 'stock') {
      const action = interaction.options.getString('action');
      const amount = interaction.options.getInteger('amount') || 1;
      const price = helpers.randomBetween(10, 200);
      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();

      if (action === 'buy') {
        const cost = price * amount;
        if (cost > (user.balance || 0)) {
          return interaction.reply({ content: 'Not enough money', ephemeral: true });
        }
        await supabase.from('users').update({ balance: user.balance - cost }).eq('id', uid);
        return interaction.reply(`📈 Bought ${amount} stock(s) at ${price} each for ${cost}.`);
      } else {
        const gain = price * amount;
        await supabase.from('users').update({ balance: (user.balance || 0) + gain }).eq('id', uid);
        return interaction.reply(`📉 Sold ${amount} stock(s) for ${gain} credits (price ${price}).`);
      }
    }

    // 📦 AUCTION
    if (sub === 'auction') {
      const starting = interaction.options.getInteger('starting');
      const { data } = await supabase
        .from('shop_items')
        .insert({ name: `Auction by ${uid}`, price: starting })
        .select()
        .single();
      return interaction.reply(`📦 Created auction item with starting price ${starting}. Item id ${data.id}`);
    }

    // 🎟️ LOTTERY
    if (sub === 'lottery') {
      const tickets = interaction.options.getInteger('tickets');
      const costPer = 10;
      const total = tickets * costPer;
      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();

      if (total > (user.balance || 0)) {
        return interaction.reply({ content: 'Not enough funds for tickets', ephemeral: true });
      }

      await supabase.from('users').update({ balance: user.balance - total }).eq('id', uid);
      return interaction.reply(`🎟️ Bought ${tickets} tickets for ${total} credits.`);
    }
  }
};


// NOTE: Removed helpers.shuffleDeck since Blackjack is gone.


