
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, Partials,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events
} = require('discord.js');

// ------------ Config ------------
const TOKEN = process.env.DISCORD_TOKEN || process.env.TOKEN || "";
const PREFIX = process.env.PREFIX || "!";
const OWNER_ID = process.env.OWNER_ID || "730629579533844512";
const SPAWN_CHANNEL_ID = process.env.SPAWN_CHANNEL_ID || "";

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const POWERS_FILE = path.join(DATA_DIR, "powers.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
for (const f of [USERS_FILE]) if (!fs.existsSync(f)) fs.writeFileSync(f, "[]", "utf8");
if (!fs.existsSync(POWERS_FILE)) {
  console.log("⚠️ data/powers.json missing. Run: npm run gen:powers");
}

// Autosave utility
function loadUsers(){ try { return JSON.parse(fs.readFileSync(USERS_FILE,'utf8')) } catch { return [] } }
function saveUsers(u){ fs.writeFileSync(USERS_FILE, JSON.stringify(u,null,2), 'utf8'); }
function loadPowers(){ try { return JSON.parse(fs.readFileSync(POWERS_FILE,'utf8')) } catch { return {} } }

const users = loadUsers();
const powers = loadPowers();

// Cooldowns (memory)
const cd = new Map();
function onCD(userId, key, ms){
  const now = Date.now();
  const k = `${userId}:${key}`;
  const until = cd.get(k) || 0;
  if (until > now) return until - now;
  cd.set(k, now + ms);
  return 0;
}
function fmtMs(ms){
  const s = Math.ceil(ms/1000);
  const m = Math.floor(s/60), r = s%60;
  if (m>=1) return `${m}m ${r}s`;
  return `${r}s`;
}

// ------------ Discord Client ------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, (c)=>{
  console.log(`✅ Logged in as ${c.user.tag} | Prefix: ${PREFIX}`);
});

// ------------ Helpers ------------
function getUser(id, username){
  let u = users.find(x=>x.userId===id);
  if (!u){
    u = { userId:id, username, level:1, exp:0, gold:0, hpBonus:0, atkBonus:0, createdAt:Date.now(), power:null, inv:{} };
    users.push(u); saveUsers(users);
  }
  return u;
}
function pickRandomPower(){
  const keys = Object.keys(powers);
  if (!keys.length) return null;
  const k = keys[Math.floor(Math.random()*keys.length)];
  return { name:k, ...powers[k] };
}
function pMaxHP(u){ return 120 + u.level*30 + (u.hpBonus||0); }
function pATK(u){ return Math.floor(12 + u.level*6 + (u.atkBonus||0)); }

function unlockedSkills(u){
  if (!u.power) return [];
  return (u.power.skills||[]).filter(s => u.level >= (s.levelReq||1));
}
function dmgForSkill(u, sName){
  const skill = (u.power?.skills||[]).find(s=>s.name===sName);
  const mult = skill?.powerMult || 1.0;
  const base = pATK(u);
  return Math.max(1, Math.floor(base * mult * (0.85+Math.random()*0.3)));
}
function addItem(u, key, qty=1){ u.inv ||= {}; u.inv[key]=(u.inv[key]||0)+qty; }
function takeItem(u, key, qty=1){
  u.inv ||= {};
  if ((u.inv[key]||0)<qty) return false;
  u.inv[key]-=qty; if (u.inv[key]<=0) delete u.inv[key]; return true;
}
function invToString(u){
  const inv = u.inv||{}; const keys = Object.keys(inv);
  if (!keys.length) return "_empty_";
  return keys.map(k=>`• ${k} x${inv[k]}`).join("\n");
}

// Active battles map
const battles = new Map(); // key: channelId:userId

function battleKey(chId, uid){ return `${chId}:${uid}`; }

