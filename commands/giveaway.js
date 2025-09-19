const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const ms = require("ms"); // npm install ms

// In-memory storage for active giveaways (with DB id)
const giveaways = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Giveaway system")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    // start subcommand
    .addSubcommand(sub =>
      sub
        .setName("start")
        .setDescription("Start a giveaway")
        .addIntegerOption(opt =>
          opt.setName("winners").setDescription("Number of winners").setRequired(true))
        .addStringOption(opt =>
          opt.setName("prize").setDescription("Prize description").setRequired(true))
        .addChannelOption(opt =>
          opt.setName("channel").setDescription("Channel to post giveaway").setRequired(true))
        .addStringOption(opt =>
          opt.setName("duration").setDescription("Duration (e.g. 1h, 30m, 2d, 1w)").setRequired(true))
        .addRoleOption(opt =>
          opt.setName("role_required").setDescription("Role required to enter").setRequired(false))
        .addIntegerOption(opt =>
          opt.setName("messages_required").setDescription("Messages required to qualify").setRequired(false))
        .addIntegerOption(opt =>
          opt.setName("booster_entries").setDescription("Extra entries for server boosters").setRequired(false))
        .addIntegerOption(opt =>
          opt.setName("invites_required").setDescription("Invites required to qualify").setRequired(false))
    )
    // end subcommand
    .addSubcommand(sub =>
      sub
        .setName("end")
        .setDescription("Force end a giveaway early (or reroll)")
        .addStringOption(opt =>
          opt.setName("message_id").setDescription("The giveaway message ID").setRequired(true))
    ),

  async execute(interaction, { client, supabase }) {
    if (interaction.options.getSubcommand() === "start") {
      await this.startGiveaway(interaction, client, supabase);
    } else if (interaction.options.getSubcommand() === "end") {
      await this.forceEndGiveaway(interaction, client, supabase);
    }
  },

  async startGiveaway(interaction, client, supabase) {
    const winners = interaction.options.getInteger("winners");
    const prize = interaction.options.getString("prize");
    const channel = interaction.options.getChannel("channel");
    const durationStr = interaction.options.getString("duration");
    const roleRequired = interaction.options.getRole("role_required");
    const messagesRequired = interaction.options.getInteger("messages_required") || null;
    const boosterEntries = interaction.options.getInteger("booster_entries") || 1;
    const invitesRequired = interaction.options.getInteger("invites_required") || null;

    // Parse duration
    const durationMs = ms(durationStr);
    if (!durationMs) {
      return interaction.reply({
        content: "❌ Invalid duration format. Use like `1h`, `30m`, `2d`, `1w`.",
        ephemeral: true
      });
    }

    const endsAt = new Date(Date.now() + durationMs).toISOString();

    // Giveaway embed
    const embed = new EmbedBuilder()
      .setTitle("🎉 Giveaway!")
      .setDescription(
        `**Prize:** ${prize}\n**Winners:** ${winners}\n**Ends in:** ${durationStr}`
      )
      .setColor("Random")
      .setTimestamp(Date.now() + durationMs)
      .setFooter({ text: `Giveaway started by ${interaction.user.tag}` });

    if (roleRequired) embed.addFields({ name: "Requirement", value: `Must have role: ${roleRequired}`, inline: true });
    if (messagesRequired) embed.addFields({ name: "Messages Required", value: `${messagesRequired}`, inline: true });
    if (invitesRequired) embed.addFields({ name: "Invites Required", value: `${invitesRequired}`, inline: true });
    if (boosterEntries > 1) embed.addFields({ name: "Booster Bonus", value: `+${boosterEntries - 1} entries`, inline: true });

    // Send message
    const msg = await channel.send({ embeds: [embed] });
    await msg.react("🎉");

    // Insert giveaway in Supabase
    const { data, error } = await supabase
      .from("giveaways")
      .insert({
        prize,
        winners,
        channel_id: channel.id,
        message_id: msg.id,
        role_required: roleRequired?.id || null,
        messages_required: messagesRequired,
        invites_required: invitesRequired,
        booster_entries: boosterEntries,
        ends_at: endsAt,
        ended: false
      })
      .select()
      .single();

    if (error) {
      console.error("❌ Failed to insert giveaway:", error);
      return interaction.reply({
        content: "❌ Failed to create giveaway in database.",
        ephemeral: true
      });
    }

    await interaction.reply({
      content: `✅ Giveaway started in ${channel}!`,
      ephemeral: true
    });

    // Cache giveaway
    giveaways.set(msg.id, {
      dbId: data.id, // UUID from DB
      messageId: msg.id,
      channelId: channel.id,
      prize,
      winners,
      endAt: Date.now() + durationMs,
      roleRequired,
      messagesRequired,
      invitesRequired,
      boosterEntries
    });

    // End logic
    setTimeout(async () => {
      await this.finishGiveaway(msg.id, client, supabase);
    }, durationMs);
  },

  async forceEndGiveaway(interaction, client, supabase) {
    const messageId = interaction.options.getString("message_id");

    let giveaway = giveaways.get(messageId);

    // ✅ If not in cache, fetch from database
    if (!giveaway) {
      const { data, error } = await supabase
        .from("giveaways")
        .select("*")
        .eq("message_id", messageId)
        .maybeSingle();

      if (error || !data) {
        return interaction.reply({
          content: "❌ Giveaway not found in database or invalid message ID.",
          ephemeral: true,
        });
      }

      // Rebuild giveaway object from DB
      giveaway = {
        dbId: data.id,
        messageId: data.message_id,
        channelId: data.channel_id,
        prize: data.prize,
        winners: data.winners,
        endAt: new Date(data.ends_at).getTime(),
        roleRequired: data.role_required ? { id: data.role_required } : null,
        messagesRequired: data.messages_required,
        invitesRequired: data.invites_required,
        boosterEntries: data.booster_entries || 1,
      };
    }

    await this.finishGiveaway(messageId, client, supabase, interaction, giveaway);
  },

  async finishGiveaway(messageId, client, supabase, interaction = null, forcedGiveaway = null) {
    const giveaway = forcedGiveaway || giveaways.get(messageId);
    if (!giveaway) return;

    const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
    if (!channel) return;

    const fetchedMsg = await channel.messages.fetch(giveaway.messageId).catch(() => null);
    if (!fetchedMsg) return;

    const reaction = fetchedMsg.reactions.cache.get("🎉");
    if (!reaction) return;

    const users = await reaction.users.fetch();
    let entrants = [];

    for (const [uid, user] of users) {
      if (user.bot) continue;

      const member = await channel.guild.members.fetch(uid).catch(() => null);
      if (!member) continue;

      // Role check
      if (giveaway.roleRequired && !member.roles.cache.has(giveaway.roleRequired.id)) continue;

      // Progress check
      const { data: progress } = await supabase
        .from("giveaway_progress")
        .select("messages_count, invites_count")
        .eq("giveaway_id", giveaway.dbId)
        .eq("user_id", uid)
        .maybeSingle();

      if (giveaway.messagesRequired && (!progress || progress.messages_count < giveaway.messagesRequired)) continue;
      if (giveaway.invitesRequired && (!progress || progress.invites_count < giveaway.invitesRequired)) continue;

      // Booster entries
      let entries = 1;
      if (member.premiumSince && giveaway.boosterEntries > 1) {
        entries += (giveaway.boosterEntries - 1);
      }

      entrants.push(...Array(entries).fill(uid));
    }

    if (entrants.length === 0) {
      await channel.send(`❌ No valid entrants for giveaway **${giveaway.prize}**`);
      giveaways.delete(messageId);
      await supabase.from("giveaways").update({ ended: true }).eq("id", giveaway.dbId);
      if (interaction) {
        await interaction.reply({ content: "✅ Giveaway force-ended (no winners).", ephemeral: true });
      }
      return;
    }

    // Pick winners
    const winnersPicked = [];
    for (let i = 0; i < giveaway.winners && entrants.length > 0; i++) {
      const winnerId = entrants.splice(Math.floor(Math.random() * entrants.length), 1)[0];
      if (!winnersPicked.includes(winnerId)) winnersPicked.push(winnerId);
    }

    await channel.send(
      `🎉 Congratulations ${winnersPicked.map(id => `<@${id}>`).join(", ")}! You won **${giveaway.prize}**!`
    );

    giveaways.delete(messageId);
    await supabase.from("giveaways").update({ ended: true }).eq("id", giveaway.dbId);

    if (interaction) {
      await interaction.reply({ content: "✅ Giveaway force-ended and winners picked.", ephemeral: true });
    }
  }
};
