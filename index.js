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
const PORTAL_MIN_MS = Number(process.env.PORTAL_MIN_MS || 5*60*1000); // 5 min
const PORTAL_MAX_MS = Number(process.env.PORTAL_MAX_MS || 10*60*1000); // 10 min

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
  scheduleNextPortal();
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
  u.inv[key]-=qty; if (u.inv[key]<=0) delete u.inv[key]; return true; }
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

// ------------ Portal System ------------
const portals = new Map(); // key: messageId -> portal object
let portalTimeout = null;

function randomDelay(){
  const span = Math.max(1000, PORTAL_MAX_MS - PORTAL_MIN_MS);
  return PORTAL_MIN_MS + Math.floor(Math.random()*span);
}

function genPortal(){
  // Rarity affects rewards & enemy
  const roll = Math.random();
  const rarity = roll>0.97? 'Mythic' : roll>0.9? 'Legendary' : roll>0.7? 'Epic' : roll>0.4? 'Rare' : 'Common';
  const colorMap = { Common:0x95a5a6, Rare:0x3498db, Epic:0x9b59b6, Legendary:0xf1c40f, Mythic:0xe67e22 };
  const enemyNames = {
    Common:["Goblin Scout","Wild Boar","Skeleton"],
    Rare:["Orc Raider","Shade Stalker","Lizard Knight"],
    Epic:["Frost Wraith","Stone Golem","Flame Revenant"],
    Legendary:["Hydra Spawn","Dread Knight","Abyss Sorcerer"],
    Mythic:["Ancient Dragonling","Archfiend Shade"]
  };
  const name = `${rarity} Portal`;
  const enemy = {
    name: enemyNames[rarity][Math.floor(Math.random()*enemyNames[rarity].length)],
    power: rarity
  };
  const lifetime = 3*60*1000; // 3 minutes to enter
  return { id: Math.random().toString(36).slice(2,8), rarity, color: colorMap[rarity], name, enemy, createdAt:Date.now(), expiresAt:Date.now()+lifetime, entrants:new Set(), messageId:null, channelId:null };
}

async function spawnPortal(channel){
  const p = genPortal();
  const emb = new EmbedBuilder()
    .setTitle(`🌀 ${p.name}`)
    .setColor(p.color)
    .setDescription([`A spatial rift has opened!`, `Enemy sign: **${p.enemy.name}**`, "\nClick **Enter Portal** to challenge."].join("\n"))
    .setFooter({ text:`Closes in 3 minutes • ID ${p.id}` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`portal:enter:${p.id}`).setLabel('Enter Portal').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`portal:info:${p.id}`).setLabel('Info').setStyle(ButtonStyle.Secondary)
  );
  const msg = await channel.send({ embeds:[emb], components:[row] });
  p.messageId = msg.id; p.channelId = channel.id; portals.set(p.id, p);

  // auto close
  setTimeout(async ()=>{
    const cur = portals.get(p.id);
    if (!cur) return;
    portals.delete(p.id);
    try { await msg.edit({ components:[] }); } catch {}
    const closed = new EmbedBuilder().setTitle(`🌀 ${p.name} closed`).setColor(0x95a5a6).setDescription("The rift has stabilized and vanished.");
    channel.send({ embeds:[closed] });
  }, p.expiresAt - Date.now());
}

