
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
		.setName('guild')
		.setDescription('Guild/clan commands')
		.addSubcommand(s => 
		  s.setName('create')
		   .setDescription('Create a guild')
		   .addStringOption(o => 
			 o.setName('name')
			  .setDescription('The name of the guild to create') // ✅ fixed
			  .setRequired(true)
		   )
		)
		.addSubcommand(s => 
		  s.setName('join')
		   .setDescription('Join a guild')
		   .addIntegerOption(o => 
			 o.setName('id')
			  .setDescription('The ID of the guild to join') // ✅ fixed
			  .setRequired(true)
		   )
		)
		.addSubcommand(s => 
		  s.setName('list')
		   .setDescription('List all existing guilds')
		),


  execute: async(interaction, { supabase }) => {
    const sub = interaction.options.getSubcommand();
    const uid = interaction.user.id;
    if (sub === 'create') {
      const name = interaction.options.getString('name');
      const { data } = await supabase.from('guilds').insert({ name, owner: uid }).select().single();
      return interaction.reply(`Created guild ${name} (id ${data.id}).`);
    }
    if (sub === 'join') {
      const id = interaction.options.getInteger('id');
      // simplistic: no membership table; you can extend this
      return interaction.reply('Join functionality not implemented fully in this template.');
    }
    if (sub === 'list') {
      const { data } = await supabase.from('guilds').select('*').limit(20);
      if (!data || data.length === 0) return interaction.reply('No guilds yet.');
      return interaction.reply(data.map(g=>`ID:${g.id} - ${g.name} (owner: <@${g.owner}>)`).join('\n'));
    }
  }

};