async function renderBattle(channel, user, b, headline){
  const emb = new EmbedBuilder()
    .setTitle(`⚔️ Battle vs ${b.enemy.name}`)
    .setColor(0x9b59b6)
    .setDescription([
      headline || "",
      "",
      `**${user.username}** — HP: ${b.hp}/${b.maxHp}`,
      `**${b.enemy.name}** — HP: ${b.enemy.hp}/${b.enemy.maxHp}`,
      "",
      b.turn==="player" ? "_Your turn — choose an action below._" : "_Enemy's turn..._"
    ].join("\n"));

  // Build Skill Buttons (page of 4)
  const skills = unlockedSkills(user);
  const perPage = 4;
  const start = b.page*perPage;
  const pageSkills = skills.slice(start, start+perPage);

  const row1 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId(`battle:attack:${user.userId}`).setLabel("Basic Attack").setStyle(ButtonStyle.Primary)
    );
  for (const s of pageSkills) {
    row1.addComponents(new ButtonBuilder().setCustomId(`battle:skill:${user.userId}:${s.name}`).setLabel(s.name.slice(0,80)).setStyle(ButtonStyle.Success));
    if (row1.components.length>=5) break;
  }
  const row2 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId(`battle:prev:${user.userId}`).setLabel("◀ Prev").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`battle:next:${user.userId}`).setLabel("Next ▶").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`battle:flee:${user.userId}`).setLabel("Flee").setStyle(ButtonStyle.Danger),
    );
  if (b.msg){
    try { await b.msg.edit({ embeds:[emb], components:[row1,row2] }); } catch {}
  } else {
    b.msg = await channel.send({ embeds:[emb], components:[row1,row2] });
  }
}

async function endBattleReplace(b, channel, text){
  // Remove buttons, replace message with results
  if (b.msg) {
    try { await b.msg.edit({ components:[] }); } catch {}
  }
  const emb = new EmbedBuilder().setTitle("🏁 Battle Result").setColor(0x2ecc71).setDescription(text);
  await channel.send({ embeds:[emb] });
}

async function enemyTurn(ix, u, b){
  let dmg = Math.max(1, Math.floor(b.enemy.atk*(0.9+Math.random()*0.25)));
  b.hp = Math.max(0, b.hp - dmg);
  if (b.hp<=0){
    battles.delete(battleKey(b.channelId, b.userId));
    u.exp += 20 + Math.floor(Math.random()*15);
    u.gold = (u.gold||0) + (5 + Math.floor(Math.random()*15));
    saveUsers(users);
    return endBattleReplace(b, ix.channel, `You were defeated by **${b.enemy.name}**.\nRewards: **+${20}~ EXP**, **+${5}~ Gold**`);
  }
  b.turn="player";
  return renderBattle(ix.channel, u, b, `**${b.enemy.name}** hits you for **${dmg}**.`);
}

