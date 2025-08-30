const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

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

  execute: async (interaction, { supabase }) => {
    const sub = interaction.options.getSubcommand();
    const uid = interaction.user.id;

    // Helper embed builder
    const makeEmbed = (title, description, color = 0x2f3136) =>
      new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);

    if (sub === 'create') {
      const name = interaction.options.getString('name');
      const { data, error } = await supabase
        .from('guilds')
        .insert({ name, owner: uid })
        .select()
        .single();

      if (error)
        return interaction.reply({
          embeds: [makeEmbed('❌ Error Creating Guild', error.message, 0xff0000)],
          ephemeral: true
        });

      return interaction.reply({
        embeds: [makeEmbed('✅ Guild Created', `Created guild **${name}** (ID: \`${data.id}\`).`, 0x00ff00)]
      });
    }

    if (sub === 'join') {
      const id = interaction.options.getInteger('id');
      const { data: guild, error: guildError } = await supabase
        .from('guilds')
        .select('*')
        .eq('id', id)
        .single();

      if (guildError || !guild)
        return interaction.reply({
          embeds: [makeEmbed('❌ Guild Not Found', `Guild ID \`${id}\` not found.`, 0xff0000)],
          ephemeral: true
        });

      const { data: existing } = await supabase
        .from('guild_members')
        .select('*')
        .eq('user_id', uid)
        .single();

      if (existing) {
        return interaction.reply({
          embeds: [makeEmbed('❌ Already in Guild', `You're already in a guild (ID: \`${existing.guild_id}\`). Leave it first.`, 0xffa500)],
          ephemeral: true
        });
      }

      await supabase.from('guild_members').insert({ user_id: uid, guild_id: id });
      return interaction.reply({
        embeds: [makeEmbed('✅ Joined Guild', `You joined guild **${guild.name}**.`, 0x00ff00)]
      });
    }

    if (sub === 'leave') {
      const { data: membership } = await supabase
        .from('guild_members')
        .select('*')
        .eq('user_id', uid)
        .single();

      if (!membership)
        return interaction.reply({
          embeds: [makeEmbed('❌ Not in a Guild', 'You are not in any guild.', 0xff0000)],
          ephemeral: true
        });

      await supabase.from('guild_members').delete().eq('user_id', uid);

      return interaction.reply({
        embeds: [makeEmbed('✅ Left Guild', 'You have left your guild.', 0x00ff00)]
      });
    }

    if (sub === 'list') {
      const { data: guilds } = await supabase.from('guilds').select('*').limit(20);
      if (!guilds || guilds.length === 0)
        return interaction.reply({
          embeds: [makeEmbed('📜 Guilds', 'No guilds yet.', 0x999999)]
        });

      const description = guilds
        .map(g => `**ID:** \`${g.id}\` - **${g.name}** (Owner: <@${g.owner}>)`)
        .join('\n');

      return interaction.reply({
        embeds: [makeEmbed('📜 Guild List', description, 0x0099ff)]
      });
    }

    if (sub === 'info') {
      const id = interaction.options.getInteger('id');
      const { data: guild } = await supabase.from('guilds').select('*').eq('id', id).single();

      if (!guild)
        return interaction.reply({
          embeds: [makeEmbed('❌ Guild Not Found', `Guild ID \`${id}\` not found.`, 0xff0000)],
          ephemeral: true
        });

      const { data: members } = await supabase
        .from('guild_members')
        .select('user_id')
        .eq('guild_id', id);

      const memberList = members.length
        ? members.map(m => `<@${m.user_id}>`).join(', ')
        : 'No members yet';

      return interaction.reply({
        embeds: [makeEmbed(`ℹ️ Guild Info: ${guild.name}`,
          `**Owner:** <@${guild.owner}>\n**Members:** ${memberList}`, 0x00ccff)]
      });
    }

    if (sub === 'delete') {
      const id = interaction.options.getInteger('id');
      const { data: guild } = await supabase.from('guilds').select('*').eq('id', id).single();

      if (!guild)
        return interaction.reply({
          embeds: [makeEmbed('❌ Guild Not Found', `Guild ID \`${id}\` not found.`, 0xff0000)],
          ephemeral: true
        });

      if (guild.owner !== uid)
        return interaction.reply({
          embeds: [makeEmbed('❌ Not Owner', 'Only the guild owner can delete this guild.', 0xff0000)],
          ephemeral: true
        });

      await supabase.from('guild_members').delete().eq('guild_id', id);
      await supabase.from('guilds').delete().eq('id', id);

      return interaction.reply({
        embeds: [makeEmbed('✅ Guild Deleted', `Guild **${guild.name}** has been deleted.`, 0xff5555)]
      });
    }
  }
};
