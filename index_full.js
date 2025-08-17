// index_full.js
// Solo Leveling style Discord RPG bot (Railway-ready)

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const { 
  Client, GatewayIntentBits, Partials, 
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events 
} = require('discord.js');

// ---- Config ----
const TOKEN = process.env.DISCORD_TOKEN || process.env.TOKEN || "";
const PREFIX = process.env.PREFIX || "!";
const OWNER_ID = process.env.OWNER_ID || "730629579533844512";
const SPAWN_CHANNEL_ID = process.env.SPAWN_CHANNEL_ID || "";
const PORTAL_MIN_MS = Number(process.env.PORTAL_MIN_MS || 5*60*1000);
const PORTAL_MAX_MS = Number(process.env.PORTAL_MAX_MS || 10*60*1000);
const PORTAL_LIFETIME_MS = Number(process.env.PORTAL_LIFETIME_MS || 24*60*60*1000);
const DATA_FILE = path.join(__dirname, "data.json");

// ---- Database ----
let db = { users: [], market: [], guilds: {}, portals: [] };
if (fs.existsSync(DATA_FILE)) {
  try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
}
function saveDB() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8'); }
setInterval(saveDB, 15000);

const users = db.users;
const market = db.market;
const guilds = db.guilds;
const portals = db.portals;

// ---- Helpers ----
function getUser(id, username) {
  let u = users.find(x => x.userId === id);
  if (!u) {
    u = { userId: id, username, level: 1, exp: 0, gold: 0, hp: 120, maxHp: 120, inv: {} };
    users.push(u); saveDB();
  }
  u.maxHp = 120 + u.level * 30;
  if (u.hp === undefined) u.hp = u.maxHp;
  return u;
}
function addItem(u, key, qty = 1) { u.inv ||= {}; u.inv[key] = (u.inv[key] || 0) + qty; }
function takeItem(u, key, qty = 1) { 
  u.inv ||= {}; 
  if ((u.inv[key] || 0) < qty) return false; 
  u.inv[key] -= qty; 
  if (u.inv[key] <= 0) delete u.inv[key]; 
  return true; 
}
function invToString(u) { 
  const inv = u.inv || {}; 
  const keys = Object.keys(inv); 
  if (!keys.length) return "_empty_"; 
  return keys.map(k => `• ${k} x${inv[k]}`).join("\n"); 
}

// ---- Discord Client ----
const client = new Client({ 
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent], 
  partials: [Partials.Channel] 
});

