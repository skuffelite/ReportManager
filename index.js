import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { getEntry, setEntry } from "./datastore.js";

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.REPORT_CHANNEL_ID;
const POLL_SECONDS = parseInt(process.env.POLL_SECONDS || "15", 10);

const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

function isAdmin(userId) {
  if (ADMIN_IDS.length === 0) return true;
  return ADMIN_IDS.includes(userId);
}

const REPORTS_DS = "BugReports_V1";
const INDEX_DS = "BugReportsIndex_V1";
const BANS_DS = "BugBans_V1";
const EDITS_DS = "PlayerDataEdits_V1";
const INDEX_KEY = "AllReports";

const EDITABLE = ["Wins", "Deaths", "Knobs", "Revives", "TrollBoost"];

const STATUSES = ["Pending", "Accepted", "InProgress", "Fixed", "Rejected"];
const STATUS_LABELS = {
  Pending: "Pending",
  Accepted: "Accepted",
  InProgress: "In Progress",
  Fixed: "Fixed",
  Rejected: "Rejected",
};
const STATUS_COLORS = {
  Pending: 0x5865f2,
  Accepted: 0x3ba55d,
  InProgress: 0xe6a23c,
  Fixed: 0x4a9eed,
  Rejected: 0xed4245,
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

function fmtDuration(mins) {
  if (!mins || mins <= 0) return "permanent";
  if (mins < 60) return mins + " min";
  if (mins < 1440) return (mins / 60).toFixed(mins % 60 === 0 ? 0 : 1) + " h";
  return (mins / 1440).toFixed(mins % 1440 === 0 ? 0 : 1) + " d";
}

function isBanActive(ban) {
  if (!ban || ban.Active !== true) return false;
  if (!ban.Until || ban.Until <= 0) return true; // permanent
  return ban.Until > Math.floor(Date.now() / 1000);
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function pad(label, val) {
  return String(label).padEnd(11) + String(val);
}

function reportEmbed(report) {
  const color = STATUS_COLORS[report.Status] || STATUS_COLORS.Pending;
  const stats = report.Stats || {};
  const statusLabel = STATUS_LABELS[report.Status] || report.Status || "Pending";
  const profile = "https://www.roblox.com/users/" + report.UserId + "/profile";

  const NL = "\n";
  const FENCE = "```";

  const identity =
    "**[" + report.DisplayName + "](" + profile + ")**  `@" + report.Username + "`" + NL +
    "-# ID " + report.UserId + "  ·  account " + report.AccountAge + "d old";

  const statsBlock =
    FENCE + NL +
    pad("Wins", stats.Wins || 0) + NL +
    pad("Deaths", stats.Deaths || 0) + NL +
    pad("Knobs", stats.Knobs || 0) + NL +
    pad("Revives", stats.Revives || 0) + NL +
    pad("TrollBoost", stats.TrollBoost || 0) + NL +
    FENCE;

  const cosmeticsBlock =
    FENCE + NL +
    pad("Plush", stats.EquippedPlush || "None") + NL +
    pad("Badge", stats.EquippedBadge || "None") + NL +
    pad("Owned", stats.OwnedPlush || 0) + NL +
    pad("HasPlush", stats.HasPlush ? "Yes" : "No") + NL +
    FENCE;

  const e = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: statusLabel.toUpperCase() + " · BUG REPORT" })
    .setTitle(report.Title || "Untitled report")
    .setThumbnail(
      "https://www.roblox.com/headshot-thumbnail/image?userId=" +
        report.UserId +
        "&width=150&height=150&format=png",
    )
    .setDescription(identity);

  e.addFields(
    { name: "Mode", value: "`" + (report.Mode || "-") + "`", inline: true },
    { name: "Type", value: "`" + (report.Type || "-") + "`", inline: true },
    { name: "Reported", value: "<t:" + (report.Time || 0) + ":R>", inline: true },
  );

  e.addFields({
    name: "Description",
    value: String(report.Description || "-").slice(0, 1024),
    inline: false,
  });

  if (report.Steps && report.Steps !== "-") {
    e.addFields({
      name: "Steps to reproduce",
      value: String(report.Steps).slice(0, 1024),
      inline: false,
    });
  }
  if (report.Video && report.Video !== "" && report.Video !== "-") {
    e.addFields({ name: "Clip", value: "**[Watch the recording](" + report.Video + ")**", inline: false });
  }

  e.addFields(
    { name: "Stats", value: statsBlock, inline: true },
    { name: "Cosmetics", value: cosmeticsBlock, inline: true },
  );

  if (report.DataEdit) {
    const ed = report.DataEdit;
    const state = ed.Applied ? "applied" : "pending";
    const changes = EDITABLE.filter((k) => ed.Values && ed.Values[k] !== undefined)
      .map((k) => k + " -> " + ed.Values[k])
      .join("  ·  ");
    e.addFields({ name: "Data edited", value: changes + NL + "-# " + state + " · by " + ed.By, inline: false });
  }

  if (isBanActive(report.Ban)) {
    e.addFields({
      name: "Ban active",
      value: "**" + fmtDuration(report.Ban.Minutes) + "** · by " + report.Ban.BannedBy + NL + "Reason: " + report.Ban.Reason,
      inline: false,
    });
  }

  const footerBits = ["ID " + report.Id];
  if (report.StatusNote && report.StatusNote !== "") footerBits.unshift(report.StatusNote);
  e.setFooter({ text: footerBits.join("  ·  ") });

  return e;
}

