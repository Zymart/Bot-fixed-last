require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  Events,
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN || process.env.TOKEN || "";
const PREFIX = process.env.PREFIX || "!";
const OWNER_ID = process.env.OWNER_ID || "730629579533844512";
const SPAWN_CHANNEL_ID = process.env.SPAWN_CHANNEL_ID || "";
const PORTAL_MIN_MS = Number(process.env.PORTAL_MIN_MS || 5*60*1000);
const PORTAL_MAX_MS = Number(process.env.PORTAL_MAX_MS || 10*60*1000);
const DATA_FILE = path.join(__dirname, "data.json");
const PORTAL_LIFETIME_MS = 24*60*60*1000;

let db = { users: [], market: [], powers: {}, portals: [], guilds: [], trades: [] };
if (fs.existsSync(DATA_FILE)) {
  try { db = Object.assign(db, JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) || {}); } catch {}
}
function saveDB() { try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8'); } catch {} }
setInterval(saveDB, 15000);

const users = db.users;
const market = db.market;
const powers = db.powers;
const portals = db.portals;
const guilds = db.guilds;
const trades = db.trades;

const portalImages = [
  "https://i.pinimg.com/564x/1a/0b/f0/1a0bf03b36fd9.jpg",
  "https://i.pinimg.com/564x/92/45/b3/9245b3cc1f9e9.jpg",
  "https://i.pinimg.com/564x/2f/6d/88/2f6d88c88ec1.jpg",
  "https://i.pinimg.com/564x/63/cd/55/63cd55c8.jpg",
  "https://i.pinimg.com/564x/41/23/91/412391a4.jpg"
];
function randomPortalImage() { return portalImages[Math.floor(Math.random() * portalImages.length)]; }
function uid() { return Math.random().toString(36).slice(2, 10); }

function getUser(id, username) {
  let u = users.find(x => x.userId === id);
  if (!u) {
    u = { userId: id, username, registered: false, level: 1, exp: 0, gold: 0, hpBonus: 0, atkBonus: 0, createdAt: Date.now(), power: null, inv: {}, hp: 120, maxHp: 120, guildId: null };
    users.push(u); saveDB();
  }
  u.username = username || u.username;
  u.maxHp = pMaxHP(u);
  if (typeof u.hp !== "number") u.hp = u.maxHp;
  return u;
}
function requireRegistered(msg, u) {
  if (!u.registered) { msg.reply("Use `!register` to create your character first."); return false; }
  return true;
}
function pMaxHP(u) { return 120 + u.level * 30 + (u.hpBonus || 0); }
function pATK(u) { return Math.floor(12 + u.level * 6 + (u.atkBonus || 0)); }
function unlockedSkills(u) { if (!u.power) return []; return (u.power.skills || []).filter(s => u.level >= (s.levelReq || 1)); }
function dmgForSkill(u, sName) { const skill = (u.power?.skills || []).find(s => s.name === sName); const mult = skill?.powerMult || 1.0; const base = pATK(u); return Math.max(1, Math.floor(base * mult * (0.85 + Math.random() * 0.3))); }
function addItem(u, key, qty = 1) { u.inv ||= {}; u.inv[key] = (u.inv[key] || 0) + qty; }
function takeItem(u, key, qty = 1) { u.inv ||= {}; if ((u.inv[key] || 0) < qty) return false; u.inv[key] -= qty; if (u.inv[key] <= 0) delete u.inv[key]; return true; }
function invToString(u) { const inv = u.inv || {}; const keys = Object.keys(inv); if (!keys.length) return "_empty_"; return keys.map(k => `• ${k} x${inv[k]}`).join("\n"); }
function randomDrops(rarity) {
  const lootTable = { Common:[{item:"healing_potion",qty:1}], Rare:[{item:"mana_potion",qty:1},{item:"iron_sword",qty:1}], Epic:[{item:"crystal_shard",qty:2},{item:"enchanted_ring",qty:1}], Legendary:[{item:"dragon_scale",qty:1},{item:"phoenix_feather",qty:1}], Mythic:[{item:"godstone",qty:1}] };
  const pool = lootTable[rarity] || [];
  if (!pool.length) return [];
  const count = rarity === "Mythic" ? 3 : rarity === "Legendary" ? 2 : 1;
  const results = [];
  for (let i = 0; i < count; i++) results.push(pool[Math.floor(Math.random() * pool.length)]);
  return results;
}
function useItem(u, item) {
  if (item === "healing_potion") { u.hp = Math.min(u.maxHp || pMaxHP(u), (u.hp || pMaxHP(u)) + 50); return `Restored 50 HP. Current HP: ${u.hp}/${u.maxHp || pMaxHP(u)}`; }
  if (item === "mana_potion") { return `Regained magical energy.`; }
  if (item === "xp_scroll") { u.exp += 50; levelCheck(u); return `Gained 50 EXP.`; }
  return `Used ${item}.`;
}
function levelCheck(u) { while (u.exp >= u.level * 100) { u.exp -= u.level * 100; u.level++; u.maxHp = pMaxHP(u); u.hp = u.maxHp; } }

function fmtTime(ms) { const s = Math.max(0, Math.floor(ms/1000)); const h = Math.floor(s/3600); const m = Math.floor((s%3600)/60); const ss = s%60; return `${h}h ${m}m ${ss}s`; }
function cleanupPortals() { const now = Date.now(); for (const p of portals) p.expired = now >= p.expiresAt; for (let i=portals.length-1;i>=0;i--) { if (portals[i].expired && (now - portals[i].expiresAt) > 5*60*1000) portals.splice(i,1); } }
setInterval(() => { cleanupPortals(); saveDB(); }, 60*1000);

const battles = new Map();
function battleKey(chId, uid) { return `${chId}:${uid}`; }
async function renderBattle(channel, user, b, headline) {
  const emb = new EmbedBuilder().setTitle(`⚔️ Battle vs ${b.enemy.name}`).setColor(0x9b59b6).setDescription([headline || "", "", `**${user.username}** — HP: ${b.hp}/${b.maxHp}`, `**${b.enemy.name}** — HP: ${b.enemy.hp}/${b.enemy.maxHp}`, "", b.turn === "player" ? "_Your turn — choose an action below._" : "_Enemy's turn..._"].join("\n"));
  const skills = unlockedSkills(user);
  const perPage = 3;
  const start = (b.page||0) * perPage;
  const pageSkills = skills.slice(start, start + perPage);
  const row1 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`battle:attack:${user.userId}`).setLabel("Basic Attack").setStyle(ButtonStyle.Primary));
  for (const s of pageSkills) row1.addComponents(new ButtonBuilder().setCustomId(`battle:skill:${user.userId}:${s.name}`).setLabel(s.name.slice(0, 80)).setStyle(ButtonStyle.Success));
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`battle:prev:${user.userId}`).setLabel("◀ Prev").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`battle:next:${user.userId}`).setLabel("Next ▶").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`battle:item:${user.userId}`).setLabel("Use Item").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`battle:flee:${user.userId}`).setLabel("Flee").setStyle(ButtonStyle.Danger)
  );
  if (b.msg) { try { await b.msg.edit({ embeds: [emb], components: [row1, row2] }); } catch {} } else { b.msg = await channel.send({ embeds: [emb], components: [row1, row2] }); }
}
async function giveBattleRewards(u, rarity) {
  const exp = 80 + Math.floor(Math.random() * 40);
  const gold = 30 + Math.floor(Math.random() * 20);
  u.exp += exp; u.gold = (u.gold || 0) + gold; levelCheck(u);
  const drops = randomDrops(rarity || "Common");
  const dropList = []; for (const d of drops) { addItem(u, d.item, d.qty); dropList.push(d); }
  saveDB();
  return { exp, gold, drops: dropList };
}