// ---- Commands ----
client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot || !msg.content.startsWith(PREFIX)) return;
  const [raw, ...rest] = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = (raw || "").toLowerCase();
  const args = rest;

  const u = getUser(msg.author.id, msg.author.username);

  if (cmd === "register") {
    return msg.reply("✅ You are already registered.");
  }

  if (cmd === "profile") {
    return msg.channel.send({ embeds: [ 
      new EmbedBuilder()
        .setTitle(`📜 Profile — ${u.username}`)
        .setDescription(`Level: ${u.level}\nEXP: ${u.exp}\nGold: ${u.gold}\nHP: ${u.hp}/${u.maxHp}`)
        .setColor(0x3498db) ] 
    });
  }

  if (cmd === "about") {
    return msg.reply("🤖 Solo Leveling RPG Bot — battle monsters, trade, join guilds, and grow stronger!");
  }

  if (cmd === "inv") {
    return msg.channel.send({ embeds: [ 
      new EmbedBuilder().setTitle(`🎒 Inventory — ${u.username}`).setDescription(invToString(u)).setColor(0x2ecc71) ] 
    });
  }

  if (cmd === "use") {
    const key = (args[0] || "").toLowerCase();
    if (!key) return msg.reply("Usage: !use <item>");
    if (!takeItem(u, key, 1)) return msg.reply(`No ${key} available.`);
    saveDB();
    return msg.channel.send(`Used ${key}.`);
  }

  if (cmd === "train") {
    const exp = 10 + Math.floor(Math.random() * 15);
    const gold = 5 + Math.floor(Math.random() * 10);
    u.exp += exp; u.gold += gold;
    while (u.exp >= u.level * 100) { u.exp -= u.level * 100; u.level++; }
    saveDB();
    return msg.reply(`You trained and gained ${exp} EXP and ${gold} Gold!`);
  }

  if (cmd === "portal") {
    const now = Date.now();
    const active = portals.filter(p => now < p.expires);
    if (!active.length) return msg.reply("No active portals.");
    const desc = active.map(p => `🌌 ${p.rarity} — Expires in ${(Math.floor((p.expires - now)/60000))}m`).join("\n");
    return msg.channel.send({ embeds: [ new EmbedBuilder().setTitle("Active Portals").setDescription(desc).setColor(0x9b59b6) ] });
  }

  if (cmd === "forcespawn") {
    if (msg.author.id !== OWNER_ID) return msg.reply("❌ Only owner can spawn portals.");
    await spawnPortal(msg.channel);
    return msg.reply("✅ Portal spawned.");
  }

  if (cmd === "leaderboard") {
    const type = (args[0] || "level").toLowerCase();
    let sorted = [...users];
    if (type === "exp") sorted.sort((a,b)=>b.exp-a.exp);
    else if (type === "gold") sorted.sort((a,b)=>b.gold-a.gold);
    else sorted.sort((a,b)=>b.level-a.level);
    sorted = sorted.slice(0,10);
    const lines = sorted.map((x,i)=>`${i+1}. ${x.username} — Lvl ${x.level} | EXP ${x.exp} | Gold ${x.gold}`);
    return msg.channel.send({ embeds: [ new EmbedBuilder().setTitle(`🏆 Leaderboard (${type})`).setDescription(lines.join("\n")) ] });
  }

  if (cmd === "guild") {
    const sub = (args[0] || "").toLowerCase();
    if (sub === "create") {
      if (guilds[u.userId]) return msg.reply("You already have a guild.");
      guilds[u.userId] = { name: args.slice(1).join(" ") || `${u.username}'s Guild`, leader: u.userId, members: [u.userId] };
      saveDB();
      return msg.reply("✅ Guild created.");
    }
    if (sub === "join") {
      const targetId = args[1];
      const g = guilds[targetId]; if (!g) return msg.reply("No such guild.");
      if (g.members.includes(u.userId)) return msg.reply("Already a member.");
      g.members.push(u.userId); saveDB();
      return msg.reply("✅ Joined guild.");
    }
    if (sub === "leave") {
      for (const g of Object.values(guilds)) {
        const idx = g.members.indexOf(u.userId);
        if (idx>=0) { g.members.splice(idx,1); saveDB(); return msg.reply("✅ Left guild."); }
      }
      return msg.reply("Not in a guild.");
    }
    if (sub === "info") {
      for (const g of Object.values(guilds)) {
        if (g.members.includes(u.userId)) {
          const members = g.members.map(id=>users.find(x=>x.userId===id)?.username||id).join(", ");
          return msg.channel.send({ embeds: [ new EmbedBuilder().setTitle(`🏰 Guild: ${g.name}`).setDescription(`Leader: ${users.find(x=>x.userId===g.leader)?.username}\nMembers: ${members}`) ] });
        }
      }
      return msg.reply("Not in a guild.");
    }
    return msg.reply("Usage: !guild create|join <leaderId>|leave|info");
  }
});

// ---- Portal Spawning ----
const portalImages = [
  "https://i.pinimg.com/564x/1a/0b/f0/1a0bf03b36fd9.jpg",
  "https://i.pinimg.com/564x/92/45/b3/9245b3cc1f9e9.jpg",
  "https://i.pinimg.com/564x/2f/6d/88/2f6d88c88ec1.jpg"
];
function randomPortalImage() { return portalImages[Math.floor(Math.random() * portalImages.length)]; }

async function spawnPortal(channel) {
  const rarities = ["Common", "Rare", "Epic", "Legendary", "Mythic"];
  const rarity = rarities[Math.floor(Math.random() * rarities.length)];
  const emb = new EmbedBuilder().setTitle(`🌌 A ${rarity} Portal Appears!`).setDescription("A mysterious rift has opened.").setImage(randomPortalImage());
  const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("enterportal").setLabel("Enter Portal").setStyle(ButtonStyle.Primary));
  portals.push({ rarity, created: Date.now(), expires: Date.now()+PORTAL_LIFETIME_MS });
  saveDB();
  await channel.send({ embeds: [emb], components: [btn] });
}

async function portalLoop(client) {
  if (!SPAWN_CHANNEL_ID) return;
  const channel = await client.channels.fetch(SPAWN_CHANNEL_ID).catch(()=>null);
  if (!channel) return;
  async function loop() {
    const delay = PORTAL_MIN_MS + Math.random() * (PORTAL_MAX_MS - PORTAL_MIN_MS);
    setTimeout(async () => { await spawnPortal(channel); loop(); }, delay);
  }
  loop();
}

// ---- Keep Alive ----
const app = express();
app.get("/", (_,res)=>res.send("Bot is alive"));
app.listen(process.env.PORT || 3000);

// ---- Start ----
client.once(Events.ClientReady, () => { console.log("Bot ready."); portalLoop(client); });
if (!TOKEN) { console.log("Missing token."); } else { client.login(TOKEN); }