// ------------ Commands ------------
client.on(Events.MessageCreate, async (msg)=>{
  if (msg.author.bot || !msg.content.startsWith(PREFIX)) return;
  const [raw, ...rest] = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = (raw||"").toLowerCase();
  const args = rest;

  // Owner/admin helper
  const isOwner = msg.author.id === OWNER_ID;

  if (cmd === "ping"){
    return msg.reply("Pong!");
  }

  if (cmd === "help"){
    const emb = new EmbedBuilder()
      .setTitle("📖 Commands")
      .setColor(0x5865f2)
      .setDescription([
        `Prefix: \`${PREFIX}\``,
        "",
        "**Core**",
        "`!register` — awaken and get a power",
        "`!profile` — view stats & power",
        "`!skills` — view unlocked skills",
        "`!train` — gain EXP (CD 15s)",
        "`!battle` — start a battle",
        "`!encounter` — quick battle (CD 45s)",
        "",
        "**Inventory**",
        "`!inv` — show items",
        "`!use <item>` — use item",
        "",
        "**Admin**",
        "`!resetuser <@user>` — reset a user (owner only)",
        "`!setspawn #channel` — set portal spawn channel",
      ].join("\n"));
    return msg.channel.send({ embeds:[emb] });
  }

  if (cmd === "register"){
    let u = getUser(msg.author.id, msg.author.username);
    if (u.power) return msg.reply("Already awakened.");
    const p = pickRandomPower();
    if (!p) return msg.reply("No powers available. Please generate `data/powers.json`.");
    // attach selected power
    u.power = { name:p.name, type:p.type, description:p.description, skills:p.skills };
    saveUsers(users);
    const emb = new EmbedBuilder()
      .setTitle("✨ Awakening Complete")
      .setDescription([
        `**Power:** ${u.power.name}`,
        `${u.power.description}`,
        "",
        `Unlocked at Lv1: ${unlockedSkills(u).map(s=>s.name).join(", ") || "_none_"}`
      ].join("\n"))
      .setColor(0x00d26a);
    return msg.channel.send({ embeds:[emb] });
  }

  if (cmd === "profile"){
    const u = getUser(msg.author.id, msg.author.username);
    const need = u.level*100;
    const emb = new EmbedBuilder()
      .setTitle(`🗡 Hunter: ${u.username}`)
      .setColor(0x3498db)
      .addFields(
        { name:"Stats", value:`Level: ${u.level}\nEXP: ${u.exp}/${need}\nGold: ${u.gold}`, inline:true },
        { name:"Power", value: u.power ? `**${u.power.name}**\n${u.power.description}` : "_none_", inline:true },
        { name:"Inventory", value: invToString(u), inline:false }
      );
    return msg.channel.send({ embeds:[emb] });
  }

  if (cmd === "skills"){
    const u = getUser(msg.author.id, msg.author.username);
    if (!u.power) return msg.reply("Not awakened. Use `!register`.");
    const list = (u.power.skills||[]).map(s=>{
      const unlocked = u.level >= (s.levelReq||1);
      const icon = unlocked ? "✅" : (u.level >= (s.levelReq||1) ? "🔓" : "🔒");
      return `${icon} **${s.name}** (Lv ${s.levelReq})`;
    }).join("\n");
    const emb = new EmbedBuilder().setTitle(`⚡ ${u.power.name} Skills`).setDescription(list||"No skills").setColor(0x9b59b6);
    return msg.channel.send({ embeds:[emb] });
  }

  if (cmd === "train"){
    const u = getUser(msg.author.id, msg.author.username);
    const remain = onCD(u.userId, "train", 15000);
    if (remain) return msg.reply(`⏳ Cooldown: **${fmtMs(remain)}**`);
    const gain = 25 + Math.floor(Math.random()*51);
    u.exp += gain;
    while (u.exp >= u.level*100){ u.exp -= u.level*100; u.level++; }
    saveUsers(users);
    return msg.channel.send(`🏋️ **${u.username}** gains **${gain} EXP** (Lv ${u.level})`);
  }

  if (cmd === "battle" || cmd==="encounter"){
    const u = getUser(msg.author.id, msg.author.username);
    if (!u.power) return msg.reply("Not awakened. Use `!register`.");
    if (cmd==="encounter"){
      const remain = onCD(u.userId, "encounter", 45000);
      if (remain) return msg.reply(`⏳ Cooldown: **${fmtMs(remain)}**`);
    }
    const key = battleKey(msg.channel.id, u.userId);
    if (battles.has(key)) return msg.reply("You already have an active battle here.");
    const enemy = {
      name: ["Goblin Scout","Stone Golem","Lesser Demon","Orc Raider","Frost Wraith","Shadow Beast"][Math.floor(Math.random()*6)],
      maxHp: Math.floor(100 + u.level*50),
      atk: Math.floor(10 + u.level*8),
      hp: 0
    };
    enemy.hp = enemy.maxHp;
    const b = {
      channelId: msg.channel.id, userId: u.userId, hp: pMaxHP(u), maxHp: pMaxHP(u),
      enemy, turn:"player", page:0, msg:null
    };
    battles.set(key, b);
    return renderBattle(msg.channel, u, b, "A wild enemy appears!");
  }

  if (cmd === "inv"){
    const u = getUser(msg.author.id, msg.author.username);
    const e = new EmbedBuilder().setTitle(`🎒 ${u.username}'s Inventory`).setDescription(invToString(u)).setColor(0x2ecc71);
    return msg.channel.send({ embeds:[e] });
  }

  if (cmd === "use"){
    const u = getUser(msg.author.id, msg.author.username);
    const key = (args[0]||"").toLowerCase();
    if (!key) return msg.reply("Usage: `!use <item>`");
    if (!takeItem(u, key, 1)) return msg.reply(`No **${key}** available.`);
    saveUsers(users);
    return msg.channel.send(`Used **${key}**.`);
  }

  // Admin
  if (cmd === "resetuser"){
    if (!isOwner) return msg.reply("Owner only.");
    const mentioned = msg.mentions.users.first();
    if (!mentioned) return msg.reply("Tag a user to reset.");
    const idx = users.findIndex(x=>x.userId===mentioned.id);
    if (idx>=0){
      users.splice(idx,1);
      saveUsers(users);
      return msg.channel.send(`✅ Reset data for <@${mentioned.id}>.`);
    } else {
      return msg.channel.send("User has no data to reset.");
    }
  }

  if (cmd === "setspawn"){
    if (!isOwner) return msg.reply("Owner only.");
    const ch = msg.mentions.channels.first();
    if (!ch) return msg.reply("Tag a channel. Example: `!setspawn #gates`");
    process.env.SPAWN_CHANNEL_ID = ch.id;
    return msg.channel.send(`✅ Spawn channel set to ${ch}. (Persist this in your .env as SPAWN_CHANNEL_ID=${ch.id})`);
  }
});