function scheduleNextPortal(){
  if (portalTimeout) clearTimeout(portalTimeout);
  if (!SPAWN_CHANNEL_ID){
    console.log('ℹ️ No SPAWN_CHANNEL_ID set; portal auto-spawn disabled.');
    return;
  }
  const delay = randomDelay();
  portalTimeout = setTimeout(async ()=>{
    try {
      const ch = await client.channels.fetch(SPAWN_CHANNEL_ID);
      if (ch) await spawnPortal(ch);
    } catch(err){ console.error('Portal spawn failed', err); }
    finally { scheduleNextPortal(); }
  }, delay);
  console.log(`⏳ Next portal in ~${Math.round(delay/60000)} min`);
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
        "**Portals**",
        "`!portals` — list active portals",
        "`!portal` — (owner) spawn a portal now",
        "",
        "**Inventory & Trading**",
        "`!inv` — show items",
        "`!use <item>` — use item",
        "`!offer @user <item> <qty> <gold>` — offer item(s) for gold",
        "`!canceloffer` — cancel your pending offer",
        "",
        "**Admin**",
        "`!resetuser <@user>` — reset a user (owner only)",
        "`!setspawn #channel` — set portal spawn channel",
        "`!giveexp <@user> <amount>` — add EXP (owner)",
        "`!givegold <@user> <amount>` — add Gold (owner)",
      ].join("\n"));
    return msg.channel.send({ embeds:[emb] });
  }

  if (cmd === "register"){
    let u = getUser(msg.author.id, msg.author.username);
    if (u.power) return msg.reply("Already awakened.");
    const p = pickRandomPower();
    if (!p) return msg.reply("No powers available. Please generate `data/powers.json`.");
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

  // --- Portal Commands ---
  if (cmd === 'portals'){
    if (!portals.size) return msg.reply('No active portals.');
    const lines = [...portals.values()].map(p=>`• **${p.name}** in <#${p.channelId}> — closes in ${fmtMs(p.expiresAt-Date.now())} (ID: ${p.id})`);
    const emb = new EmbedBuilder().setTitle('🌀 Active Portals').setColor(0x3498db).setDescription(lines.join('\n'));
    return msg.channel.send({ embeds:[emb] });
  }

  if (cmd === 'portal'){
    if (!isOwner) return msg.reply('Owner only.');
    const ch = msg.mentions.channels.first() || msg.channel;
    await spawnPortal(ch);
    return msg.react('🌀');
  }

  // --- Trading Commands ---
  if (cmd === 'offer'){
    const target = msg.mentions.users.first();
    if (!target) return msg.reply('Usage: `!offer @user <item> <qty> <gold>`');
    const u = getUser(msg.author.id, msg.author.username);
    const t = getUser(target.id, target.username);
    const [item, qtyStr, goldStr] = args.slice(1);
    const qty = Math.max(1, parseInt(qtyStr||'1'));
    const gold = Math.max(0, parseInt(goldStr||'0'));
    if (!item) return msg.reply('Please provide an item name.');
    if ((u.inv?.[item]||0) < qty) return msg.reply(`You don't have enough **${item}**.`);

    const emb = new EmbedBuilder()
      .setTitle('🤝 Trade Offer')
      .setColor(0x2ecc71)
      .setDescription(`${msg.author} offers **${qty}x ${item}** to ${target} for **${gold} Gold**.`)
      .setFooter({ text:'Offer expires in 60s' });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`trade:accept:${msg.author.id}:${target.id}:${item}:${qty}:${gold}`).setLabel('Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`trade:decline:${msg.author.id}:${target.id}`).setLabel('Decline').setStyle(ButtonStyle.Danger)
    );
    const offerMsg = await msg.channel.send({ embeds:[emb], components:[row] });
    setTimeout(()=>{ try{ offerMsg.edit({ components:[] }); }catch{} }, 60*1000);
    return;
  }

  if (cmd === 'canceloffer'){
    // This is a lightweight demo; offers are tied to the message and expire in 60s, so nothing to cancel persistently.
    return msg.reply('Recent offers auto-expire in 60 seconds. Create a new one if needed.');
  }

  // --- Admin ---
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

  if (cmd === 'giveexp'){
    if (!isOwner) return msg.reply('Owner only.');
    const target = msg.mentions.users.first();
    const amount = parseInt(args[1]||'0');
    if (!target || !amount) return msg.reply('Usage: `!giveexp @user <amount>`');
    const u = getUser(target.id, target.username);
    u.exp += amount;
    while (u.exp >= u.level*100){ u.exp -= u.level*100; u.level++; }
    saveUsers(users);
    return msg.channel.send(`✅ Gave **${amount} EXP** to <@${target.id}> (Lv ${u.level}).`);
  }

  if (cmd === 'givegold'){
    if (!isOwner) return msg.reply('Owner only.');
    const target = msg.mentions.users.first();
    const amount = parseInt(args[1]||'0');
    if (!target || !amount) return msg.reply('Usage: `!givegold @user <amount>`');
    const u = getUser(target.id, target.username);
    u.gold = (u.gold||0) + amount;
    saveUsers(users);
    return msg.channel.send(`✅ Gave **${amount} Gold** to <@${target.id}> (now ${u.gold}).`);
  }
});