function listMarket() { return market.map((m, i) => `${i + 1}. ${m.sellerName} sells ${m.qty}x ${m.item} for ${m.gold} Gold`).join("\n") || "_empty_"; }

function findGuildByName(name) { return guilds.find(g => g.name.toLowerCase() === name.toLowerCase()); }
function getGuild(id) { return guilds.find(g => g.id === id); }
function topUsersBy(key, limit=10) { return [...users].filter(u=>u.registered).sort((a,b)=>(b[key]||0)-(a[key]||0)).slice(0,limit); }

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent], partials: [Partials.Channel] });

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot || !msg.content.startsWith(PREFIX)) return;
  const [raw, ...rest] = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = (raw || "").toLowerCase();
  const args = rest;
  if (cmd === "register") {
    const u = getUser(msg.author.id, msg.author.username);
    if (u.registered) return msg.reply("You are already registered.");
    u.registered = true; u.level = 1; u.exp = 0; u.gold = 100; u.inv = { healing_potion: 2 };
    u.maxHp = pMaxHP(u); u.hp = u.maxHp;
    saveDB();
    return msg.reply("Registration complete.");
  }
  if (cmd === "about") {
    return msg.reply("RPG Bot with portals, battles, guilds, trading, and leaderboards.");
  }
  if (cmd === "profile") {
    const u = getUser(msg.author.id, msg.author.username);
    if (!requireRegistered(msg, u)) return;
    const g = u.guildId ? getGuild(u.guildId) : null;
    const e = new EmbedBuilder()
      .setTitle(`${u.username} — Profile`)
      .setColor(0x00ae86)
      .setDescription([
        `Level: ${u.level} (${u.exp}/${u.level*100})`,
        `HP: ${u.hp}/${u.maxHp}`,
        `ATK: ${pATK(u)}`,
        `Gold: ${u.gold}`,
        `Power: ${u.power?.name || "None"}`,
        `Guild: ${g?.name || "None"}`
      ].join("\n"));
    return msg.channel.send({ embeds: [e] });
  }
  if (cmd === "inv") {
    const u = getUser(msg.author.id, msg.author.username);
    if (!requireRegistered(msg, u)) return;
    const e = new EmbedBuilder().setTitle(`Inventory — ${u.username}`).setDescription(invToString(u)).setColor(0x2ecc71);
    return msg.channel.send({ embeds: [e] });
  }
  if (cmd === "use") {
    const u = getUser(msg.author.id, msg.author.username);
    if (!requireRegistered(msg, u)) return;
    const key = (args[0] || "").toLowerCase();
    if (!key) return msg.reply("Usage: !use <item>");
    if (!takeItem(u, key, 1)) return msg.reply(`No ${key} available.`);
    const effect = useItem(u, key);
    saveDB();
    return msg.channel.send(effect);
  }
  if (cmd === "forcespawn") {
    if (msg.author.id !== OWNER_ID) return msg.reply("Only the bot owner can use this command.");
    const channel = SPAWN_CHANNEL_ID ? await msg.client.channels.fetch(SPAWN_CHANNEL_ID).catch(() => null) : msg.channel;
    if (!channel) return msg.reply("No spawn channel configured.");
    await spawnPortal(channel);
    return msg.reply("Portal spawned.");
  }
  if (cmd === "portal") {
    cleanupPortals();
    const active = portals.filter(p => !p.expired).sort((a,b)=>a.expiresAt-b.expiresAt);
    if (!active.length) return msg.reply("No active portals.");
    const lines = active.map(p => `• ${p.rarity} — in <#${p.channelId}> — closes in ${fmtTime(p.expiresAt - Date.now())}`);
    return msg.channel.send(lines.join("\n"));
  }
  if (cmd === "train") {
    const u = getUser(msg.author.id, msg.author.username);
    if (!requireRegistered(msg, u)) return;
    const exp = 10 + Math.floor(Math.random() * 15);
    const gold = 5 + Math.floor(Math.random() * 10);
    u.exp += exp; u.gold = (u.gold || 0) + gold; levelCheck(u); saveDB();
    return msg.reply(`You trained and gained ${exp} EXP and ${gold} Gold.`);
  }
  if (cmd === "battle") {
    const u = getUser(msg.author.id, msg.author.username);
    if (!requireRegistered(msg, u)) return;
    const enemy = { name: "Goblin", hp: 60, maxHp: 60, atk: 8 };
    const b = { hp: u.hp, maxHp: u.maxHp, enemy, turn: "player", page: 0 };
    battles.set(battleKey(msg.channel.id, u.userId), b);
    await renderBattle(msg.channel, u, b, "A wild battle begins!");
    return;
  }
  if (cmd === "market") {
    return msg.channel.send("Marketplace:\n" + listMarket());
  }
  if (cmd === "list") {
    const u = getUser(msg.author.id, msg.author.username);
    if (!requireRegistered(msg, u)) return;
    const [item, qtyStr, goldStr] = args;
    const qty = Number(qtyStr), price = Number(goldStr);
    if (!item || !qty || !price) return msg.reply("Usage: !list <item> <qty> <gold>");
    if (!takeItem(u, item, qty)) return msg.reply("You don't have enough.");
    market.push({ id: uid(), seller: u.userId, sellerName: u.username, item, qty, gold: price });
    saveDB();
    return msg.reply("Item listed.");
  }
  if (cmd === "buy") {
    const idx = Number(args[0]) - 1;
    if (!(idx>=0) || idx >= market.length) return msg.reply("Invalid index.");
    const u = getUser(msg.author.id, msg.author.username);
    if (!requireRegistered(msg, u)) return;
    const entry = market[idx];
    if (u.gold < entry.gold) return msg.reply("Not enough gold.");
    u.gold -= entry.gold; addItem(u, entry.item, entry.qty); market.splice(idx, 1); saveDB();
    return msg.reply("Purchase successful.");
  }
  if (cmd === "offer") {
    const target = msg.mentions.users.first();
    const [_, item, qtyStr, goldStr] = args;
    if (!target || !item || !qtyStr || !goldStr) return msg.reply("Usage: !offer @user <item> <qty> <gold>");
    const qty = Number(qtyStr), price = Number(goldStr);
    const seller = getUser(msg.author.id, msg.author.username);
    if (!requireRegistered(msg, seller)) return;
    if (!takeItem(seller, item, qty)) return msg.reply("You don't have enough items.");
    const tUser = getUser(target.id, target.username);
    const t = { id: uid(), sellerId: seller.userId, buyerId: tUser.userId, item, qty, gold: price, channelId: msg.channel.id, createdAt: Date.now(), status: "pending" };
    trades.push(t); saveDB();
    return msg.channel.send(`<@${tUser.userId}> you have a trade offer: ${qty}x ${item} for ${price} Gold. Use !accept or !decline.`);
  }
  if (cmd === "accept" || cmd === "decline") {
    const t = trades.find(tr => tr.buyerId === msg.author.id && tr.status === "pending" && tr.channelId === msg.channel.id);
    if (!t) return msg.reply("No pending trade.");
    const seller = getUser(t.sellerId, "");
    const buyer = getUser(t.buyerId, msg.author.username);
    if (cmd === "decline") {
      addItem(seller, t.item, t.qty); t.status = "declined"; saveDB(); return msg.reply("Trade declined. Items returned to seller.");
    }
    if ((buyer.gold||0) < t.gold) { addItem(seller, t.item, t.qty); t.status = "failed"; saveDB(); return msg.reply("Buyer lacks gold. Trade failed; items returned to seller."); }
    buyer.gold -= t.gold; addItem(buyer, t.item, t.qty); seller.gold = (seller.gold||0) + t.gold; t.status = "completed"; saveDB();
    return msg.reply("Trade completed.");
  }
  if (["giveexp", "givegold", "giveitem", "resetuser"].includes(cmd)) {
    if (msg.author.id !== OWNER_ID) return msg.reply("Owner only.");
    const target = msg.mentions.users.first();
    if (!target) return msg.reply("Mention a user.");
    const u = getUser(target.id, target.username);
    if (cmd === "giveexp") { u.exp += Number(args[1] || 0); levelCheck(u); }
    if (cmd === "givegold") { u.gold = (u.gold || 0) + Number(args[1] || 0); }
    if (cmd === "giveitem") { addItem(u, args[1], Number(args[2] || 1)); }
    if (cmd === "resetuser") { Object.assign(u, { registered: false, level: 1, exp: 0, gold: 0, inv: {}, hp: pMaxHP(u), maxHp: pMaxHP(u), power: null, guildId: null }); }
    saveDB(); return msg.reply(`Done: ${cmd} for ${target.username}`);
  }
  if (cmd === "guild") {
    const sub = (args[0]||"").toLowerCase();
    const u = getUser(msg.author.id, msg.author.username);
    if (!requireRegistered(msg, u)) return;
    if (sub === "create") {
      const name = args.slice(1).join(" ").trim();
      if (!name) return msg.reply("Usage: !guild create <name>");
      if (findGuildByName(name)) return msg.reply("Name taken.");
      const g = { id: uid(), name, ownerId: u.userId, members: [u.userId], createdAt: Date.now() };
      guilds.push(g); u.guildId = g.id; saveDB();
      return msg.reply(`Guild created: ${name}`);
    } else if (sub === "join") {
      const name = args.slice(1).join(" ").trim();
      const g = findGuildByName(name);
      if (!g) return msg.reply("Guild not found.");
      if (u.guildId === g.id) return msg.reply("You are already in this guild.");
      if (u.guildId) return msg.reply("Leave your current guild first.");
      g.members.push(u.userId); u.guildId = g.id; saveDB();
      return msg.reply(`Joined guild ${g.name}.`);
    } else if (sub === "leave") {
      if (!u.guildId) return msg.reply("You are not in a guild.");
      const g = getGuild(u.guildId);
      if (!g) { u.guildId = null; saveDB(); return msg.reply("Left guild."); }
      g.members = g.members.filter(m => m !== u.userId);
      if (g.ownerId === u.userId) { if (g.members.length) g.ownerId = g.members[0]; else guilds.splice(guilds.indexOf(g),1); }
      u.guildId = null; saveDB();
      return msg.reply("Left guild.");
    } else if (sub === "info") {
      const name = args.slice(1).join(" ").trim();
      const g = name ? findGuildByName(name) : getGuild(u.guildId);
      if (!g) return msg.reply("Guild not found.");
      const e = new EmbedBuilder().setTitle(`Guild — ${g.name}`).setColor(0x5865f2).setDescription([
        `Owner: <@${g.ownerId}>`,
        `Members: ${g.members.length}`
      ].join("\n"));
      return msg.channel.send({ embeds: [e] });
    } else {
      return msg.reply("Usage: !guild <create|join|leave|info>");
    }
  }
  if (cmd === "leaderboard") {
    const type = (args[0]||"level").toLowerCase();
    const key = type === "exp" ? "exp" : type === "gold" ? "gold" : "level";
    const top = topUsersBy(key, 10);
    if (!top.length) return msg.reply("No data.");
    const lines = top.map((u,i)=> `${i+1}. ${u.username} — ${key==="level"?`Lvl ${u.level}`: key==="gold"?`${u.gold} Gold`:`${u.exp} EXP`}`);
    return msg.channel.send("Leaderboard ("+key+"): \n"+lines.join("\n"));
  }
});

