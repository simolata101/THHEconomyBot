
const { SlashCommandBuilder } = require('discord.js');
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
   .setDescription('Gamble some credits')
   .addIntegerOption(o => 
     o.setName('amount')
      .setDescription('The amount of credits to gamble') // ✅ fixed
      .setRequired(true)
   )
)
.addSubcommand(s => 
  s.setName('stock')
   .setDescription('Simulated stock buy/sell')
   .addStringOption(o => 
     o.setName('action')
      .setDescription('Choose whether to buy or sell') // ✅ fixed
      .setRequired(true)
      .addChoices(
        { name:'buy', value:'buy' },
        { name:'sell', value:'sell' }
      )
   )
   .addIntegerOption(o => 
     o.setName('amount')
      .setDescription('The amount of stock to trade') // ✅ fixed
   )
)
.addSubcommand(s => 
  s.setName('auction')
   .setDescription('Create an auction (simple)')
   .addIntegerOption(o => 
     o.setName('starting')
      .setDescription('Starting price of the auction') // ✅ fixed
      .setRequired(true)
   )
)
.addSubcommand(s => 
  s.setName('lottery')
   .setDescription('Buy lottery ticket')
   .addIntegerOption(o => 
     o.setName('tickets')
      .setDescription('Number of tickets to buy') // ✅ fixed
      .setRequired(true)
   )
)


  async execute(interaction, { supabase }) => {
    const sub = interaction.options.getSubcommand();
    const uid = interaction.user.id;
    await helpers.ensureUser(supabase, uid);

    if (sub === 'minigame') {
      const roll = helpers.randomBetween(1, 6);
      const win = roll >= 5;
      const reward = win ? 50 : 0;
      if (win) await supabase.from('users').update({ balance: supabase.raw('balance + ?', [reward]) }).eq('id', uid).catch(()=>{});
      await interaction.reply(`You rolled a **${roll}**. ${win ? `You win ${reward} credits!` : 'No reward this time.'}`);
      return;
    }

    if (sub === 'gamble') {
      const amount = interaction.options.getInteger('amount');
      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();
      if (amount <= 0 || amount > (user.balance || 0)) return interaction.reply({ content: 'Invalid amount', ephemeral: true });
      const chance = Math.random();
      if (chance < 0.45) {
        // lose
        await supabase.from('users').update({ balance: user.balance - amount }).eq('id', uid);
        return interaction.reply(`You lost **${amount}** credits.`);
      } else {
        const win = Math.floor(amount * (1 + Math.random() * 1.5));
        await supabase.from('users').update({ balance: user.balance - amount + win }).eq('id', uid);
        return interaction.reply(`You won **${win}** credits! (staked ${amount})`);
      }
    }

    if (sub === 'stock') {
      const action = interaction.options.getString('action');
      const amount = interaction.options.getInteger('amount') || 1;
      // very simple: stock price random between 10-200
      const price = helpers.randomBetween(10, 200);
      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();
      if (action === 'buy') {
        const cost = price * amount;
        if (cost > (user.balance || 0)) return interaction.reply({ content: 'Not enough money', ephemeral: true });
        // store as inventory item named STOCK
        const itemRes = await supabase.from('shop_items').select('*').ilike('name', 'stock_%').limit(1).single().catch(()=>null);
        await supabase.from('inventory').insert({ user_id: uid, item_id: null, quantity: amount, added_at: new Date().toISOString() }).catch(()=>{});
        await supabase.from('users').update({ balance: user.balance - cost }).eq('id', uid);
        return interaction.reply(`Bought ${amount} stock(s) at ${price} each for ${cost}.`);
      } else {
        // sell: naive—just give price*amount
        const gain = price * amount;
        await supabase.from('users').update({ balance: (user.balance || 0) + gain }).eq('id', uid);
        return interaction.reply(`Sold ${amount} stocks for ${gain} credits (price ${price}).`);
      }
    }

    if (sub === 'auction') {
      const starting = interaction.options.getInteger('starting');
      // Basic: create a shop item
      const { data } = await supabase.from('shop_items').insert({ name: `Auction by ${uid}`, price: starting }).select().single();
      return interaction.reply(`Created auction item with starting price ${starting}. Item id ${data.id}`);
    }

    if (sub === 'lottery') {
      const tickets = interaction.options.getInteger('tickets');
      const costPer = 10;
      const total = tickets * costPer;
      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();
      if (total > (user.balance || 0)) return interaction.reply({ content: 'Not enough funds for tickets', ephemeral: true });
      // naive: store tickets as inventory
      await supabase.from('users').update({ balance: user.balance - total }).eq('id', uid);
      await interaction.reply(`Bought ${tickets} tickets for ${total} credits.`);
    }
  }

};