// Button interactions
client.on(Events.InteractionCreate, async (ix)=>{
  if (!ix.isButton()) return;
  const parts = ix.customId.split(":");
  const scope = parts[0];

  // --- Battle buttons ---
  if (scope === 'battle'){
    const [_, action, targetId, extra] = parts;
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
      const sName = parts.slice(3).join(":"); // support colons in names just in case
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
    return;
  }

  // --- Portal buttons ---
  if (scope === 'portal'){
    const [_, action, portalId] = parts;
    const p = portals.get(portalId);
    if (!p) return ix.reply({ content:'This portal has closed or is invalid.', ephemeral:true });

    if (action === 'info'){
      const left = Math.max(0, p.expiresAt - Date.now());
      return ix.reply({ content:`Rarity: ${p.rarity} • Enemy: ${p.enemy.name} • Closes in ${fmtMs(left)}`, ephemeral:true });
    }

    if (action === 'enter'){
      const u = getUser(ix.user.id, ix.user.username);
      if (!u.power) return ix.reply({ content:'Awaken first with `!register`.', ephemeral:true });
      const key = battleKey(ix.channel.id, u.userId);
      if (battles.has(key)) return ix.reply({ content:'You already have an active battle in this channel.', ephemeral:true });

      // Scale by rarity
      const rarMult = { Common:1.0, Rare:1.2, Epic:1.5, Legendary:2.0, Mythic:2.8 }[p.rarity] || 1.0;
      const enemy = {
        name: p.enemy.name,
        maxHp: Math.floor((100 + u.level*60) * rarMult),
        atk: Math.floor((12 + u.level*9) * rarMult),
        hp: 0
      };
      enemy.hp = enemy.maxHp;
      const b = { channelId: ix.channel.id, userId: u.userId, hp: pMaxHP(u), maxHp: pMaxHP(u), enemy, turn:'player', page:0, msg:null };
      battles.set(key, b);
      await ix.deferUpdate();
      return renderBattle(ix.channel, u, b, `You step into the **${p.rarity}** portal...`);
    }
    return;
  }

  // --- Trade buttons ---
  if (scope === 'trade'){
    const [_, action, fromId, toId, item, qtyStr, goldStr] = parts;
    if (action === 'decline'){
      if (ix.user.id !== toId) return ix.reply({ content:'Only the recipient can decline.', ephemeral:true });
      try { await ix.message.edit({ components:[] }); } catch{}
      return ix.reply({ content:'Offer declined.', ephemeral:true });
    }
    if (action === 'accept'){
      if (ix.user.id !== toId) return ix.reply({ content:'Only the recipient can accept.', ephemeral:true });
      const qty = Math.max(1, parseInt(qtyStr||'1'));
      const gold = Math.max(0, parseInt(goldStr||'0'));
      const from = getUser(fromId, fromId);
      const to = getUser(toId, toId);
      if ((from.inv?.[item]||0) < qty) return ix.reply({ content:`Sender no longer has **${qty}x ${item}**.`, ephemeral:true });
      if ((to.gold||0) < gold) return ix.reply({ content:`You don't have **${gold} Gold**.`, ephemeral:true });
      // transfer
      takeItem(from, item, qty);
      addItem(to, item, qty);
      from.gold = (from.gold||0) + gold;
      to.gold = (to.gold||0) - gold;
      saveUsers(users);
      try { await ix.message.edit({ components:[] }); } catch{}
      return ix.reply({ content:`✅ Trade completed: ${qty}x ${item} ⇄ ${gold} Gold.`, ephemeral:false });
    }
  }
});

if (!TOKEN) {
  console.log("❌ Missing token. Set DISCORD_TOKEN in .env");
} else {
  client.login(TOKEN);
}