function controlRows(report) {
  const select = new StringSelectMenuBuilder()
    .setCustomId("setstatus:" + report.Id)
    .setPlaceholder("Set status...")
    .addOptions(
      STATUSES.map((s) => ({
        label: STATUS_LABELS[s],
        value: s,
        default: report.Status === s,
      })),
    );
  const row1 = new ActionRowBuilder().addComponents(select);

  const banned = isBanActive(report.Ban);
  const banBtn = new ButtonBuilder()
    .setCustomId(banned ? "unban:" + report.Id : "ban:open:" + report.Id)
    .setLabel(banned ? "Unban author" : "Ban author")
    .setStyle(banned ? ButtonStyle.Secondary : ButtonStyle.Danger);
  const editBtn = new ButtonBuilder()
    .setCustomId("editdata:" + report.Id)
    .setLabel("Change Data")
    .setStyle(ButtonStyle.Primary);
  const row2 = new ActionRowBuilder().addComponents(editBtn, banBtn);

  return [row1, row2];
}

async function getChannel() {
  return await client.channels.fetch(CHANNEL_ID).catch(() => null);
}

async function editMessage(report) {
  if (!report.MessageId) return;
  const channel = await getChannel();
  if (!channel) return;
  const msg = await channel.messages.fetch(report.MessageId).catch(() => null);
  if (msg) {
    await msg
      .edit({ embeds: [reportEmbed(report)], components: controlRows(report) })
      .catch((e) => console.error("[edit] failed:", e.message));
  }
}

async function pollReports() {
  let index;
  try {
    index = await getEntry(INDEX_DS, INDEX_KEY);
  } catch (err) {
    console.error("[poll] index fetch failed:", err.message);
    return;
  }
  if (!Array.isArray(index)) return;

  const channel = await getChannel();
  if (!channel) return;

  for (const entry of index) {
    let report;
    try {
      report = await getEntry(REPORTS_DS, entry.id);
    } catch {
      continue;
    }
    if (!report || report.Posted) continue;

    try {
      const msg = await channel.send({
        embeds: [reportEmbed(report)],
        components: controlRows(report),
      });
      report.Posted = true;
      report.MessageId = msg.id;
      await setEntry(REPORTS_DS, report.Id, report);
      console.log("[poll] posted", report.Id);
    } catch (err) {
      console.error("[poll] post failed:", report.Id, err.message);
    }
  }
}

