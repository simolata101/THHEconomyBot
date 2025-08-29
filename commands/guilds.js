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
          .setDescription('The name of the guild to create')
          .setRequired(true)
       )
    )
    .addSubcommand(s =>
      s.setName('join')
       .setDescription('Join a guild')
       .addIntegerOption(o =>
         o.setName('id')
          .setDescription('The ID of the guild to join')
          .setRequired(true)
       )
    )
    .addSubcommand(s =>
      s.setName('leave')
       .setDescription('Leave your current guild')
    )
    .addSubcommand(s =>
      s.setName('list')
       .setDescription('List all existing guilds')
    )
    .addSubcommand(s =>
      s.setName('info')
       .setDescription('Get info about a guild')
       .addIntegerOption(o =>
         o.setName('id')
          .setDescription('The ID of the guild')
          .setRequired(true)
       )
    )
    .addSubcommand(s =>
      s.setName('delete')
       .setDescription('Delete your guild (owner only)')
       .addIntegerOption(o =>
         o.setName('id')
          .setDescription('The ID of the guild to delete')
          .setRequired(true)
       )
    ),

  execute: async(interaction, { supabase }) => {
    const sub = interaction.options.getSubcommand();
    const uid = interaction.user.id;

    if (sub === 'create') {
      const name = interaction.options.getString('name');
      const { data, error } = await supabase
        .from('guilds')
        .insert({ name, owner: uid })
        .select()
        .single();

      if (error) return interaction.reply(`❌ Error creating guild: ${error.message}`);
      return interaction.reply(`✅ Created guild ${name} (ID: ${data.id}).`);
    }

    if (sub === 'join') {
      const id = interaction.options.getInteger('id');
      // Check if guild exists
      const { data: guild, error: guildError } = await supabase
        .from('guilds')
        .select('*')
        .eq('id', id)
        .single();

      if (guildError || !guild) return interaction.reply(`❌ Guild ID ${id} not found.`);

      // Check if already in a guild
      const { data: existing } = await supabase
        .from('guild_members')
        .select('*')
        .eq('user_id', uid)
        .single();

      if (existing) {
        return interaction.reply(`❌ You're already in a guild (ID: ${existing.guild_id}). Leave it first.`);
      }

      await supabase.from('guild_members').insert({ user_id: uid, guild_id: id });
      return interaction.reply(`✅ Joined guild: ${guild.name}`);
    }

    if (sub === 'leave') {
      const { data: membership } = await supabase
        .from('guild_members')
        .select('*')
        .eq('user_id', uid)
        .single();

      if (!membership) return interaction.reply('❌ You are not in any guild.');

      await supabase
        .from('guild_members')
        .delete()
        .eq('user_id', uid);

      return interaction.reply('✅ You left your guild.');
    }

    if (sub === 'list') {
      const { data: guilds } = await supabase.from('guilds').select('*').limit(20);
      if (!guilds || guilds.length === 0) return interaction.reply('No guilds yet.');
      return interaction.reply(guilds.map(g => `ID:${g.id} - ${g.name} (owner: <@${g.owner}>)`).join('\n'));
    }

    if (sub === 'info') {
      const id = interaction.options.getInteger('id');
      const { data: guild } = await supabase.from('guilds').select('*').eq('id', id).single();
      if (!guild) return interaction.reply(`❌ Guild ID ${id} not found.`);

      const { data: members } = await supabase
        .from('guild_members')
        .select('user_id')
        .eq('guild_id', id);

      const memberList = members.length ? members.map(m => `<@${m.user_id}>`).join(', ') : 'No members yet';
      return interaction.reply(`**Guild:** ${guild.name}\n**Owner:** <@${guild.owner}>\n**Members:** ${memberList}`);
    }

    if (sub === 'delete') {
      const id = interaction.options.getInteger('id');
      const { data: guild } = await supabase.from('guilds').select('*').eq('id', id).single();
      if (!guild) return interaction.reply(`❌ Guild ID ${id} not found.`);
      if (guild.owner !== uid) return interaction.reply('❌ Only the owner can delete this guild.');

      await supabase.from('guild_members').delete().eq('guild_id', id);
      await supabase.from('guilds').delete().eq('id', id);
      return interaction.reply(`✅ Guild ${guild.name} deleted.`);
    }
  }
};
