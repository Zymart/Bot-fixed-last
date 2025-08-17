// index_full.js
require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const express = require('express');

const { getUser } = require('./systems/users');
const { startBattle } = require('./systems/battle');
const { handlePortalCommand, spawnPortal, portalLoop } = require('./systems/portals');
const { handleGuildCommand } = require('./systems/guilds');
const { leaderboardCommand } = require('./systems/leaderboard');

const PREFIX = process.env.PREFIX || "!";
const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN || process.env.BOT_TOKEN || "";
const OWNER_ID = process.env.OWNER_ID || "730629579533844512";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot || !msg.content.startsWith(PREFIX)) return;
  const [raw, ...rest] = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = (raw || "").toLowerCase();
  const args = rest;

  try {
    if (cmd === "register") {
      const u = getUser(msg.author.id, msg.author.username);
      return msg.reply(`✅ Registered: ${u.username}`);
    }
    if (cmd === "profile") {
      const u = getUser(msg.author.id, msg.author.username);
      return msg.reply(`📜 Profile — ${u.username}\nLevel: ${u.level}\nEXP: ${u.exp}\nGold: ${u.gold}\nHP: ${u.hp}`);
    }
    if (cmd === "battle") {
      const u = getUser(msg.author.id, msg.author.username);
      return startBattle(msg.channel, u);
    }
    if (cmd === "portal") {
      return handlePortalCommand(msg, args, OWNER_ID);
    }
    if (cmd === "guild") {
      return handleGuildCommand(msg, args);
    }
    if (cmd === "leaderboard") {
      return leaderboardCommand(msg, args);
    }
    if (cmd === "openportal") {
      if (msg.author.id !== OWNER_ID) return msg.reply("❌ Owner only.");
      return spawnPortal(msg.channel);
    }
  } catch (e) {
    console.error(e);
    return msg.reply("⚠️ Error running that command.");
  }
});

client.once(Events.ClientReady, () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  portalLoop(client);
});

const app = express();
app.get("/", (req, res) => res.send("Bot is alive."));
app.listen(process.env.PORT || 3000, () => console.log("🌐 Web server running."));

if (!TOKEN) console.error("❌ Missing bot token");
else client.login(TOKEN);