client.on(Events.InteractionCreate, async (ix) => {
  if (!ix.isButton() && !ix.isStringSelectMenu()) return;
  const parts = ix.customId.split(":");
  const scope = parts[0];
  if (scope === "battle") {
    const [, action, uid, skillName] = parts;
    const bkey = battleKey(ix.channel.id, uid);
    const b = battles.get(bkey);
    const u = getUser(uid, ix.user.username);
    if (!b || !u) return;
    if (ix.user.id !== uid) return ix.reply({ content: "Not your battle.", ephemeral: true });
    if (action === "prev") { b.page = Math.max(0, (b.page || 0) - 1); await ix.deferUpdate(); await renderBattle(ix.channel, u, b); return; }
    if (action === "next") { const total = unlockedSkills(u).length; const perPage = 3; const maxPage = Math.max(0, Math.ceil(total / perPage) - 1); b.page = Math.min(maxPage, (b.page || 0) + 1); await ix.deferUpdate(); await renderBattle(ix.channel, u, b); return; }
    if (action === "flee") { battles.delete(bkey); await ix.update({ embeds: [new EmbedBuilder().setTitle("You fled the battle").setColor(0xe67e22)], components: [] }); return; }
    if (b.turn !== "player") { return ix.reply({ content: "Wait for your turn.", ephemeral: true }); }
    if (action === "attack" || action === "skill") {
      let dmg = action === "attack" ? Math.max(1, Math.floor(pATK(u) * (0.85 + Math.random() * 0.3))) : dmgForSkill(u, skillName);
      b.enemy.hp = Math.max(0, b.enemy.hp - dmg);
      let headline = action === "attack" ? `You hit for ${dmg} damage.` : `${skillName} dealt ${dmg} damage.`;
      if (b.enemy.hp <= 0) {
        const rewards = await giveBattleRewards(u, "Common");
        battles.delete(bkey);
        await ix.update({ embeds: [new EmbedBuilder().setTitle(`Victory over ${b.enemy.name}`).setColor(0x2ecc71).setDescription(`EXP +${rewards.exp}\nGold +${rewards.gold}\nDrops: ${rewards.drops.map(d=>`${d.item} x${d.qty}`).join(', ') || 'none'}`)], components: [] });
        return;
      }
      b.turn = "enemy";
      await ix.deferUpdate();
      await renderBattle(ix.channel, u, b, headline);
      setTimeout(async () => {
        const eDmg = Math.max(1, Math.floor(b.enemy.atk * (0.85 + Math.random() * 0.3)));
        b.hp = Math.max(0, b.hp - eDmg);
        if (b.hp <= 0) {
          battles.delete(bkey);
          try { await b.msg.edit({ embeds: [new EmbedBuilder().setTitle(`Defeated by ${b.enemy.name}`).setColor(0xe74c3c)], components: [] }); } catch {}
          const pu = getUser(uid, ix.user.username); pu.hp = Math.max(1, Math.floor(pu.maxHp * 0.25)); saveDB();
          return;
        }
        b.turn = "player";
        const pu = getUser(uid, ix.user.username); pu.hp = b.hp; saveDB();
        await renderBattle(ix.channel, u, b, `You took ${eDmg} damage.`);
      }, 1200);
      return;
    }
    if (action === "item") {
      const inv = u.inv || {};
      const options = Object.keys(inv).map(it => ({ label: `${it} x${inv[it]}`, value: it })).slice(0, 25);
      if (!options.length) return ix.reply({ content: "No items.", ephemeral: true });
      const menu = new StringSelectMenuBuilder().setCustomId(`useitem:${uid}`).setPlaceholder("Select item").addOptions(options);
      return ix.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
    }
    return;
  }
  if (scope === "useitem") {
    const uid = parts[1];
    if (ix.user.id !== uid) return ix.reply({ content: "Not yours.", ephemeral: true });
    const u = getUser(uid, ix.user.username);
    const item = ix.values[0];
    if (!takeItem(u, item, 1)) return ix.reply({ content: `No ${item} left.`, ephemeral: true });
    const effect = useItem(u, item);
    saveDB();
    return ix.reply({ content: `Used ${item}: ${effect}` });
  }
  if (scope === "enterportal") {
    await ix.deferReply({ ephemeral: true });
    const pId = parts[1];
    const p = portals.find(pp => pp.id === pId);
    if (!p || p.expired || Date.now() > p.expiresAt) { return ix.editReply("This portal is closed."); }
    const u = getUser(ix.user.id, ix.user.username);
    if (!u.registered) return ix.editReply("Use !register first.");
    const enemy = { name: "Portal Wraith", hp: 80, maxHp: 80, atk: 10 };
    const b = { hp: u.hp, maxHp: u.maxHp, enemy, turn: "player", page: 0 };
    battles.set(battleKey(ix.channel.id, u.userId), b);
    await renderBattle(ix.channel, u, b, "You step through the portal and confront a foe.");
    await ix.editReply("Battle started.");
  }
});