async function refreshAll() {
  let index;
  try {
    index = await getEntry(INDEX_DS, INDEX_KEY);
  } catch {
    return;
  }
  if (!Array.isArray(index)) return;
  for (const entry of index) {
    let report;
    try {
      report = await getEntry(REPORTS_DS, entry.id);
    } catch {
      continue;
    }
    if (report && report.Posted && report.MessageId) {
      await editMessage(report);
    }
  }
  console.log("[refresh] done");
}

async function syncExpiredBans() {
  let index;
  try {
    index = await getEntry(INDEX_DS, INDEX_KEY);
  } catch {
    return;
  }
  if (!Array.isArray(index)) return;
  for (const entry of index) {
    let report;
    try {
      report = await getEntry(REPORTS_DS, entry.id);
    } catch {
      continue;
    }
    if (!report || !report.Posted || !report.MessageId) continue;
    // Ban recorded as active but time expired -> refresh card so button flips back to Ban
    if (report.Ban && report.Ban.Active === true && report.Ban.Until && report.Ban.Until > 0) {
      if (report.Ban.Until <= Math.floor(Date.now() / 1000)) {
        report.Ban.Active = false;
        await setEntry(REPORTS_DS, report.Id, report);
        await editMessage(report);
        console.log("[bansync] expired ban refreshed:", report.Id);
      }
    }
  }
}

