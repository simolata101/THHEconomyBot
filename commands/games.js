const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('world')
    .setDescription('Quests, shop, guilds, crafting, collectibles')
    .addSubcommand(s => s.setName('quests').setDescription('List active quests'))
    .addSubcommand(s => s.setName('complete')
      .setDescription('Complete a quest by id')
      .addIntegerOption(o => o.setName('id').setRequired(true)))
    .addSubcommand(s => s.setName('shop').setDescription('View shop'))
    .addSubcommand(s => s.setName('buy')
      .setDescription('Buy item by id')
      .addIntegerOption(o => o.setName('id').setRequired(true)))
    .addSubcommand(s => s.setName('trade')
      .setDescription('Propose a trade to user')
      .addUserOption(o => o.setName('target').setRequired(true))
      .addStringOption(o => o.setName('offer').setRequired(true))
      .addStringOption(o => o.setName('request').setRequired(true)))
    .addSubcommand(s => s.setName('craft')
      .setDescription('Craft item')
      .addStringOption(o => o.setName('recipe').setRequired(true)))
    .addSubcommand(s => s.setName('collectible')
      .setDescription('Mint a collectible')
      .addStringOption(o => o.setName('name').setRequired(true)))
    .addSubcommand(s => s.setName('leaderboard').setDescription('Show leaderboard')),

  async execute(interaction, { supabase, client }) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'quests') {
      await interaction.reply('Here are the active quests...');
    } else if (sub === 'complete') {
      const id = interaction.options.getInteger('id');
      await interaction.reply(`Completed quest with id: ${id}`);
    } else if (sub === 'shop') {
      await interaction.reply('Here is the shop...');
    } else if (sub === 'buy') {
      const id = interaction.options.getInteger('id');
      await interaction.reply(`Bought item with id: ${id}`);
    } else if (sub === 'trade') {
      const target = interaction.options.getUser('target');
      const offer = interaction.options.getString('offer');
      const request = interaction.options.getString('request');
      await interaction.reply(`Trade proposed: you offer ${offer} for ${request} to ${target.username}`);
    } else if (sub === 'craft') {
      const recipe = interaction.options.getString('recipe');
      await interaction.reply(`Crafting ${recipe}...`);
    } else if (sub === 'collectible') {
      const name = interaction.options.getString('name');
      await interaction.reply(`Minted collectible: ${name}`);
    } else if (sub === 'leaderboard') {
      await interaction.reply('Here is the leaderboard...');
    }
  }
};