async function spawnPortal(channel) {
  const rarities = ["Common", "Rare", "Epic", "Legendary", "Mythic"];
  const rarity = rarities[Math.floor(Math.random() * rarities.length)];
  const id = uid();
  const emb = new EmbedBuilder().setTitle(`A ${rarity} Portal Appears`).setColor(0x3498db).setDescription("A mysterious rift has opened. Enter before it closes.").setImage(randomPortalImage());
  const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`enterportal:${id}`).setLabel("Enter Portal").setStyle(ButtonStyle.Primary));
  const msg = await channel.send({ embeds: [emb], components: [btn] });
  const p = { id, rarity, channelId: channel.id, messageId: msg.id, createdAt: Date.now(), expiresAt: Date.now() + PORTAL_LIFETIME_MS, expired: false };
  portals.push(p); saveDB();
}

async function portalLoop(client) {
  if (!SPAWN_CHANNEL_ID) return;
  const channel = await client.channels.fetch(SPAWN_CHANNEL_ID).catch(() => null);
  if (!channel) return;
  async function loop() {
    const delay = PORTAL_MIN_MS + Math.random() * (PORTAL_MAX_MS - PORTAL_MIN_MS);
    setTimeout(async () => { await spawnPortal(channel); loop(); }, delay);
  }
  loop();
}

client.once(Events.ClientReady, () => { portalLoop(client); });
if (!TOKEN) { console.log("Missing token."); } else { client.login(TOKEN); }
