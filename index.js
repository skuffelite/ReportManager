import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { getEntry, setEntry, listKeys } from "./datastore.js";

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.REPORT_CHANNEL_ID;
const POLL_SECONDS = parseInt(process.env.POLL_SECONDS || "15", 10);

const REPORTS_DS = "BugReports_V1";
const INDEX_DS = "BugReportsIndex_V1";
const BANS_DS = "BugBans_V1";
const INDEX_KEY = "AllReports";

const STATUS_COLORS = {
  Pending: 0x969ca8,
  Accepted: 0x78dc8c,
  InProgress: 0xe6b45a,
  Fixed: 0x78c8ff,
  Rejected: 0xe66e6e,
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Build the embed for a report record
function reportEmbed(report) {
  const color = STATUS_COLORS[report.Status] || 0x969ca8;
  const stats = report.Stats || {};
  const e = new EmbedBuilder()
    .setTitle(report.Title || "Bug Report")
    .setColor(color)
    .addFields(
      {
        name: "Reported by",
        value: `[${report.DisplayName}](https://www.roblox.com/users/${report.UserId}/profile)\n@${report.Username}  •  ${report.UserId}\nAccount age: ${report.AccountAge} days`,
        inline: false,
      },
      { name: "Mode", value: String(report.Mode || "-"), inline: true },
      { name: "Type", value: String(report.Type || "-"), inline: true },
      { name: "Status", value: String(report.Status || "Pending"), inline: true },
      { name: "Description", value: String(report.Description || "-").slice(0, 1024), inline: false },
      { name: "Steps to reproduce", value: String(report.Steps || "-").slice(0, 1024), inline: false },
      {
        name: "Player stats",
        value: `Wins: ${stats.Wins || 0}\nDeaths: ${stats.Deaths || 0}\nKnobs: ${stats.Knobs || 0}\nRevives: ${stats.Revives || 0}\nTrollBoost: ${stats.TrollBoost || 0}`,
        inline: true,
      },
      {
        name: "Cosmetics",
        value: `Plush: ${stats.EquippedPlush || "None"}\nBadge: ${stats.EquippedBadge || "None"}\nOwned: ${stats.OwnedPlush || 0}\nHasPlush: ${stats.HasPlush ? "Yes" : "No"}`,
        inline: true,
      },
    )
    .setFooter({ text: `Report ID: ${report.Id}` })
    .setTimestamp(new Date((report.Time || 0) * 1000));
  if (report.StatusNote) {
    e.addFields({ name: "Moderator note", value: String(report.StatusNote).slice(0, 1024), inline: false });
  }
  return e;
}

function controlRows(reportId) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`status:Accepted:${reportId}`).setLabel("Accept").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`status:InProgress:${reportId}`).setLabel("In Progress").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`status:Fixed:${reportId}`).setLabel("Fixed").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`status:Rejected:${reportId}`).setLabel("Reject").setStyle(ButtonStyle.Danger),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ban:open:${reportId}`).setLabel("Ban author").setStyle(ButtonStyle.Danger),
  );
  return [row1, row2];
}

// Poll DataStore for new (unposted) reports and post them.
async function pollReports() {
  let index;
  try {
    index = await getEntry(INDEX_DS, INDEX_KEY);
  } catch (err) {
    console.error("[poll] index fetch failed:", err.message);
    return;
  }
  if (!Array.isArray(index)) return;

  const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
  if (!channel) {
    console.error("[poll] channel not found:", CHANNEL_ID);
    return;
  }

  for (const entry of index) {
    let report;
    try {
      report = await getEntry(REPORTS_DS, entry.id);
    } catch (err) {
      console.error("[poll] report fetch failed:", entry.id, err.message);
      continue;
    }
    if (!report) continue;
    if (report.Posted) continue;

    try {
      const msg = await channel.send({
        embeds: [reportEmbed(report)],
        components: controlRows(report.Id),
      });
      report.Posted = true;
      report.MessageId = msg.id;
      await setEntry(REPORTS_DS, report.Id, report);
      console.log("[poll] posted report", report.Id);
    } catch (err) {
      console.error("[poll] post failed:", report.Id, err.message);
    }
  }
}

async function updateReportMessage(report) {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (report.MessageId) {
      const msg = await channel.messages.fetch(report.MessageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [reportEmbed(report)], components: controlRows(report.Id) });
      }
    }
  } catch (err) {
    console.error("[update] message edit failed:", err.message);
  }
}

client.on("interactionCreate", async (interaction) => {
  try {
    // Status buttons
    if (interaction.isButton() && interaction.customId.startsWith("status:")) {
      const [, status, reportId] = interaction.customId.split(":");
      const report = await getEntry(REPORTS_DS, reportId);
      if (!report) {
        await interaction.reply({ content: "Report not found.", ephemeral: true });
        return;
      }
      report.Status = status;
      report.StatusNote = `Set by ${interaction.user.tag}`;
      await setEntry(REPORTS_DS, reportId, report);
      await updateReportMessage(report);
      await interaction.reply({ content: `Status set to **${status}**.`, ephemeral: true });
      return;
    }

    // Ban button -> open modal
    if (interaction.isButton() && interaction.customId.startsWith("ban:open:")) {
      const reportId = interaction.customId.split(":")[2];
      const modal = new ModalBuilder()
        .setCustomId(`banmodal:${reportId}`)
        .setTitle("Ban author");
      const reasonInput = new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Reason")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(400);
      const daysInput = new TextInputBuilder()
        .setCustomId("days")
        .setLabel("Duration in days (0 = permanent)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(5)
        .setValue("0");
      modal.addComponents(
        new ActionRowBuilder().addComponents(reasonInput),
        new ActionRowBuilder().addComponents(daysInput),
      );
      await interaction.showModal(modal);
      return;
    }

    // Ban modal submit
    if (interaction.isModalSubmit() && interaction.customId.startsWith("banmodal:")) {
      const reportId = interaction.customId.split(":")[1];
      const reason = interaction.fields.getTextInputValue("reason");
      const daysRaw = interaction.fields.getTextInputValue("days");
      const days = parseInt(daysRaw, 10);
      const report = await getEntry(REPORTS_DS, reportId);
      if (!report) {
        await interaction.reply({ content: "Report not found.", ephemeral: true });
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const until = isNaN(days) || days <= 0 ? 0 : now + days * 86400;
      const ban = {
        Active: true,
        Reason: reason,
        Until: until,
        BannedBy: interaction.user.tag,
        Time: now,
        UserId: report.UserId,
        Username: report.Username,
      };
      await setEntry(BANS_DS, String(report.UserId), ban);

      report.StatusNote = `Author banned by ${interaction.user.tag}: ${reason}`;
      await setEntry(REPORTS_DS, reportId, report);
      await updateReportMessage(report);

      const durationText = until === 0 ? "permanently" : `for ${days} day(s)`;
      await interaction.reply({
        content: `Banned **${report.Username}** ${durationText}.\nReason: ${reason}`,
        ephemeral: true,
      });
      return;
    }
  } catch (err) {
    console.error("[interaction] error:", err);
    if (interaction.isRepliable()) {
      interaction.reply({ content: "Something went wrong.", ephemeral: true }).catch(() => {});
    }
  }
});

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  pollReports();
  setInterval(pollReports, POLL_SECONDS * 1000);
});

client.login(TOKEN);