client.on("interactionCreate", async (interaction) => {
  try {
    if (
      (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) &&
      !isAdmin(interaction.user.id)
    ) {
      await interaction.reply({ content: "You are not allowed to use these controls.", ephemeral: true });
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("setstatus:")) {
      const reportId = interaction.customId.split(":")[1];
      const status = interaction.values[0];
      const report = await getEntry(REPORTS_DS, reportId);
      if (!report) {
        await interaction.reply({ content: "Report not found.", ephemeral: true });
        return;
      }
      report.Status = status;
      report.StatusNote = STATUS_LABELS[status] + " by " + interaction.user.username;
      await setEntry(REPORTS_DS, reportId, report);
      await editMessage(report);
      await interaction.reply({ content: "Status -> **" + STATUS_LABELS[status] + "**", ephemeral: true });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("editdata:")) {
      const reportId = interaction.customId.split(":")[1];
      const report = await getEntry(REPORTS_DS, reportId);
      if (!report) {
        await interaction.reply({ content: "Report not found.", ephemeral: true });
        return;
      }
      const s = report.Stats || {};
      const modal = new ModalBuilder().setCustomId("editmodal:" + reportId).setTitle("Change player data");
      const inputs = [
        ["Wins", s.Wins || 0],
        ["Deaths", s.Deaths || 0],
        ["Knobs", s.Knobs || 0],
        ["Revives", s.Revives || 0],
        ["TrollBoost", s.TrollBoost || 0],
      ];
      for (const [key, val] of inputs) {
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId(key)
              .setLabel(key)
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setValue(String(val)),
          ),
        );
      }
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("editmodal:")) {
      const reportId = interaction.customId.split(":")[1];
      const report = await getEntry(REPORTS_DS, reportId);
      if (!report) {
        await interaction.reply({ content: "Report not found.", ephemeral: true });
        return;
      }
      const values = {};
      const newStats = Object.assign({}, report.Stats || {});
      for (const key of EDITABLE) {
        const raw = interaction.fields.getTextInputValue(key);
        const n = parseInt(raw, 10);
        if (!isNaN(n)) {
          values[key] = n;
          newStats[key] = n;
        }
      }

      const edit = {
        EditId: genId(),
        Values: values,
        By: interaction.user.username,
        Time: Math.floor(Date.now() / 1000),
        Applied: false,
        UserId: report.UserId,
      };
      await setEntry(EDITS_DS, String(report.UserId), edit);

      report.DataEdit = edit;
      report.Stats = newStats;
      await setEntry(REPORTS_DS, reportId, report);
      await editMessage(report);

      const summary = EDITABLE.filter((k) => values[k] !== undefined)
        .map((k) => k + "=" + values[k])
        .join(", ");
      await interaction.reply({ content: "Data edit queued for **" + report.Username + "**: " + summary, ephemeral: true });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("ban:open:")) {
      const reportId = interaction.customId.split(":")[2];
      const modal = new ModalBuilder().setCustomId("banmodal:" + reportId).setTitle("Ban author");
      const reason = new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Reason (optional)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(400);
      const minutes = new TextInputBuilder()
        .setCustomId("minutes")
        .setLabel("Duration in MINUTES (0 = permanent)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(8)
        .setValue("2");
      modal.addComponents(
        new ActionRowBuilder().addComponents(reason),
        new ActionRowBuilder().addComponents(minutes),
      );
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("banmodal:")) {
      const reportId = interaction.customId.split(":")[1];
      const reasonRaw = interaction.fields.getTextInputValue("reason");
      const reason = reasonRaw && reasonRaw.trim() !== "" ? reasonRaw.trim() : "No reason provided";
      const minsRaw = interaction.fields.getTextInputValue("minutes");
      const minutes = parseInt(minsRaw, 10);
      const report = await getEntry(REPORTS_DS, reportId);
      if (!report) {
        await interaction.reply({ content: "Report not found.", ephemeral: true });
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const mins = isNaN(minutes) || minutes < 0 ? 0 : minutes;
      const until = mins <= 0 ? 0 : now + mins * 60;

      const ban = {
        Active: true,
        Reason: reason,
        Minutes: mins,
        Until: until,
        BannedBy: interaction.user.username,
        Time: now,
        UserId: report.UserId,
        Username: report.Username,
      };
      await setEntry(BANS_DS, String(report.UserId), ban);

      report.Ban = ban;
      await setEntry(REPORTS_DS, reportId, report);
      await editMessage(report);

      await interaction.reply({
        content: "Banned **" + report.Username + "** (" + fmtDuration(mins) + "). Reason: " + reason,
        ephemeral: true,
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("unban:")) {
      const reportId = interaction.customId.split(":")[1];
      const report = await getEntry(REPORTS_DS, reportId);
      if (!report) {
        await interaction.reply({ content: "Report not found.", ephemeral: true });
        return;
      }
      await setEntry(BANS_DS, String(report.UserId), { Active: false, UserId: report.UserId });
      if (report.Ban) report.Ban.Active = false;
      await setEntry(REPORTS_DS, reportId, report);
      await editMessage(report);
      await interaction.reply({ content: "Unbanned **" + report.Username + "**.", ephemeral: true });
      return;
    }
  } catch (err) {
    console.error("[interaction] error:", err);
    if (interaction.isRepliable()) {
      interaction.reply({ content: "Something went wrong.", ephemeral: true }).catch(() => {});
    }
  }
});

client.on("messageDelete", async (message) => {
  try {
    if (message.channelId !== CHANNEL_ID) return;
    let index;
    try {
      index = await getEntry(INDEX_DS, INDEX_KEY);
    } catch {
      return;
    }
    if (!Array.isArray(index)) return;
    for (const entry of index) {
      let report;
      try {
        report = await getEntry(REPORTS_DS, entry.id);
      } catch {
        continue;
      }
      if (report && report.MessageId === message.id) {
        report.Deleted = true;
        await setEntry(REPORTS_DS, report.Id, report);
        console.log("[delete] report hidden from player:", report.Id);
        break;
      }
    }
  } catch (err) {
    console.error("[messageDelete] error:", err.message);
  }
});

client.once("ready", async () => {
  console.log("Logged in as " + client.user.tag);
  await refreshAll();
  await pollReports();
  setInterval(pollReports, POLL_SECONDS * 1000);
  setInterval(syncExpiredBans, 30 * 1000);
});

client.login(TOKEN);