// Button interactions
client.on(Events.InteractionCreate, async (ix)=>{
  if (!ix.isButton()) return;
  const [scope, action, targetId, extra] = ix.customId.split(":");
  if (scope !== "battle") return;

  const key = battleKey(ix.channel.id, targetId);
  const b = battles.get(key);
  const u = users.find(x=>x.userId===targetId);
  if (!b || !u) return ix.reply({ content:"No active battle.", ephemeral:true });
  if (ix.user.id !== targetId) return ix.reply({ content:"This battle isn't yours.", ephemeral:true });
  if (b.turn!=="player" && action!=="prev" && action!=="next") return ix.reply({ content:"Not your turn.", ephemeral:true });

  if (action==="prev"){ b.page=Math.max(0,b.page-1); await ix.deferUpdate(); return renderBattle(ix.channel, u, b, "Page changed."); }
  if (action==="next"){ b.page+=1; await ix.deferUpdate(); return renderBattle(ix.channel, u, b, "Page changed."); }
  if (action==="flee"){
    battles.delete(key);
    try { await b.msg.edit({ components:[] }); } catch {}
    return ix.reply({ content:"You fled the battle.", ephemeral:false });
  }

  if (action==="attack"){
    const dmg = Math.max(1, Math.floor(pATK(u)*(0.9+Math.random()*0.25)));
    b.enemy.hp = Math.max(0, b.enemy.hp - dmg);
    if (b.enemy.hp<=0){
      battles.delete(key);
      const exp = 80 + Math.floor(Math.random()*40);
      const gold = 30 + Math.floor(Math.random()*20);
      u.exp += exp; u.gold = (u.gold||0)+gold;
      while (u.exp >= u.level*100){ u.exp -= u.level*100; u.level++; }
      saveUsers(users);
      await ix.deferUpdate();
      return endBattleReplace(b, ix.channel, `**Victory!** You dealt the finishing blow.\nRewards: **+${exp} EXP**, **+${gold} Gold**`);
    }
    b.turn="enemy"; await ix.deferUpdate();
    await renderBattle(ix.channel, u, b, `You strike for **${dmg}**.`);
    return enemyTurn(ix, u, b);
  }

  if (action==="skill"){
    const sName = extra;
    const dmg = dmgForSkill(u, sName);
    b.enemy.hp = Math.max(0, b.enemy.hp - dmg);
    if (b.enemy.hp<=0){
      battles.delete(key);
      const exp = 90 + Math.floor(Math.random()*50);
      const gold = 35 + Math.floor(Math.random()*25);
      u.exp += exp; u.gold = (u.gold||0)+gold;
      while (u.exp >= u.level*100){ u.exp -= u.level*100; u.level++; }
      saveUsers(users);
      await ix.deferUpdate();
      return endBattleReplace(b, ix.channel, `**Victory!** You cast **${sName}** for **${dmg}**.\nRewards: **+${exp} EXP**, **+${gold} Gold**`);
    }
    b.turn="enemy"; await ix.deferUpdate();
    await renderBattle(ix.channel, u, b, `You cast **${sName}** for **${dmg}**.`);
    return enemyTurn(ix, u, b);
  }
});

if (!TOKEN) {
  console.log("❌ Missing token. Set DISCORD_TOKEN in .env");
} else {
  client.login(TOKEN);
    }
    
